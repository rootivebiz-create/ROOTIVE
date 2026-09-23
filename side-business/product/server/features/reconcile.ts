import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { matchName, normalizeName, similarity, type Candidate } from "~/server/names";
import { getTenant } from "~/server/repo";
import { monthParam, shiftMonth } from "~/server/month";
import { detectHeaderRow, headerSignature, readTable, TableReadError } from "~/server/tabular";
import { roundYen } from "@/lib/payroll/money";
import type { Rounding } from "@/lib/payroll/types";
import {
  columnsProblem,
  columnsToMapping,
  COLUMN_ROLES,
  detectColumns,
  parseNoticeRows,
  type ColumnMap,
  type ColumnRole,
  type ParsedNotice,
  type SkippedRow,
} from "~/server/features/reconcile/columns";
import { compareNotice, itemKey, sumDiffs, type CmpLine, type CompareItem, type CompareResult, type LineRole } from "~/server/features/reconcile/compare";
import { receivingFacts, type ReceivingFact } from "~/server/features/reconcile/facts";
import { isChargeName, isUnsettled, lineKey, type ItemKind, type ItemStatus } from "~/server/features/reconcile/labels";

export { lineKey };

/**
 * 元請の支払通知との突合（取り込み・突き合わせ・問い合わせの状態・レポート）。
 * - すべて (db, tenantId, …) を受け取り、会社で絞る。画面から来た id は必ず会社のものか確かめる
 * - 列の対応と、行の当て方（案件・追加の料金・対象外）は mapping_profiles（kind='payment_notice'、名前＝元請名）に覚える
 * - 上げたファイルの中身（文字の表）は import_batches（kind='payment_notice'）の summary に残し、列を選び直せるようにする
 * - 差は reconciliation_items に保存する。作り直しても、同じ鍵（種類＋案件＋名前）の状態とメモは残す
 */

export const MAX_NOTICE_FILE_BYTES = 5 * 1024 * 1024;
/** 列を選び直すために残す行・列の上限 */
const KEEP_ROWS = 5000;
const KEEP_COLS = 40;

export const SAMPLE_NOTICE_FILE = "元請_支払通知_2026年10月_SJIS.csv";
export const SAMPLE_NOTICE_MONTH = "2026-10-01";

// ---------------------------------------------------------------- 覚えておく形

/** 行の当て方：project:<id>・extra（追加の料金）・ignore（対象外） */
export type LineTarget = `project:${string}` | "extra" | "ignore";

type ProfileOptions = {
  clientId?: string;
  /** 見出し行の位置（0 始まり。選び直したとき） */
  headerRow?: number;
  /** 品目の名前（正規化）→ 当て方 */
  lineMap?: Record<string, LineTarget>;
  /** ドライバー名（正規化）→ driverId（"none" はドライバーなしとして扱う） */
  driverMap?: Record<string, string>;
};

export type NoticeBatchSummary = {
  noticeId: string;
  clientId: string;
  encoding: string;
  sheetName: string;
  sheetNames: string[];
  headerIndex: number;
  columns: ColumnMap;
  fromSaved: boolean;
  rows: string[][];
  rowsTruncated: boolean;
  problem: string | null;
  skipped: SkippedRow[];
  fileTotal: number | null;
  taxTotal: number;
  feeTotal: number;
  total: number;
  dates: ParsedNotice["dates"];
  warnings: string[];
  notes: string[];
};

type ProfileRow = typeof s.mappingProfiles.$inferSelect;


// ---------------------------------------------------------------- 読み出し（会社で絞る）

async function getClient(db: Db, tenantId: string, clientId: string) {
  const rows = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, clientId))).limit(1);
  if (!rows[0]) throw new UserError("元請が見つかりません。画面を読み込み直してください");
  return rows[0];
}

async function getNotice(db: Db, tenantId: string, noticeId: string) {
  const rows = await db
    .select()
    .from(s.paymentNotices)
    .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.id, noticeId)))
    .limit(1);
  if (!rows[0]) throw new UserError("お支払通知が見つかりません。すでに削除されたかもしれません");
  return rows[0];
}

async function findProfile(db: Db, tenantId: string, client: { id: string; name: string } | null): Promise<ProfileRow | null> {
  if (!client) return null;
  const rows = await db
    .select()
    .from(s.mappingProfiles)
    .where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "payment_notice")))
    .orderBy(desc(s.mappingProfiles.updatedAt));
  return rows.find((r) => (r.options as ProfileOptions)?.clientId === client.id) ?? rows.find((r) => r.name === client.name) ?? null;
}

async function saveProfile(
  db: Db,
  tenantId: string,
  client: { id: string; name: string },
  patch: { mapping?: Record<string, string>; headerSignature?: string; options?: Partial<ProfileOptions> },
): Promise<void> {
  const current = await findProfile(db, tenantId, client);
  const options: ProfileOptions = { ...((current?.options as ProfileOptions) ?? {}), ...(patch.options ?? {}), clientId: client.id };
  if (current) {
    await db
      .update(s.mappingProfiles)
      .set({
        name: client.name,
        mapping: patch.mapping ?? current.mapping,
        headerSignature: patch.headerSignature ?? current.headerSignature,
        options,
        updatedAt: new Date(),
      })
      .where(and(eq(s.mappingProfiles.id, current.id), eq(s.mappingProfiles.tenantId, tenantId)));
  } else {
    await db.insert(s.mappingProfiles).values({
      tenantId,
      name: client.name,
      kind: "payment_notice",
      headerSignature: patch.headerSignature ?? "",
      mapping: patch.mapping ?? {},
      options,
    });
  }
}

/** その通知を取り込んだ記録（summary.noticeId で探す。中身の行が大きいので、DB の側で絞る） */
function batchOf(noticeId: string) {
  return sql`${s.importBatches.summary}->>'noticeId' = ${noticeId}`;
}

async function latestBatch(db: Db, tenantId: string, noticeId: string) {
  const rows = await db
    .select()
    .from(s.importBatches)
    .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, "payment_notice"), eq(s.importBatches.status, "applied"), batchOf(noticeId)))
    .orderBy(desc(s.importBatches.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- 行の当て方

type ProjectRef = { id: string; name: string; clientId: string | null; aliases: string[]; active: boolean; unit: string; billRate: number };
type DriverRef = { id: string; name: string; code: string | null; kana: string | null; aliases: string[]; active: boolean };

function toCandidates<T extends { id: string; name: string; aliases: string[]; active: boolean; code?: string | null; kana?: string | null }>(list: T[]): Candidate[] {
  return [...list].sort((a, b) => Number(b.active) - Number(a.active)).map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, code: p.code ?? null, kana: p.kana ?? null }));
}

/**
 * 品目の名前 → 案件（その元請の案件 → ほかの案件の順）。
 * 追加の料金らしい名前（「宅配（再配達）」など）は、名前・別名がそのまま同じときだけ、料金でない案件に当てる
 * （括弧を外した一致や部分一致で「宅配」に混ぜると、再配達の料金の違いが見えなくなるため）
 */
export function matchProjectName(raw: string, clientId: string | null, projects: ProjectRef[]): string | null {
  const own = toCandidates(projects.filter((p) => clientId !== null && p.clientId === clientId));
  const all = toCandidates(projects);
  const charge = isChargeName(raw);
  for (const list of [own, all]) {
    const m = matchName(raw, list);
    if (!m) continue;
    if (charge && !isChargeName(m.name) && (m.how === "partial" || m.how === "normalized")) continue;
    return m.id;
  }
  return null;
}

function resolveLine(
  line: { rawProject: string; projectId: string | null },
  lineMap: Record<string, LineTarget>,
  clientId: string | null,
  projects: ProjectRef[],
): { projectId: string | null; role: LineRole } {
  const ids = new Set(projects.map((p) => p.id));
  const mapped = lineMap[lineKey(line.rawProject)];
  if (mapped === "extra" || mapped === "ignore") return { projectId: null, role: mapped };
  if (mapped?.startsWith("project:")) {
    const id = mapped.slice("project:".length);
    if (ids.has(id)) return { projectId: id, role: "project" };
  }
  if (line.projectId && ids.has(line.projectId)) return { projectId: line.projectId, role: "project" };
  const hit = matchProjectName(line.rawProject, clientId, projects);
  return hit ? { projectId: hit, role: "project" } : { projectId: null, role: "unknown" };
}

function resolveDriver(rawDriver: string | null, current: string | null, driverMap: Record<string, string>, drivers: DriverRef[]): string | null {
  if (!rawDriver?.trim()) return null;
  const ids = new Set(drivers.map((d) => d.id));
  const mapped = driverMap[lineKey(rawDriver)];
  if (mapped === "none") return null;
  if (mapped && ids.has(mapped)) return mapped;
  if (current && ids.has(current)) return current;
  return matchName(rawDriver, toCandidates(drivers))?.id ?? null;
}


// ---------------------------------------------------------------- 突き合わせの材料

type NoticeContext = {
  tenant: Awaited<ReturnType<typeof getTenant>>;
  notice: typeof s.paymentNotices.$inferSelect;
  client: typeof s.clients.$inferSelect | null;
  projects: ProjectRef[];
  drivers: DriverRef[];
  work: { projectId: string; driverId: string; qty: number }[];
  lines: (typeof s.paymentNoticeLines.$inferSelect)[];
  profile: ProfileRow | null;
};

async function loadContext(db: Db, tenantId: string, noticeId: string): Promise<NoticeContext> {
  const notice = await getNotice(db, tenantId, noticeId);
  const [tenant, clientRows, projects, drivers, work, lines] = await Promise.all([
    getTenant(db, tenantId),
    notice.clientId ? db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, notice.clientId))) : Promise.resolve([]),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)).orderBy(asc(s.projects.name)),
    db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)).orderBy(asc(s.drivers.name)),
    db
      .select({ projectId: s.workEntries.projectId, driverId: s.workEntries.driverId, qty: s.workEntries.qty })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, notice.month))),
    db
      .select()
      .from(s.paymentNoticeLines)
      .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.noticeId, noticeId))),
  ]);
  const client = clientRows[0] ?? null;
  const profile = await findProfile(db, tenantId, client);
  return {
    tenant,
    notice,
    client,
    projects: projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, aliases: p.aliases, active: p.active, unit: p.unit, billRate: p.billRate })),
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, code: d.code, kana: d.kana, aliases: d.aliases, active: d.active })),
    work,
    lines,
    profile,
  };
}

function profileOptions(profile: ProfileRow | null): Required<Pick<ProfileOptions, "lineMap" | "driverMap">> & ProfileOptions {
  const o = (profile?.options as ProfileOptions) ?? {};
  return { ...o, lineMap: o.lineMap ?? {}, driverMap: o.driverMap ?? {} };
}

type ResolvedLine = (typeof s.paymentNoticeLines.$inferSelect) & { role: LineRole };

/**
 * 行を案件・ドライバーに当てた結果（DB には書かない）。覚えた当て方 → 名前の照合 の順。
 * 画面・一覧・レポートは、まだ突き合わせていない通知でも、突き合わせたときと同じ当て方で見せる
 */
function resolveAll(ctx: Pick<NoticeContext, "lines" | "profile" | "notice" | "projects" | "drivers">): ResolvedLine[] {
  const { lineMap, driverMap } = profileOptions(ctx.profile);
  return ctx.lines.map((l) => {
    const { projectId, role } = resolveLine(l, lineMap, ctx.notice.clientId, ctx.projects);
    const driverId = resolveDriver(l.rawDriver, l.driverId, driverMap, ctx.drivers);
    return { ...l, projectId, driverId, role };
  });
}

function toCmpLine(l: ResolvedLine): CmpLine {
  return { id: l.id, rawProject: l.rawProject, rawDriver: l.rawDriver, projectId: l.projectId, driverId: l.driverId, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, role: l.role };
}

function compareFromContext(ctx: NoticeContext, resolved: ResolvedLine[]): CompareResult {
  return compareNotice({
    clientId: ctx.notice.clientId,
    projects: ctx.projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, unit: p.unit, billRate: p.billRate })),
    drivers: ctx.drivers.map((d) => ({ id: d.id, name: d.name })),
    work: ctx.work,
    lines: resolved.map(toCmpLine),
    rounding: ctx.tenant.amountRounding as Rounding,
  });
}

/** 行を案件・ドライバーに当て直し（覚えた当て方 → 名前の照合）、変わった行だけ保存する */
async function autoMatch(db: Db, tenantId: string, ctx: NoticeContext): Promise<{ changed: number; resolved: ResolvedLine[] }> {
  const resolved = resolveAll(ctx);
  let changed = 0;
  for (let i = 0; i < resolved.length; i++) {
    const before = ctx.lines[i];
    const after = resolved[i];
    if (before.projectId === after.projectId && before.driverId === after.driverId) continue;
    await db
      .update(s.paymentNoticeLines)
      .set({ projectId: after.projectId, driverId: after.driverId })
      .where(and(eq(s.paymentNoticeLines.id, after.id), eq(s.paymentNoticeLines.tenantId, tenantId)));
    changed++;
  }
  ctx.lines = resolved;
  return { changed, resolved };
}

// ---------------------------------------------------------------- 突き合わせ（保存）

export type RunResult = { skipped: boolean; items: number; created: number; updated: number; removed: number; reopened: number; matchedLines: number };

/**
 * 突き合わせて reconciliation_items を作り直す。
 * 同じ鍵（種類＋案件＋名前）の差は、状態とメモを残す。ただし「解決」「了承」にした差の金額が変わったら「未対応」に戻す。
 * お支払通知に行が 1 つも無いとき（列が分からなかったとき）は、差を作らない（今ある状態も消さない）。
 */
export async function runReconcile(db: Db, tenantId: string, noticeId: string, userId?: string | null): Promise<RunResult> {
  const ctx = await loadContext(db, tenantId, noticeId);
  const { changed: matchedLines, resolved } = await autoMatch(db, tenantId, ctx);
  if (ctx.lines.length === 0) return { skipped: true, items: 0, created: 0, updated: 0, removed: 0, reopened: 0, matchedLines };
  const result = compareFromContext(ctx, resolved);
  const out: RunResult = { skipped: false, items: result.items.length, created: 0, updated: 0, removed: 0, reopened: 0, matchedLines };

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(s.reconciliationItems)
      .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)))
      .orderBy(asc(s.reconciliationItems.createdAt));
    const byKey = new Map<string, (typeof existing)[number]>();
    const drop: typeof existing = [];
    for (const e of existing) {
      const k = itemKey(e.kind, e.projectId, e.label);
      if (byKey.has(k)) drop.push(e);
      else byKey.set(k, e);
    }
    const seen = new Set<string>();
    for (const it of result.items) {
      seen.add(it.key);
      const values = {
        kind: it.kind,
        projectId: it.projectId,
        driverId: it.driverId,
        label: it.label,
        ourQty: it.ourQty,
        theirQty: it.theirQty,
        ourPrice: it.ourPrice,
        theirPrice: it.theirPrice,
        ourAmount: it.ourAmount,
        theirAmount: it.theirAmount,
        diff: it.diff,
      };
      const prev = byKey.get(it.key);
      if (!prev) {
        await tx.insert(s.reconciliationItems).values({ tenantId, noticeId, ...values });
        out.created++;
        continue;
      }
      const reopen = prev.diff !== it.diff && (prev.status === "resolved" || prev.status === "accepted");
      if (reopen) out.reopened++;
      await tx
        .update(s.reconciliationItems)
        .set({ ...values, ...(reopen ? { status: "open" } : {}) })
        .where(and(eq(s.reconciliationItems.id, prev.id), eq(s.reconciliationItems.tenantId, tenantId)));
      out.updated++;
    }
    const removed = [...drop, ...existing.filter((e) => !seen.has(itemKey(e.kind, e.projectId, e.label)) && !drop.includes(e))];
    for (const e of removed) {
      await tx.delete(s.reconciliationItems).where(and(eq(s.reconciliationItems.id, e.id), eq(s.reconciliationItems.tenantId, tenantId)));
    }
    out.removed = removed.length;
    if (removed.some((e) => e.status !== "open" || e.note)) {
      // 扱いを決めていた差が消えたときは、何だったかを操作の記録に残す
      await audit(tx as unknown as Db, {
        tenantId,
        userId,
        action: "reconcile.item_removed",
        entity: "payment_notice",
        entityId: noticeId,
        detail: { items: removed.map((e) => ({ kind: e.kind, label: e.label, diff: e.diff, status: e.status, note: e.note })) },
      });
    }
  });
  await audit(db, { tenantId, userId, action: "reconcile.run", entity: "payment_notice", entityId: noticeId, detail: { ...out, ourTotal: result.ourTotal, theirTotal: result.theirTotal } });
  return out;
}

// ---------------------------------------------------------------- 取り込み

export type ImportNoticeInput = { clientId: string; month: string; fileName: string; bytes: Uint8Array; replace: boolean };
export type ImportNoticeResult = {
  noticeId: string;
  lineCount: number;
  replaced: boolean;
  problem: string | null;
  warnings: string[];
  run: RunResult | null;
};

function pickSheet(sheets: { name: string; rows: string[][] }[], profile: ProfileRow | null) {
  const opts = profileOptions(profile);
  const tries = sheets.map((sheet) => {
    let headerIndex = detectHeaderRow(sheet.rows);
    // 前に見出し行を選び直していて、同じ形なら、その行を使う
    if (profile && typeof opts.headerRow === "number" && sheet.rows[opts.headerRow] && headerSignature(sheet.rows[opts.headerRow]) === profile.headerSignature) {
      headerIndex = opts.headerRow;
    }
    const det = detectColumns(sheet.rows, headerIndex, profile?.mapping as Partial<Record<ColumnRole, string>> | undefined);
    return { sheet, headerIndex, det, problem: columnsProblem(det.columns) };
  });
  return tries.find((t) => !t.problem) ?? tries.sort((a, b) => b.sheet.rows.length - a.sheet.rows.length)[0];
}

function assertMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) throw new UserError("月の形が正しくありません");
}

/** お支払通知のファイルを取り込む。同じ元請・同じ月のものがあれば replace のときだけ行を入れ替える（状態とメモは残る） */
export async function importNotice(db: Db, tenantId: string, userId: string | null, input: ImportNoticeInput): Promise<ImportNoticeResult> {
  assertMonth(input.month);
  const client = await getClient(db, tenantId, input.clientId);
  const tenant = await getTenant(db, tenantId);
  if (input.bytes.byteLength === 0) throw new UserError("ファイルが空です。元請から届いたファイルを選んでください");
  if (input.bytes.byteLength > MAX_NOTICE_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）。不要なシートを消すか、CSV にしてから上げてください");

  let read;
  try {
    read = await readTable(input.fileName, input.bytes);
  } catch (error) {
    if (error instanceof TableReadError) throw new UserError(error.message);
    throw new UserError("ファイルを読めませんでした。CSV か Excel（.xlsx）か確かめてください");
  }
  if (read.sheets.every((sh) => sh.rows.length === 0)) throw new UserError("ファイルの中に表が見つかりませんでした");

  const profile = await findProfile(db, tenantId, client);
  const pick = pickSheet(read.sheets, profile);
  const rows = pick.sheet.rows;
  const rounding = tenant.amountRounding as Rounding;
  const parsed: ParsedNotice | null = pick.problem ? null : parseNoticeRows(rows, pick.headerIndex, pick.det.columns, { rounding, month: input.month });
  if (parsed && parsed.lines.length === 0) {
    throw new UserError("読み取れる行がありませんでした。見出しの下に品目と金額（または数量と単価）が並んでいるか確かめてください");
  }

  const existing = await db
    .select()
    .from(s.paymentNotices)
    .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.clientId, client.id), eq(s.paymentNotices.month, input.month)))
    .limit(1);
  const prev = existing[0];
  if (prev && !input.replace) {
    throw new UserError(
      `${client.name}の${input.month.slice(0, 4)}年${Number(input.month.slice(5, 7))}月分のお支払通知は、すでに上げてあります（${prev.fileName}）。上げ直すときは「すでにあれば入れ替える」にチェックを入れてください。問い合わせの状態とメモは残ります。`,
    );
  }

  const summary: NoticeBatchSummary = {
    noticeId: "",
    clientId: client.id,
    encoding: read.encoding,
    sheetName: pick.sheet.name,
    sheetNames: read.sheets.map((sh) => sh.name),
    headerIndex: pick.headerIndex,
    columns: pick.det.columns,
    fromSaved: pick.det.fromSaved,
    rows: rows.slice(0, KEEP_ROWS).map((r) => r.slice(0, KEEP_COLS)),
    rowsTruncated: rows.length > KEEP_ROWS,
    problem: pick.problem,
    skipped: parsed?.skipped ?? [],
    fileTotal: parsed?.fileTotal ?? null,
    taxTotal: parsed?.taxTotal ?? 0,
    feeTotal: parsed?.feeTotal ?? 0,
    total: parsed?.total ?? 0,
    dates: parsed?.dates ?? null,
    warnings: parsed?.warnings ?? [],
    notes: pick.det.notes,
  };
  const lines = parsed?.lines ?? [];

  const noticeId = await db.transaction(async (tx) => {
    let id: string;
    if (prev) {
      id = prev.id;
      await tx
        .update(s.paymentNotices)
        .set({ fileName: input.fileName, total: summary.total, feeDeducted: prev.feeDeducted || summary.feeTotal })
        .where(and(eq(s.paymentNotices.id, id), eq(s.paymentNotices.tenantId, tenantId)));
      await tx.delete(s.paymentNoticeLines).where(and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.noticeId, id)));
      // 前に取り込んだ記録は「入れ替えた」にする（履歴として残す）
      await tx
        .update(s.importBatches)
        .set({ status: "discarded" })
        .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, "payment_notice"), eq(s.importBatches.status, "applied"), batchOf(id)));
    } else {
      const [n] = await tx
        .insert(s.paymentNotices)
        .values({ tenantId, clientId: client.id, month: input.month, fileName: input.fileName, total: summary.total, feeDeducted: summary.feeTotal })
        .returning({ id: s.paymentNotices.id });
      id = n.id;
    }
    await insertLines(tx as unknown as Db, tenantId, id, lines);
    await tx.insert(s.importBatches).values({
      tenantId,
      month: input.month,
      kind: "payment_notice",
      fileName: input.fileName,
      rowCount: lines.length,
      status: "applied",
      summary: { ...summary, noticeId: id } as unknown as Record<string, unknown>,
      createdBy: userId,
    });
    return id;
  });

  if (!pick.problem) {
    await saveProfile(db, tenantId, client, {
      mapping: columnsToMapping(rows[pick.headerIndex] ?? [], pick.det.columns),
      headerSignature: headerSignature(rows[pick.headerIndex] ?? []),
      options: { headerRow: pick.headerIndex },
    });
  }
  const run = pick.problem ? null : await runReconcile(db, tenantId, noticeId, userId);
  await audit(db, {
    tenantId,
    userId,
    action: prev ? "reconcile.notice_replace" : "reconcile.notice_import",
    entity: "payment_notice",
    entityId: noticeId,
    detail: { clientId: client.id, month: input.month, fileName: input.fileName, lines: lines.length, total: summary.total, encoding: read.encoding, problem: pick.problem },
  });
  return { noticeId, lineCount: lines.length, replaced: Boolean(prev), problem: pick.problem, warnings: [...summary.notes, ...summary.warnings], run };
}

async function insertLines(db: Db, tenantId: string, noticeId: string, lines: ParsedNotice["lines"]): Promise<void> {
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    await db.insert(s.paymentNoticeLines).values(
      chunk.map((l) => ({ tenantId, noticeId, rawProject: l.rawProject, rawDriver: l.rawDriver, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount })),
    );
  }
}

/** 見本（架空の A物流 の 10 月分）を入れる先の元請。無ければ null */
export async function findSampleClient(db: Db, tenantId: string): Promise<{ id: string; name: string } | null> {
  const clients = await db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId));
  const hit = matchName("A物流", clients.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })));
  return hit ? { id: hit.id, name: hit.name } : null;
}

export async function readSampleNotice(): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(path.join(process.cwd(), "public", "samples", SAMPLE_NOTICE_FILE)));
}

// ---------------------------------------------------------------- 列を選び直す

export type ColumnsInput = { noticeId: string; headerRow: number; columns: ColumnMap };

export async function updateNoticeColumns(db: Db, tenantId: string, userId: string | null, input: ColumnsInput): Promise<{ lineCount: number; run: RunResult }> {
  const notice = await getNotice(db, tenantId, input.noticeId);
  const batch = await latestBatch(db, tenantId, notice.id);
  if (!batch) throw new UserError("このお支払通知には、読み取ったファイルの記録がありません。列を選び直すには、ファイルをもう一度上げてください");
  const summary = batch.summary as unknown as NoticeBatchSummary;
  const headerIndex = input.headerRow - 1;
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= summary.rows.length) throw new UserError("見出しの行の番号が正しくありません");
  const width = Math.max(...summary.rows.slice(headerIndex, headerIndex + 50).map((r) => r.length), 0);
  for (const role of COLUMN_ROLES) {
    const idx = input.columns[role];
    if (idx !== null && (!Number.isInteger(idx) || idx < 0 || idx >= width)) throw new UserError("列の選び方が正しくありません。画面を読み込み直してください");
  }
  const picked = COLUMN_ROLES.map((r) => input.columns[r]).filter((v): v is number => v !== null);
  if (new Set(picked).size !== picked.length) throw new UserError("同じ列を 2 つの役に選んでいます。1 つの列は 1 つの役にしてください");
  const problem = columnsProblem(input.columns);
  if (problem) throw new UserError(problem);

  const tenant = await getTenant(db, tenantId);
  const parsed = parseNoticeRows(summary.rows, headerIndex, input.columns, { rounding: tenant.amountRounding as Rounding, month: notice.month });
  if (parsed.lines.length === 0) throw new UserError("この列の選び方では、読み取れる行がありませんでした。見出しの行と列を確かめてください");

  const next: NoticeBatchSummary = {
    ...summary,
    headerIndex,
    columns: input.columns,
    fromSaved: false,
    problem: null,
    skipped: parsed.skipped,
    fileTotal: parsed.fileTotal,
    taxTotal: parsed.taxTotal,
    feeTotal: parsed.feeTotal,
    total: parsed.total,
    dates: parsed.dates,
    warnings: parsed.warnings,
    notes: [],
  };
  await db.transaction(async (tx) => {
    await tx.delete(s.paymentNoticeLines).where(and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.noticeId, notice.id)));
    await insertLines(tx as unknown as Db, tenantId, notice.id, parsed.lines);
    await tx
      .update(s.paymentNotices)
      .set({ total: parsed.total, feeDeducted: notice.feeDeducted || parsed.feeTotal })
      .where(and(eq(s.paymentNotices.id, notice.id), eq(s.paymentNotices.tenantId, tenantId)));
    await tx
      .update(s.importBatches)
      .set({ summary: next as unknown as Record<string, unknown>, rowCount: parsed.lines.length })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId)));
  });
  const client = notice.clientId ? await getClient(db, tenantId, notice.clientId).catch(() => null) : null;
  if (client) {
    const header = summary.rows[headerIndex] ?? [];
    await saveProfile(db, tenantId, client, { mapping: columnsToMapping(header, input.columns), headerSignature: headerSignature(header), options: { headerRow: headerIndex } });
  }
  const run = await runReconcile(db, tenantId, notice.id, userId);
  await audit(db, { tenantId, userId, action: "reconcile.columns", entity: "payment_notice", entityId: notice.id, detail: { headerRow: input.headerRow, columns: input.columns, lines: parsed.lines.length } });
  return { lineCount: parsed.lines.length, run };
}

// ---------------------------------------------------------------- 行の当て方を決める（覚える）

/** 案件の別名に足す（ほかの案件がすでにその名前で当たるときは足さない）。足したら true */
async function learnProjectAlias(db: Db, tenantId: string, projectId: string, raw: string, projects: ProjectRef[]): Promise<boolean> {
  const text = raw.trim();
  const p = projects.find((x) => x.id === projectId);
  if (!p || !text || text.length > 60) return false;
  const self = matchName(text, toCandidates([p]));
  if (self && self.how !== "partial") return false;
  const other = matchName(text, toCandidates(projects.filter((x) => x.id !== projectId)));
  if (other && other.how !== "partial") return false;
  await db
    .update(s.projects)
    .set({ aliases: [...p.aliases, text] })
    .where(and(eq(s.projects.id, p.id), eq(s.projects.tenantId, tenantId)));
  p.aliases = [...p.aliases, text];
  return true;
}

async function learnDriverAlias(db: Db, tenantId: string, driverId: string, raw: string, drivers: DriverRef[]): Promise<boolean> {
  const text = raw.trim();
  const d = drivers.find((x) => x.id === driverId);
  if (!d || !text || text.length > 60) return false;
  const self = matchName(text, toCandidates([d]));
  if (self && self.how !== "partial") return false;
  const other = matchName(text, toCandidates(drivers.filter((x) => x.id !== driverId)));
  if (other && other.how !== "partial") return false;
  await db
    .update(s.drivers)
    .set({ aliases: [...d.aliases, text], updatedAt: new Date() })
    .where(and(eq(s.drivers.id, d.id), eq(s.drivers.tenantId, tenantId)));
  return true;
}

export type LineMappingInput = { noticeId: string; key: string; target: LineTarget | "auto" };

/**
 * 同じ名前の行（品目）をまとめて、案件・追加の料金・対象外のどれかに決める。
 * 決めたことは元請ごとに覚え、案件なら別名にも足す（翌月から自動で当たる）。auto は覚えた決め方を消して、名前の照合に戻す。
 */
export async function setLineMapping(db: Db, tenantId: string, userId: string | null, input: LineMappingInput): Promise<{ lines: number; aliasAdded: boolean; run: RunResult }> {
  const ctx = await loadContext(db, tenantId, input.noticeId);
  const targets = ctx.lines.filter((l) => lineKey(l.rawProject) === input.key);
  if (targets.length === 0) throw new UserError("その行が見つかりません。画面を読み込み直してください");
  if (!ctx.client) throw new UserError("このお支払通知の元請が見つかりません（削除されたかもしれません）。元請を選んで上げ直してください");

  let projectId: string | null = null;
  let aliasAdded = false;
  if (input.target.startsWith("project:")) {
    projectId = input.target.slice("project:".length);
    // 会社の案件か確かめる（画面から来た id をそのまま信じない）
    if (!ctx.projects.some((p) => p.id === projectId)) throw new UserError("その案件が見つかりません。画面を読み込み直してください");
  } else if (input.target !== "extra" && input.target !== "ignore" && input.target !== "auto") {
    throw new UserError("選び方が正しくありません");
  }

  const { lineMap } = profileOptions(ctx.profile);
  const nextMap = { ...lineMap };
  if (input.target === "auto") delete nextMap[input.key];
  else nextMap[input.key] = input.target;

  await db
    .update(s.paymentNoticeLines)
    .set({ projectId })
    .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), inArray(s.paymentNoticeLines.id, targets.map((l) => l.id))));
  await saveProfile(db, tenantId, ctx.client, { options: { lineMap: nextMap } });
  if (projectId) aliasAdded = await learnProjectAlias(db, tenantId, projectId, targets[0].rawProject, ctx.projects);

  const run = await runReconcile(db, tenantId, input.noticeId, userId);
  await audit(db, {
    tenantId,
    userId,
    action: "reconcile.line_mapping",
    entity: "payment_notice",
    entityId: input.noticeId,
    detail: { raw: targets[0].rawProject, target: input.target, lines: targets.length, aliasAdded },
  });
  return { lines: targets.length, aliasAdded, run };
}

export type DriverMappingInput = { noticeId: string; key: string; driverId: string | "none" | "auto" };

export async function setDriverMapping(db: Db, tenantId: string, userId: string | null, input: DriverMappingInput): Promise<{ lines: number; aliasAdded: boolean }> {
  const ctx = await loadContext(db, tenantId, input.noticeId);
  const targets = ctx.lines.filter((l) => l.rawDriver && lineKey(l.rawDriver) === input.key);
  if (targets.length === 0) throw new UserError("その名前の行が見つかりません。画面を読み込み直してください");
  if (!ctx.client) throw new UserError("このお支払通知の元請が見つかりません。元請を選んで上げ直してください");
  const isId = input.driverId !== "none" && input.driverId !== "auto";
  if (isId && !ctx.drivers.some((d) => d.id === input.driverId)) throw new UserError("そのドライバーが見つかりません。画面を読み込み直してください");

  const { driverMap } = profileOptions(ctx.profile);
  const nextMap = { ...driverMap };
  if (input.driverId === "auto") delete nextMap[input.key];
  else nextMap[input.key] = input.driverId;
  await saveProfile(db, tenantId, ctx.client, { options: { driverMap: nextMap } });

  let driverId: string | null = isId ? input.driverId : null;
  if (input.driverId === "auto") driverId = matchName(targets[0].rawDriver ?? "", toCandidates(ctx.drivers))?.id ?? null;
  await db
    .update(s.paymentNoticeLines)
    .set({ driverId })
    .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), inArray(s.paymentNoticeLines.id, targets.map((l) => l.id))));
  const aliasAdded = isId ? await learnDriverAlias(db, tenantId, input.driverId, targets[0].rawDriver ?? "", ctx.drivers) : false;
  await runReconcile(db, tenantId, input.noticeId, userId);
  await audit(db, { tenantId, userId, action: "reconcile.driver_mapping", entity: "payment_notice", entityId: input.noticeId, detail: { raw: targets[0].rawDriver, driverId: input.driverId, lines: targets.length, aliasAdded } });
  return { lines: targets.length, aliasAdded };
}

// ---------------------------------------------------------------- 入金の記録・状態・削除

export async function updateNoticeMeta(db: Db, tenantId: string, userId: string | null, input: { noticeId: string; paidOn: string | null; feeDeducted: number }): Promise<void> {
  const notice = await getNotice(db, tenantId, input.noticeId);
  if (input.paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new UserError("入金日の形が正しくありません");
  if (!Number.isInteger(input.feeDeducted) || input.feeDeducted < 0) throw new UserError("差し引かれた手数料は 0 以上の円で入れてください");
  await db
    .update(s.paymentNotices)
    .set({ paidOn: input.paidOn, feeDeducted: input.feeDeducted })
    .where(and(eq(s.paymentNotices.id, notice.id), eq(s.paymentNotices.tenantId, tenantId)));
  await audit(db, { tenantId, userId, action: "reconcile.notice_meta", entity: "payment_notice", entityId: notice.id, detail: { paidOn: input.paidOn, feeDeducted: input.feeDeducted } });
}

export async function setItemStatus(db: Db, tenantId: string, userId: string | null, input: { itemId: string; status: ItemStatus; note: string | null }): Promise<{ noticeId: string }> {
  const rows = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.id, input.itemId)))
    .limit(1);
  const item = rows[0];
  if (!item) throw new UserError("その差が見つかりません。突き合わせ直したため消えたかもしれません。画面を読み込み直してください");
  await db
    .update(s.reconciliationItems)
    .set({ status: input.status, note: input.note })
    .where(and(eq(s.reconciliationItems.id, item.id), eq(s.reconciliationItems.tenantId, tenantId)));
  await audit(db, { tenantId, userId, action: "reconcile.item_status", entity: "reconciliation_item", entityId: item.id, detail: { from: item.status, to: input.status, note: input.note, label: item.label, diff: item.diff } });
  return { noticeId: item.noticeId };
}

/** 問い合わせ文から：選んだ差のうち「未対応」を「問い合わせ済み」にする */
export async function markItemsAsked(db: Db, tenantId: string, userId: string | null, input: { noticeId: string; itemIds: string[] }): Promise<number> {
  await getNotice(db, tenantId, input.noticeId);
  if (input.itemIds.length === 0) return 0;
  const updated = await db
    .update(s.reconciliationItems)
    .set({ status: "asked" })
    .where(
      and(
        eq(s.reconciliationItems.tenantId, tenantId),
        eq(s.reconciliationItems.noticeId, input.noticeId),
        eq(s.reconciliationItems.status, "open"),
        inArray(s.reconciliationItems.id, input.itemIds),
      ),
    )
    .returning({ id: s.reconciliationItems.id });
  await audit(db, { tenantId, userId, action: "reconcile.items_asked", entity: "payment_notice", entityId: input.noticeId, detail: { itemIds: updated.map((u) => u.id) } });
  return updated.length;
}

export async function deleteNotice(db: Db, tenantId: string, userId: string | null, noticeId: string): Promise<{ month: string }> {
  const notice = await getNotice(db, tenantId, noticeId);
  const items = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
  await db.transaction(async (tx) => {
    await tx.delete(s.paymentNotices).where(and(eq(s.paymentNotices.id, noticeId), eq(s.paymentNotices.tenantId, tenantId)));
    await tx
      .update(s.importBatches)
      .set({ status: "discarded" })
      .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, "payment_notice"), batchOf(noticeId)));
  });
  await audit(db, {
    tenantId,
    userId,
    action: "reconcile.notice_delete",
    entity: "payment_notice",
    entityId: noticeId,
    detail: {
      clientId: notice.clientId,
      month: notice.month,
      fileName: notice.fileName,
      total: notice.total,
      items: items.map((i) => ({ kind: i.kind, label: i.label, diff: i.diff, status: i.status, note: i.note })),
    },
  });
  return { month: notice.month };
}

// ---------------------------------------------------------------- 画面用の読み出し

export type ItemView = {
  /** 保存した差の id（まだ保存していない差は null） */
  id: string | null;
  key: string;
  kind: ItemKind;
  status: ItemStatus;
  note: string | null;
  projectId: string | null;
  driverId: string | null;
  driverName: string | null;
  label: string;
  unit: string | null;
  ourQty: number | null;
  theirQty: number | null;
  ourPrice: number | null;
  theirPrice: number | null;
  ourAmount: number;
  theirAmount: number;
  diff: number;
  split: boolean;
  mixedPrices: boolean;
  confirmedExtra: boolean;
};

export type LineGroupView = {
  key: string;
  raw: string;
  count: number;
  qty: number | null;
  price: number | null;
  amount: number;
  role: LineRole;
  projectId: string | null;
  projectName: string | null;
  /** 当たった案件が、ほかの元請（または元請なし）の案件か */
  otherClient: boolean;
  /** 覚えた決め方で当たっているか（auto に戻せる） */
  remembered: boolean;
  suggestedProjectId: string | null;
};

export type DriverGroupView = { key: string; raw: string; count: number; driverId: string | null; driverName: string | null; remembered: boolean };

export type NoticeView = {
  notice: typeof s.paymentNotices.$inferSelect;
  client: { id: string; name: string } | null;
  tenantName: string;
  /** 保存した差（状態とメモを変えられる） */
  items: ItemView[];
  /**
   * 画面に並べる差：保存した結果が今の記録と同じなら items、違えば今の記録で出した差（状態とメモは同じ鍵の保存から）。
   * 違うときは「突き合わせ直す」まで状態を変えられない
   */
  display: ItemView[];
  live: CompareResult;
  stale: boolean;
  totals: ReturnType<typeof sumDiffs> & { settledCount: number; settledNet: number };
  facts: ReceivingFact[];
  lineGroups: LineGroupView[];
  driverGroups: DriverGroupView[];
  projects: { id: string; name: string; own: boolean }[];
  drivers: { id: string; name: string; code: string | null }[];
  batch: {
    createdAt: Date;
    encoding: string;
    sheetName: string;
    sheetNames: string[];
    headerIndex: number;
    columns: ColumnMap;
    fromSaved: boolean;
    rows: string[][];
    rowsTruncated: boolean;
    problem: string | null;
    skipped: SkippedRow[];
    fileTotal: number | null;
    taxTotal: number;
    feeTotal: number;
    total: number;
    dates: ParsedNotice["dates"];
    warnings: string[];
    notes: string[];
  } | null;
};

function toItemView(row: typeof s.reconciliationItems.$inferSelect, live: Map<string, CompareItem>, driverNames: Map<string, string>, all: (typeof s.reconciliationItems.$inferSelect)[]): ItemView {
  const key = itemKey(row.kind, row.projectId, row.label);
  const l = live.get(key);
  const split = row.projectId !== null && (row.kind === "qty" || row.kind === "price") && all.some((o) => o.id !== row.id && o.projectId === row.projectId && (o.kind === "qty" || o.kind === "price"));
  return {
    id: row.id,
    key,
    kind: row.kind as ItemKind,
    status: row.status as ItemStatus,
    note: row.note,
    projectId: row.projectId,
    driverId: row.driverId,
    driverName: row.driverId ? (driverNames.get(row.driverId) ?? null) : null,
    label: row.label,
    unit: l?.unit ?? null,
    ourQty: row.ourQty,
    theirQty: row.theirQty,
    ourPrice: row.ourPrice,
    theirPrice: row.theirPrice,
    ourAmount: row.ourAmount,
    theirAmount: row.theirAmount,
    diff: row.diff,
    split,
    mixedPrices: l?.mixedPrices ?? false,
    confirmedExtra: l?.confirmedExtra ?? false,
  };
}

/** 当たらなかった品目に近い案件（名前の 2 文字ずつの重なりが 4 割以上。その元請の案件を少し優先） */
function suggestProject(raw: string, clientId: string | null, projects: ProjectRef[]): string | null {
  const norm = normalizeName(raw);
  if (!norm) return null;
  // 追加の料金らしい名前は、料金の案件だけから探す（無ければ「追加の料金」を選んでもらう）
  const pool = isChargeName(raw) ? projects.filter((p) => isChargeName(p.name)) : projects;
  let best: { id: string; score: number } | null = null;
  for (const p of pool) {
    const keys = [p.name, ...p.aliases].map(normalizeName).filter(Boolean);
    const score = Math.max(0, ...keys.map((k) => similarity(norm, k))) + (clientId !== null && p.clientId === clientId ? 0.05 : 0);
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.score >= 0.4 ? best.id : null;
}

const KIND_ORDER: Record<string, number> = { missing: 0, qty: 1, price: 2, amount: 3, extra: 4 };

export async function loadNoticeView(db: Db, tenantId: string, noticeId: string): Promise<NoticeView> {
  const ctx = await loadContext(db, tenantId, noticeId);
  const resolved = resolveAll(ctx);
  const live = compareFromContext(ctx, resolved);
  const [rows, batch] = await Promise.all([
    db
      .select()
      .from(s.reconciliationItems)
      .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)))
      .orderBy(asc(s.reconciliationItems.createdAt)),
    latestBatch(db, tenantId, noticeId),
  ]);
  const liveByKey = new Map(live.items.map((i) => [i.key, i]));
  const driverNames = new Map(ctx.drivers.map((d) => [d.id, d.name]));
  const projectById = new Map(ctx.projects.map((p) => [p.id, p]));
  const units = new Map(ctx.projects.map((p) => [p.id, p.unit]));
  const items = rows
    .map((r) => {
      const v = toItemView(r, liveByKey, driverNames, rows);
      if (!v.unit && r.projectId) v.unit = units.get(r.projectId) ?? null;
      return v;
    })
    .sort((a, b) => Number(a.kind === "extra") - Number(b.kind === "extra") || a.label.localeCompare(b.label, "ja") || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const persisted = new Set(rows.map((r) => `${itemKey(r.kind, r.projectId, r.label)}=${r.diff}`));
  const current = new Set(live.items.map((i) => `${i.key}=${i.diff}`));
  const stale = ctx.lines.length > 0 && (persisted.size !== current.size || [...current].some((k) => !persisted.has(k)));

  const savedByKey = new Map(items.map((i) => [i.key, i]));
  const display: ItemView[] = stale
    ? live.items.map((l) => {
        const saved = savedByKey.get(l.key);
        return {
          ...l,
          id: null,
          status: saved?.status ?? "open",
          note: saved?.note ?? null,
          driverName: l.driverId ? (driverNames.get(l.driverId) ?? null) : null,
        };
      })
    : items;
  const unsettled = display.filter((i) => isUnsettled(i.status));
  const settled = display.filter((i) => !isUnsettled(i.status));

  const { lineMap, driverMap } = profileOptions(ctx.profile);
  const groups = new Map<string, ResolvedLine[]>();
  for (const l of resolved) {
    const k = lineKey(l.rawProject);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const lineGroups: LineGroupView[] = [...groups.entries()].map(([key, ls]) => {
    const first = ls[0];
    const role = first.role;
    const allQty = ls.every((l) => l.qty !== null);
    const qty = allQty ? Math.round(ls.reduce((a, l) => a + (l.qty ?? 0), 0) * 10000) / 10000 : null;
    const prices = [...new Set(ls.map((l) => l.unitPrice))];
    const projectId = role === "project" ? first.projectId : null;
    return {
      key,
      raw: ls.map((l) => l.rawProject.trim()).sort()[0],
      count: ls.length,
      qty,
      price: prices.length === 1 ? (prices[0] ?? null) : null,
      amount: ls.reduce((a, l) => a + l.amount, 0),
      role,
      projectId,
      projectName: projectId ? (projectById.get(projectId)?.name ?? null) : null,
      otherClient: projectId !== null && projectById.get(projectId)?.clientId !== ctx.notice.clientId,
      remembered: Boolean(lineMap[key]),
      suggestedProjectId: role === "unknown" ? suggestProject(first.rawProject, ctx.notice.clientId, ctx.projects) : null,
    };
  });
  lineGroups.sort((a, b) => Number(b.role === "unknown") - Number(a.role === "unknown") || a.raw.localeCompare(b.raw, "ja"));

  const dgroups = new Map<string, ResolvedLine[]>();
  for (const l of resolved) {
    if (!l.rawDriver?.trim()) continue;
    const k = lineKey(l.rawDriver);
    dgroups.set(k, [...(dgroups.get(k) ?? []), l]);
  }
  const driverGroups: DriverGroupView[] = [...dgroups.entries()]
    .map(([key, ls]) => ({
      key,
      raw: ls[0].rawDriver!.trim(),
      count: ls.length,
      driverId: ls[0].driverId,
      driverName: ls[0].driverId ? (driverNames.get(ls[0].driverId) ?? null) : null,
      remembered: Boolean(driverMap[key]),
    }))
    .sort((a, b) => Number(a.driverId !== null) - Number(b.driverId !== null) || a.raw.localeCompare(b.raw, "ja"));

  const bs = batch ? (batch.summary as unknown as NoticeBatchSummary) : null;
  return {
    notice: ctx.notice,
    client: ctx.client ? { id: ctx.client.id, name: ctx.client.name } : null,
    tenantName: ctx.tenant.name,
    items,
    display,
    live,
    stale,
    totals: { ...sumDiffs(unsettled), settledCount: settled.length, settledNet: settled.reduce((a, i) => a + i.diff, 0) },
    facts: receivingFacts({ month: ctx.notice.month, paidOn: ctx.notice.paidOn, feeDeducted: ctx.notice.feeDeducted }),
    lineGroups,
    driverGroups,
    projects: ctx.projects
      .map((p) => ({ id: p.id, name: p.name, own: ctx.notice.clientId !== null && p.clientId === ctx.notice.clientId }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name, "ja")),
    drivers: ctx.drivers.map((d) => ({ id: d.id, name: d.name, code: d.code })),
    batch:
      batch && bs
        ? {
            createdAt: batch.createdAt,
            encoding: bs.encoding,
            sheetName: bs.sheetName,
            sheetNames: bs.sheetNames ?? [],
            headerIndex: bs.headerIndex,
            columns: bs.columns,
            fromSaved: bs.fromSaved,
            rows: bs.rows ?? [],
            rowsTruncated: bs.rowsTruncated,
            problem: bs.problem,
            skipped: bs.skipped ?? [],
            fileTotal: bs.fileTotal,
            taxTotal: bs.taxTotal ?? 0,
            feeTotal: bs.feeTotal ?? 0,
            total: bs.total ?? 0,
            dates: bs.dates ?? null,
            warnings: bs.warnings ?? [],
            notes: bs.notes ?? [],
          }
        : null,
  };
}

// ---------------------------------------------------------------- 月の一覧

export type MonthClientRow = {
  clientId: string | null;
  clientName: string;
  /** その元請の案件の、当社の記録（受注単価 × 数量）の合計。通知があれば、通知の行が当たった案件も含む */
  ourTotal: number;
  projectsWithWork: number;
  notice: {
    id: string;
    fileName: string;
    createdAt: Date;
    total: number;
    /** 読み取れた行の数（0 なら列を選び直す必要がある） */
    lineCount: number;
    paidOn: string | null;
    feeDeducted: number;
    short: number;
    shortCount: number;
    over: number;
    overCount: number;
    openCount: number;
    askedCount: number;
    settledCount: number;
    /** 保存した差と、今の記録で出した差が違う（突き合わせ直すとよい） */
    stale: boolean;
  } | null;
};

/** その月の元請ごとのまとめ（差は今の記録で計算し、状態は保存したものを使う） */
export async function listMonth(db: Db, tenantId: string, month: string): Promise<{ rows: MonthClientRow[]; clients: { id: string; name: string }[] }> {
  assertMonth(month);
  const report = await loadReport(db, tenantId, month, month, { includeEmpty: true });
  const rows: MonthClientRow[] = report.cells.map((c) => ({
    clientId: c.clientId,
    clientName: c.clientName,
    ourTotal: c.ourTotal,
    projectsWithWork: c.projectsWithWork,
    notice: c.notice
      ? {
          id: c.notice.id,
          fileName: c.notice.fileName,
          createdAt: c.notice.createdAt,
          total: c.notice.total,
          lineCount: c.notice.lineCount,
          paidOn: c.notice.paidOn,
          feeDeducted: c.notice.feeDeducted,
          short: c.short,
          shortCount: c.shortCount,
          over: c.over,
          overCount: c.overCount,
          openCount: c.open,
          askedCount: c.asked,
          settledCount: c.settled,
          stale: c.stale,
        }
      : null,
  }));
  return { rows, clients: report.clients };
}

// ---------------------------------------------------------------- 突合レポート（何か月分か）

export type ReportItem = CompareItem & { status: ItemStatus; note: string | null };

export type ReportCell = {
  clientId: string | null;
  clientName: string;
  month: string;
  ourTotal: number;
  /** その元請の案件のうち、当社に稼働がある数 */
  projectsWithWork: number;
  notice: {
    id: string;
    fileName: string;
    createdAt: Date;
    /** お支払通知の合計（取り込んだ行の合計） */
    total: number;
    /** 突き合わせの対象（対象外を除く） */
    theirTotal: number;
    lineCount: number;
    paidOn: string | null;
    feeDeducted: number;
  } | null;
  items: ReportItem[];
  short: number;
  shortCount: number;
  over: number;
  overCount: number;
  open: number;
  asked: number;
  settled: number;
  facts: ReceivingFact[];
  stale: boolean;
};

export type Report = {
  tenantName: string;
  clients: { id: string; name: string }[];
  from: string;
  to: string;
  months: string[];
  cells: ReportCell[];
  totals: { short: number; shortCount: number; over: number; overCount: number; notices: number; missingNotices: number };
};

/** from・to は YYYY-MM-01。長すぎる期間は 12 か月までにする */
export function reportRange(fromParam: string | undefined, toParam: string | undefined, defaultTo: string): { from: string; to: string } {
  const ok = (v?: string) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? `${v}-01` : null);
  let to = ok(toParam) ?? defaultTo;
  let from = ok(fromParam) ?? shiftMonth(to, -2);
  if (from > to) [from, to] = [to, from];
  if (shiftMonth(from, 11) < to) from = shiftMonth(to, -11);
  return { from, to };
}

export async function loadReport(db: Db, tenantId: string, from: string, to: string, opts: { includeEmpty?: boolean } = {}): Promise<Report> {
  assertMonth(from);
  assertMonth(to);
  const months: string[] = [];
  for (let m = from; m <= to && months.length < 12; m = shiftMonth(m, 1)) months.push(m);

  const [tenant, clients, projects, drivers, work, notices, profiles] = await Promise.all([
    getTenant(db, tenantId),
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)).orderBy(asc(s.clients.name)),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ id: s.drivers.id, name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    db
      .select({ month: s.workEntries.month, projectId: s.workEntries.projectId, driverId: s.workEntries.driverId, qty: s.workEntries.qty })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), gte(s.workEntries.month, from), lte(s.workEntries.month, to))),
    db
      .select()
      .from(s.paymentNotices)
      .where(and(eq(s.paymentNotices.tenantId, tenantId), gte(s.paymentNotices.month, from), lte(s.paymentNotices.month, to))),
    db.select().from(s.mappingProfiles).where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "payment_notice"))),
  ]);
  const ids = notices.map((n) => n.id);
  const [lines, stored] = ids.length
    ? await Promise.all([
        db.select().from(s.paymentNoticeLines).where(and(eq(s.paymentNoticeLines.tenantId, tenantId), inArray(s.paymentNoticeLines.noticeId, ids))),
        db.select().from(s.reconciliationItems).where(and(eq(s.reconciliationItems.tenantId, tenantId), inArray(s.reconciliationItems.noticeId, ids))),
      ])
    : [[], []];
  const rounding = tenant.amountRounding as Rounding;
  const projectRefs: ProjectRef[] = projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, aliases: p.aliases, active: p.active, unit: p.unit, billRate: p.billRate }));
  const cmpProjects = projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, unit: p.unit, billRate: p.billRate }));

  const lineMapFor = (clientId: string | null): Record<string, LineTarget> => {
    if (!clientId) return {};
    const c = clients.find((x) => x.id === clientId);
    const p = profiles.find((x) => (x.options as ProfileOptions)?.clientId === clientId) ?? (c ? profiles.find((x) => x.name === c.name) : undefined);
    return (p?.options as ProfileOptions)?.lineMap ?? {};
  };

  const cells: ReportCell[] = [];
  const clientList: { id: string | null; name: string }[] = [...clients.map((c) => ({ id: c.id as string | null, name: c.name }))];
  if (notices.some((n) => !n.clientId || !clients.some((c) => c.id === n.clientId))) clientList.push({ id: null, name: "（元請が削除されています）" });

  for (const c of clientList) {
    for (const month of months) {
      const monthWork = work.filter((w) => w.month === month);
      const notice = notices.find((n) => n.month === month && (c.id ? n.clientId === c.id : !n.clientId || !clients.some((x) => x.id === n.clientId)));
      const qty = new Map<string, number>();
      for (const w of monthWork) if (w.qty > 0) qty.set(w.projectId, (qty.get(w.projectId) ?? 0) + w.qty);
      const own = projects.filter((p) => c.id && p.clientId === c.id && (qty.get(p.id) ?? 0) > 0);
      if (!notice) {
        const ourTotal = own.reduce((a, p) => a + roundYen((qty.get(p.id) ?? 0) * p.billRate, rounding), 0);
        if (ourTotal === 0 && !opts.includeEmpty) continue;
        cells.push({ clientId: c.id, clientName: c.name, month, ourTotal, projectsWithWork: own.length, notice: null, items: [], short: 0, shortCount: 0, over: 0, overCount: 0, open: 0, asked: 0, settled: 0, facts: [], stale: false });
        continue;
      }
      const lineMap = lineMapFor(notice.clientId);
      const nLines: CmpLine[] = lines
        .filter((l) => l.noticeId === notice.id)
        .map((l) => {
          // まだ突き合わせていない通知も、突き合わせたときと同じ当て方で数える（DB には書かない）
          const { projectId, role } = resolveLine(l, lineMap, notice.clientId, projectRefs);
          return { id: l.id, rawProject: l.rawProject, rawDriver: l.rawDriver, projectId, driverId: l.driverId, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, role };
        });
      const result = compareNotice({ clientId: notice.clientId, projects: cmpProjects, drivers, work: monthWork, lines: nLines, rounding });
      const saved = stored.filter((i) => i.noticeId === notice.id);
      const savedByKey = new Map(saved.map((i) => [itemKey(i.kind, i.projectId, i.label), i]));
      const items: ReportItem[] = nLines.length === 0 ? [] : result.items.map((it) => ({ ...it, status: (savedByKey.get(it.key)?.status as ItemStatus) ?? "open", note: savedByKey.get(it.key)?.note ?? null }));
      const unsettled = items.filter((i) => isUnsettled(i.status));
      const d = sumDiffs(unsettled);
      const stale = nLines.length > 0 && (saved.length !== result.items.length || result.items.some((it) => savedByKey.get(it.key)?.diff !== it.diff));
      cells.push({
        clientId: c.id,
        clientName: c.name,
        month,
        ourTotal: nLines.length ? result.ourTotal : own.reduce((a, p) => a + roundYen((qty.get(p.id) ?? 0) * p.billRate, rounding), 0),
        projectsWithWork: own.length,
        notice: {
          id: notice.id,
          fileName: notice.fileName,
          createdAt: notice.createdAt,
          total: notice.total || nLines.reduce((a, l) => a + l.amount, 0),
          theirTotal: result.theirTotal,
          lineCount: nLines.length,
          paidOn: notice.paidOn,
          feeDeducted: notice.feeDeducted,
        },
        items,
        short: d.short,
        shortCount: d.shortCount,
        over: d.over,
        overCount: d.overCount,
        open: items.filter((i) => i.status === "open").length,
        asked: items.filter((i) => i.status === "asked").length,
        settled: items.filter((i) => !isUnsettled(i.status)).length,
        facts: receivingFacts({ month, paidOn: notice.paidOn, feeDeducted: notice.feeDeducted }),
        stale,
      });
    }
  }
  const withNotice = cells.filter((x) => x.notice);
  return {
    tenantName: tenant.name,
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    from,
    to,
    months,
    cells,
    totals: {
      short: withNotice.reduce((a, x) => a + x.short, 0),
      shortCount: withNotice.reduce((a, x) => a + x.shortCount, 0),
      over: withNotice.reduce((a, x) => a + x.over, 0),
      overCount: withNotice.reduce((a, x) => a + x.overCount, 0),
      notices: withNotice.length,
      missingNotices: cells.filter((x) => !x.notice).length,
    },
  };
}

/** レポートの期間の既定（今の月を含む 3 か月） */
export function defaultReportParams(month: string): { from: string; to: string } {
  return { from: monthParam(shiftMonth(month, -2)), to: monthParam(month) };
}
