import "server-only";
import { createHash } from "node:crypto";
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
import { readSnapshot } from "~/server/statements-core";
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
import { assignLines, joinFileNames, SAME_CONTENT_OVERRIDE, sameLines } from "~/server/features/reconcile/files";
import { assertDemoUploadBudget, demoFileProblem } from "~/server/features/import/demo-budget";
import { isChargeName, isUnsettled, lineKey, WAIT_ALERT_DAYS, waitingDays, type ItemKind, type ItemStatus } from "~/server/features/reconcile/labels";
import type { LetterItem } from "~/server/features/reconcile/letter";
import { selectPeriodWork, type ComparePeriod, type PeriodWork } from "~/server/features/reconcile/period";
import { periodOf } from "~/server/calc/statement";

export { lineKey };
export type { ComparePeriod };

/**
 * 元請の支払通知との突合（取り込み・突き合わせ・問い合わせの状態・レポート）。
 * - すべて (db, tenantId, …) を受け取り、会社で絞る。画面から来た id は必ず会社のものか確かめる
 * - 列の対応と、行の当て方（案件・追加の料金・対象外）は mapping_profiles（kind='payment_notice'、名前＝元請名）に覚える
 * - 上げたファイルの中身（文字の表）は import_batches（kind='payment_notice'）の summary に残し、列を選び直せるようにする
 * - 差は reconciliation_items に保存する。作り直しても、同じ鍵（種類＋案件＋名前）の状態とメモは残す
 * - 当社の記録の受注単価は、締めた月なら明細の写し（締めたときの単価）、開いている月なら今の案件の単価
 * - 1 通のお支払通知（元請 × 月）は、何通かのファイルを足して作れる（営業所ごとに届くとき）。どの行がどのファイルのものかは
 *   取り込みの記録の summary.lineIds に残し、ファイルごとに入れ替え・外すができる。同じファイル・同じ中身は二重に足さない
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
  /** このファイルから入れた行の id（何通かを足したお支払通知で、ファイルごとに入れ替え・外すため） */
  lineIds?: string[];
  /** ファイルの中身の記録が無い（前の版・見本で入れた行を、足すときに 1 つのファイルとして残したもの）。列を選び直せない */
  recordOnly?: boolean;
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

function appliedFilesOf(tenantId: string, noticeId: string) {
  return and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.kind, "payment_notice"), eq(s.importBatches.status, "applied"), batchOf(noticeId));
}

/** そのお支払通知のファイル 1 つ（fileId が無ければ、いちばん新しいもの）。表の中身（summary）ごと読む */
async function fileBatch(db: Db, tenantId: string, noticeId: string, fileId?: string | null) {
  const rows = await db
    .select()
    .from(s.importBatches)
    .where(fileId ? and(appliedFilesOf(tenantId, noticeId), eq(s.importBatches.id, fileId)) : appliedFilesOf(tenantId, noticeId))
    .orderBy(desc(s.importBatches.createdAt), desc(s.importBatches.id))
    .limit(1);
  return rows[0] ?? null;
}

type NoticeFileRow = {
  id: string;
  fileName: string;
  fileHash: string | null;
  createdAt: Date;
  lineIds: string[] | null;
  /** そのファイルの振込手数料の行の合計（外すとき・入れ替えるときに、差し引かれた手数料から引く） */
  feeTotal: number;
};

function jsonValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** そのお支払通知を作っているファイル（取り込んだ順）。行の id の一覧だけを読み、表の中身（rows）は読まない */
async function noticeFiles(db: Db, tenantId: string, noticeId: string): Promise<NoticeFileRow[]> {
  const rows = await db
    .select({
      id: s.importBatches.id,
      fileName: s.importBatches.fileName,
      fileHash: s.importBatches.fileHash,
      createdAt: s.importBatches.createdAt,
      lineIds: sql<unknown>`${s.importBatches.summary}->'lineIds'`,
      feeTotal: sql<unknown>`${s.importBatches.summary}->>'feeTotal'`,
    })
    .from(s.importBatches)
    .where(appliedFilesOf(tenantId, noticeId))
    .orderBy(asc(s.importBatches.createdAt), asc(s.importBatches.id));
  return rows.map((r) => {
    const ids = jsonValue(r.lineIds);
    const fee = Number(r.feeTotal ?? 0);
    return {
      id: r.id,
      fileName: r.fileName,
      fileHash: r.fileHash,
      createdAt: r.createdAt,
      lineIds: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : null,
      feeTotal: Number.isFinite(fee) ? fee : 0,
    };
  });
}

async function noticeLines(db: Db, tenantId: string, noticeId: string) {
  return db
    .select({
      id: s.paymentNoticeLines.id,
      rawProject: s.paymentNoticeLines.rawProject,
      rawDriver: s.paymentNoticeLines.rawDriver,
      qty: s.paymentNoticeLines.qty,
      unitPrice: s.paymentNoticeLines.unitPrice,
      amount: s.paymentNoticeLines.amount,
    })
    .from(s.paymentNoticeLines)
    .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.noticeId, noticeId)));
}

async function deleteLines(db: Db, tenantId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) {
    await db.delete(s.paymentNoticeLines).where(and(eq(s.paymentNoticeLines.tenantId, tenantId), inArray(s.paymentNoticeLines.id, ids.slice(i, i + 1000))));
  }
}

async function setFileLineIds(db: Db, tenantId: string, fileId: string, lineIds: string[]): Promise<void> {
  await db
    .update(s.importBatches)
    .set({ summary: sql`${s.importBatches.summary} || ${JSON.stringify({ lineIds })}::jsonb`, rowCount: lineIds.length })
    .where(and(eq(s.importBatches.id, fileId), eq(s.importBatches.tenantId, tenantId)));
}

/**
 * お支払通知の合計とファイル名を、今の行とファイルから出し直す（何通かを足したときは、全部の行の合計・ファイル名を「、」でつなぐ）。
 * ファイルの記録が無いお支払通知（前の版）は、ファイル名を変えない
 */
async function refreshNotice(db: Db, tenantId: string, noticeId: string, extra: { feeDeducted?: number } = {}): Promise<void> {
  const [sum] = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${s.paymentNoticeLines.amount}), 0)` })
    .from(s.paymentNoticeLines)
    .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.noticeId, noticeId)));
  const names = joinFileNames((await noticeFiles(db, tenantId, noticeId)).map((f) => f.fileName));
  await db
    .update(s.paymentNotices)
    .set({ total: Number(sum?.total ?? 0), ...(names ? { fileName: names } : {}), ...extra })
    .where(and(eq(s.paymentNotices.id, noticeId), eq(s.paymentNotices.tenantId, tenantId)));
}

/** 同じ元請・同じ月のお支払通知を、2 つの画面から同時に変えないように押さえる（取り込み・足す・外す・列の選び直し） */
async function lockNotice(tx: Db, tenantId: string, clientKey: string, month: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payment_notice:${tenantId}:${clientKey}:${month}`}, 0))`);
}

/**
 * 締めた月の受注単価（明細の写しに残っている、締めたときの単価）。月 → 案件 → 単価。
 * 締めたあとで案件の単価を上げ下げしても、締めた月の「当社の記録」は変わらないようにする（利益の画面と同じ考え方）。
 * 写しが無い月（明細を作らずに締めた月）は入れない（今の単価で数える）
 */
async function closedBillRates(db: Db, tenantId: string, months: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (months.length === 0) return out;
  const closes = await db
    .select({ month: s.monthCloses.month })
    .from(s.monthCloses)
    .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.status, "closed"), inArray(s.monthCloses.month, months)));
  if (closes.length === 0) return out;
  const rows = await db
    .select({ month: s.statements.month, snapshot: s.statements.snapshot })
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), inArray(s.statements.month, closes.map((c) => c.month))));
  for (const r of rows) {
    const draft = readSnapshot(r);
    const rates = out.get(r.month) ?? new Map<string, number>();
    for (const l of draft.lines ?? []) {
      if (l.projectId && typeof l.billRate === "number" && Number.isFinite(l.billRate) && !rates.has(l.projectId)) rates.set(l.projectId, l.billRate);
    }
    out.set(r.month, rates);
  }
  return out;
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
  /** billRate は、締めた月なら締めたときの単価に置き換えてある */
  projects: ProjectRef[];
  drivers: DriverRef[];
  /** その月と前後の月の稼働（元請の締めの期間で比べるときに、日付で拾い直す） */
  work: PeriodWork[];
  lines: (typeof s.paymentNoticeLines.$inferSelect)[];
  profile: ProfileRow | null;
  /** 締めた月の写しの単価を使った案件の数（0 なら今の単価） */
  snapshotRates: number;
};

async function loadContext(db: Db, tenantId: string, noticeId: string): Promise<NoticeContext> {
  const notice = await getNotice(db, tenantId, noticeId);
  const [tenant, clientRows, projects, drivers, work, lines, closedRates] = await Promise.all([
    getTenant(db, tenantId),
    notice.clientId ? db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, notice.clientId))) : Promise.resolve([]),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)).orderBy(asc(s.projects.name)),
    db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)).orderBy(asc(s.drivers.name)),
    db
      .select({ month: s.workEntries.month, projectId: s.workEntries.projectId, driverId: s.workEntries.driverId, qty: s.workEntries.qty, workDate: s.workEntries.workDate })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), inArray(s.workEntries.month, [shiftMonth(notice.month, -1), notice.month, shiftMonth(notice.month, 1)]))),
    db
      .select()
      .from(s.paymentNoticeLines)
      .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.noticeId, noticeId))),
    closedBillRates(db, tenantId, [notice.month]),
  ]);
  const client = clientRows[0] ?? null;
  const profile = await findProfile(db, tenantId, client);
  const rates = closedRates.get(notice.month) ?? new Map<string, number>();
  return {
    tenant,
    notice,
    client,
    projects: projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, aliases: p.aliases, active: p.active, unit: p.unit, billRate: rates.get(p.id) ?? p.billRate })),
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, code: d.code, kana: d.kana, aliases: d.aliases, active: d.active })),
    work,
    lines,
    profile,
    snapshotRates: rates.size,
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
  // 同じ名前の行は同じ当て方になるので、名前ごとに 1 回だけ照合する（1 行ずつの明細でも重くしない）
  const lineCache = new Map<string, { projectId: string | null; role: LineRole }>();
  const driverCache = new Map<string, string | null>();
  return ctx.lines.map((l) => {
    const lk = `${l.rawProject}\u0000${l.projectId ?? ""}`;
    let hit = lineCache.get(lk);
    if (!hit) {
      hit = resolveLine(l, lineMap, ctx.notice.clientId, ctx.projects);
      lineCache.set(lk, hit);
    }
    const dk = `${l.rawDriver ?? ""}\u0000${l.driverId ?? ""}`;
    let driverId = driverCache.get(dk);
    if (driverId === undefined) {
      driverId = resolveDriver(l.rawDriver, l.driverId, driverMap, ctx.drivers);
      driverCache.set(dk, driverId);
    }
    return { ...l, projectId: hit.projectId, driverId, role: hit.role };
  });
}

function toCmpLine(l: ResolvedLine): CmpLine {
  return { id: l.id, rawProject: l.rawProject, rawDriver: l.rawDriver, projectId: l.projectId, driverId: l.driverId, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, role: l.role };
}

/** 突き合わせる案件（その元請の案件 ＋ 通知の行が当たった案件）。締めの期間で比べるとき、この案件の稼働に日付があるかを見る */
function scopeProjectIds(clientId: string | null, projects: { id: string; clientId: string | null }[], lines: { role: LineRole; projectId: string | null }[]): Set<string> {
  const ids = new Set(projects.filter((p) => clientId !== null && p.clientId === clientId).map((p) => p.id));
  for (const l of lines) if (l.role === "project" && l.projectId) ids.add(l.projectId);
  return ids;
}

/**
 * 突き合わせ（元請の締め日が当社と違い、稼働に日付があれば、元請の締めの期間の稼働で比べる）。
 * 受注単価は、お支払通知の月の単価（締めた月なら、その月の明細の写しの単価）で数える
 */
function compareWithPeriod(ctx: NoticeContext, resolved: ResolvedLine[]): { result: CompareResult; period: ComparePeriod } {
  const { work, period } = selectPeriodWork({
    month: ctx.notice.month,
    tenantClosingDay: ctx.tenant.closingDay,
    clientClosingDay: ctx.client ? ctx.client.closingDay : null,
    projectIds: scopeProjectIds(ctx.notice.clientId, ctx.projects, resolved),
    work: ctx.work,
  });
  const result = compareNotice({
    clientId: ctx.notice.clientId,
    projects: ctx.projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, unit: p.unit, billRate: p.billRate })),
    drivers: ctx.drivers.map((d) => ({ id: d.id, name: d.name })),
    work,
    lines: resolved.map(toCmpLine),
    rounding: ctx.tenant.amountRounding as Rounding,
  });
  return { result, period };
}

/** 行を案件・ドライバーに当て直し（覚えた当て方 → 名前の照合）、変わった行だけ保存する（当て先ごとにまとめて書く） */
async function autoMatch(db: Db, tenantId: string, ctx: NoticeContext): Promise<{ changed: number; resolved: ResolvedLine[] }> {
  const resolved = resolveAll(ctx);
  const byTarget = new Map<string, { projectId: string | null; driverId: string | null; ids: string[] }>();
  for (let i = 0; i < resolved.length; i++) {
    const before = ctx.lines[i];
    const after = resolved[i];
    if (before.projectId === after.projectId && before.driverId === after.driverId) continue;
    const k = `${after.projectId ?? ""}|${after.driverId ?? ""}`;
    const g = byTarget.get(k) ?? { projectId: after.projectId, driverId: after.driverId, ids: [] };
    g.ids.push(after.id);
    byTarget.set(k, g);
  }
  let changed = 0;
  for (const g of byTarget.values()) {
    for (let i = 0; i < g.ids.length; i += 1000) {
      const ids = g.ids.slice(i, i + 1000);
      await db
        .update(s.paymentNoticeLines)
        .set({ projectId: g.projectId, driverId: g.driverId })
        .where(and(eq(s.paymentNoticeLines.tenantId, tenantId), inArray(s.paymentNoticeLines.id, ids)));
      changed += ids.length;
    }
  }
  ctx.lines = resolved;
  return { changed, resolved };
}

// ---------------------------------------------------------------- 突き合わせ（保存）

export type RunResult = {
  skipped: boolean;
  items: number;
  created: number;
  updated: number;
  removed: number;
  reopened: number;
  /** 問い合わせ済みの差が、突き合わせ直したら無くなった（直したお支払通知が届いた など）→ 「解決」にして残した数 */
  settledByRerun: number;
  matchedLines: number;
};

/** 問い合わせ済みの差が、突き合わせ直して無くなったときにメモへ足す言葉 */
export const GONE_NOTE = "突き合わせ直したら、この差は無くなりました（直したお支払通知か、当社の記録の直しによるもの）。";

/** 保存した差が「今の突き合わせには出てこない、片付いた記録」か（履歴として残す） */
function isSettledHistory(row: { status: string }, liveKeys: Set<string>, key: string): boolean {
  return !isUnsettled(row.status) && !liveKeys.has(key);
}

/**
 * 突き合わせて reconciliation_items を作り直す。
 * 同じ鍵（種類＋案件＋名前）の差は、状態とメモを残す。ただし「解決」「了承」にした差の金額が変わったら「未対応」に戻す。
 * 今回の突き合わせに出てこなくなった差は：
 *   - 未対応のものは消す（扱いを決めていないので失うものが無い。メモがあれば操作の記録に残す）
 *   - 問い合わせ済みのものは「解決」にして残す（直したお支払通知が届いた、がいちばん多い。取り戻せた額をあとで入れられる）
 *   - 解決・了承のものは、そのまま履歴として残す（取り戻せたお金の記録を消さない）
 * お支払通知に行が 1 つも無いとき（列が分からなかったとき）は、差を作らない（今ある状態も消さない）。
 */
export async function runReconcile(db: Db, tenantId: string, noticeId: string, userId?: string | null): Promise<RunResult> {
  const ctx = await loadContext(db, tenantId, noticeId);
  const { changed: matchedLines, resolved } = await autoMatch(db, tenantId, ctx);
  if (ctx.lines.length === 0) return { skipped: true, items: 0, created: 0, updated: 0, removed: 0, reopened: 0, settledByRerun: 0, matchedLines };
  const { result, period } = compareWithPeriod(ctx, resolved);
  const out: RunResult = { skipped: false, items: result.items.length, created: 0, updated: 0, removed: 0, reopened: 0, settledByRerun: 0, matchedLines };

  await db.transaction(async (tx) => {
    // 同じ通知を 2 つの画面から同時に突き合わせても、差が二重にできないように、通知の行を押さえてから読む
    await tx
      .select({ id: s.paymentNotices.id })
      .from(s.paymentNotices)
      .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.id, noticeId)))
      .for("update");
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
        // 未対応に戻すときは、片付けた日も外す（取り戻せた額は、決め直すときの参考に残す）
        .set({ ...values, ...(reopen ? { status: "open", resolvedAt: null } : {}) })
        .where(and(eq(s.reconciliationItems.id, prev.id), eq(s.reconciliationItems.tenantId, tenantId)));
      out.updated++;
    }
    const vanished = existing.filter((e) => !seen.has(itemKey(e.kind, e.projectId, e.label)) && !drop.includes(e));
    const keep = vanished.filter((e) => e.status !== "open");
    for (const e of keep) {
      if (e.status !== "asked") continue;
      await tx
        .update(s.reconciliationItems)
        .set({ status: "resolved", resolvedAt: new Date(), note: e.note ? `${e.note}\n${GONE_NOTE}` : GONE_NOTE })
        .where(and(eq(s.reconciliationItems.id, e.id), eq(s.reconciliationItems.tenantId, tenantId)));
      out.settledByRerun++;
    }
    const removed = [...drop, ...vanished.filter((e) => e.status === "open")];
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
        detail: { items: removed.map((e) => ({ kind: e.kind, label: e.label, diff: e.diff, status: e.status, note: e.note, recoveredAmount: e.recoveredAmount })) },
      });
    }
  });
  await audit(db, {
    tenantId,
    userId,
    action: "reconcile.run",
    entity: "payment_notice",
    entityId: noticeId,
    detail: { ...out, ourTotal: result.ourTotal, theirTotal: result.theirTotal, period: { mode: period.mode, from: period.from, to: period.to, fallback: period.fallback } },
  });
  return out;
}

// ---------------------------------------------------------------- 取り込み

export type ImportNoticeInput = {
  clientId: string;
  month: string;
  fileName: string;
  bytes: Uint8Array;
  /** 同じ元請・同じ月のお支払通知がすでにあるとき：全部のファイルを、このファイル 1 つに入れ替える（直したお支払通知が届いたとき） */
  replace: boolean;
  /** 同じ元請・同じ月のお支払通知がすでにあるとき：このファイルの行を足して、合計で突き合わせる（営業所ごとなど、同じ月に何通も届くとき） */
  add?: boolean;
  /** 何通かを足したお支払通知のうち、このファイル（取り込みの記録の id）だけを入れ替える（1 通だけ直したものが届いたとき） */
  replaceFileId?: string | null;
  /** 足す・1 つだけ入れ替えるとき、ほかのファイルと行の中身が同じでも足す（別の営業所の分で、たまたま同じ数のとき。同じファイルそのものは足せない） */
  allowSameContent?: boolean;
};
export type ImportNoticeResult = {
  noticeId: string;
  lineCount: number;
  replaced: boolean;
  /** 同じ月のお支払通知に、このファイルの行を足した */
  added: boolean;
  /** 1 つのファイルだけを入れ替えたとき、入れ替えたファイルの名前 */
  replacedFile: string | null;
  problem: string | null;
  warnings: string[];
  run: RunResult | null;
};

type ImportMode = "new" | "replace" | "add" | "replaceFile";

function importMode(input: ImportNoticeInput): ImportMode {
  if (input.replaceFileId) return "replaceFile";
  if (input.add) return "add";
  return input.replace ? "replace" : "new";
}

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

/** 元請の締めの期間（締め日が月末なら null。お支払通知の日付が期間の外かを見るのに使う） */
function clientPeriod(client: { closingDay: number } | null, month: string): { from: string; to: string } | null {
  if (!client || client.closingDay === 0 || client.closingDay >= 31) return null;
  return periodOf(month, client.closingDay);
}

function assertMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) throw new UserError("月の形が正しくありません");
}

/**
 * 足す・1 つのファイルだけ入れ替える前の確かめと片付け（取り込みのトランザクションの中で呼ぶ）。
 * - 同じファイル（ハッシュ）・同じ中身の行のファイルが、もう入っていれば止める（二重に数えない）
 * - どの行がどのファイルのものかを残す（前の版のファイル・ファイルの記録が無い行も、ここで 1 つのファイルとして残す）
 * - 入れ替えるときは、そのファイルの行を消し、取り込みの記録を「入れ替えた」にする
 */
async function prepareFileChange(
  db: Db,
  tenantId: string,
  notice: typeof s.paymentNotices.$inferSelect,
  opts: { mode: "add" | "replaceFile"; fileHash: string; targetId: string | null; lines: ParsedNotice["lines"]; allowSameContent: boolean },
): Promise<{ replacedFile: string | null; removedFee: number }> {
  const files = await noticeFiles(db, tenantId, notice.id);
  const current = await noticeLines(db, tenantId, notice.id);
  const { byFile, unclaimed } = assignLines(
    files,
    current.map((l) => l.id),
  );
  const target = opts.targetId ? files.find((f) => f.id === opts.targetId) : undefined;
  if (opts.mode === "replaceFile" && !target) {
    throw new UserError("入れ替えるファイルが見つかりません。すでに外したか、入れ替えたのかもしれません。画面を読み込み直してください");
  }
  if (opts.mode === "add" && current.length === 0) {
    throw new UserError("今のお支払通知の行を読み取れていません。先に結果の画面で列を選ぶか、「入れ替える」で上げ直してから、足してください");
  }
  const others = files.filter((f) => f.id !== target?.id);
  const sameFile = others.find((f) => f.fileHash !== null && f.fileHash === opts.fileHash);
  if (sameFile) {
    throw new UserError(`同じファイルが、もう入っています（${sameFile.fileName}）。二重に数えないように止めました。直したお支払通知なら「入れ替える」を使ってください。`);
  }
  const byId = new Map(current.map((l) => [l.id, l]));
  const groups = [...others.map((f) => ({ name: f.fileName, ids: byFile.get(f.id) ?? [] })), ...(unclaimed.length > 0 ? [{ name: notice.fileName, ids: unclaimed }] : [])];
  const dup = opts.allowSameContent ? undefined : groups.find((g) => sameLines(g.ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l)), opts.lines));
  if (dup) {
    throw new UserError(
      `このファイルの行は、もう入っているお支払通知（${dup.name}）と中身が同じです。二重に数えないように止めました。直したお支払通知なら「入れ替える」を使ってください。別の営業所の分で、たまたま同じ中身のときは「${SAME_CONTENT_OVERRIDE}」にチェックを入れて、もう一度上げてください。`,
    );
  }
  // どの行がどのファイルのものかを残す（ファイルごとに入れ替え・外すため）
  for (const f of files) if (!f.lineIds) await setFileLineIds(db, tenantId, f.id, byFile.get(f.id) ?? []);
  if (unclaimed.length > 0) {
    // ファイルの記録が無いお支払通知（前の版・デモの見本）の行：今の行を 1 つのファイルとして残す（中身の表は無いので、列は選び直せない）
    await db.insert(s.importBatches).values({
      tenantId,
      month: notice.month,
      kind: "payment_notice",
      fileName: notice.fileName,
      rowCount: unclaimed.length,
      status: "applied",
      summary: { noticeId: notice.id, clientId: notice.clientId, recordOnly: true, lineIds: unclaimed, total: unclaimed.reduce((a, id) => a + (byId.get(id)?.amount ?? 0), 0) },
      createdAt: notice.createdAt,
    });
  }
  if (!target) return { replacedFile: null, removedFee: 0 };
  await deleteLines(db, tenantId, byFile.get(target.id) ?? []);
  await db
    .update(s.importBatches)
    .set({ status: "discarded" })
    .where(and(eq(s.importBatches.id, target.id), eq(s.importBatches.tenantId, tenantId)));
  return { replacedFile: target.fileName, removedFee: target.feeTotal };
}

/**
 * お支払通知のファイルを取り込む。同じ元請・同じ月のものがあれば：
 * - replace：全部のファイルを、このファイルに入れ替える
 * - add：このファイルの行を足す（営業所ごとなど。合計で突き合わせる）
 * - replaceFileId：そのファイルだけを入れ替える
 * のどれかを選んだときだけ変える。どれでも、問い合わせの状態とメモは残る（同じ差の鍵で引き継ぐ）
 */
export async function importNotice(db: Db, tenantId: string, userId: string | null, input: ImportNoticeInput): Promise<ImportNoticeResult> {
  assertMonth(input.month);
  const mode = importMode(input);
  const client = await getClient(db, tenantId, input.clientId);
  if (!client.active) {
    // 取引をやめた元請：新しい月の通知は上げない。すでにある月の通知を、直したものに入れ替える・足すのはよい
    // （取引をやめたあとで、前の月の直したお支払通知が届くことがあるため。結果の画面の「上げ直す」から）
    const had =
      mode !== "new"
        ? await db
            .select({ id: s.paymentNotices.id })
            .from(s.paymentNotices)
            .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.clientId, client.id), eq(s.paymentNotices.month, input.month)))
            .limit(1)
        : [];
    if (had.length === 0) {
      throw new UserError(
        `${client.name}は「取引をやめた元請」になっています。新しい月のお支払通知を上げるときは、設定の「元請」で有効に戻してください。これまでのお支払通知は、そのまま見られます（直したお支払通知は、その結果の画面の「上げ直す」から入れ替えられます）。`,
      );
    }
  }
  const tenant = await getTenant(db, tenantId);
  if (input.bytes.byteLength === 0) throw new UserError("ファイルが空です。元請から届いたファイルを選んでください");
  if (input.bytes.byteLength > MAX_NOTICE_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）。不要なシートを消すか、CSV にしてから上げてください");
  // デモ（来た人ごとの架空の会社）では、置けるファイルの大きさと数を小さくする（小さな無料の DB をいっぱいにしない）
  const demoProblem = demoFileProblem(input.bytes.byteLength);
  if (demoProblem) throw new UserError(demoProblem);

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
  const parsed: ParsedNotice | null = pick.problem
    ? null
    : parseNoticeRows(rows, pick.headerIndex, pick.det.columns, { rounding, month: input.month, period: clientPeriod(client, input.month) });
  if (parsed && parsed.lines.length === 0) {
    throw new UserError("読み取れる行がありませんでした。見出しの下に品目と金額（または数量と単価）が並んでいるか確かめてください");
  }

  const findExisting = async (q: Db) =>
    (
      await q
        .select()
        .from(s.paymentNotices)
        .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.clientId, client.id), eq(s.paymentNotices.month, input.month)))
        .orderBy(asc(s.paymentNotices.createdAt))
        .limit(1)
    )[0];
  const alreadyError = (fileName: string) =>
    new UserError(
      `${client.name}の${input.month.slice(0, 4)}年${Number(input.month.slice(5, 7))}月分のお支払通知は、すでに上げてあります（${fileName}）。直したお支払通知なら「入れ替える」、営業所ごとなど同じ月に届いた別のお支払通知なら「足す」を選んでください。問い合わせの状態とメモは残ります。`,
    );
  const missingError = () => new UserError("入れ替えるお支払通知が見つかりません。すでに削除されたかもしれません。画面を読み込み直してください");
  const found = await findExisting(db);
  if (found && mode === "new") throw alreadyError(found.fileName);
  if (!found && mode === "replaceFile") throw missingError();
  if (found && (mode === "add" || mode === "replaceFile") && pick.problem) {
    // 列の分からないファイルを足すと、その分の行が 0 のまま突き合わせてしまう（ほかのファイルの数字だけで問い合わせ文ができる）
    throw new UserError(
      "このファイルは、どの列が品目・金額か分かりませんでした。足す・1 つのファイルだけ入れ替えるときは、前に上げたファイルと同じ形（見出しの並び）のファイルにしてください。形がまったく違うときは、元請を営業所ごとに分けて登録すると、それぞれで列を選べます。",
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
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  await assertDemoUploadBudget(db, tenantId, Buffer.byteLength(JSON.stringify(summary)) + Buffer.byteLength(JSON.stringify(lines)));

  const { noticeId, prev, replacedFile } = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    // 同じ元請・同じ月のお支払通知は 1 通（何通かのファイルを足せる）。同時に 2 回上げても 2 通にならないように、その組み合わせを押さえてから確かめ直す
    await lockNotice(txDb, tenantId, client.id, input.month);
    const prev = await findExisting(txDb);
    if (prev && mode === "new") throw alreadyError(prev.fileName);
    if (!prev && mode === "replaceFile") throw missingError();
    let id: string;
    let replacedFile: string | null = null;
    let feeDeducted: number;
    if (prev && (mode === "add" || mode === "replaceFile")) {
      id = prev.id;
      const change = await prepareFileChange(txDb, tenantId, prev, { mode, fileHash, targetId: input.replaceFileId ?? null, lines, allowSameContent: input.allowSameContent === true });
      replacedFile = change.replacedFile;
      // 差し引かれた手数料：入れ替えたファイルの手数料の行の分を引き、このファイルの分を足す（手で直した額は、その差だけ動く）
      feeDeducted = Math.max(0, prev.feeDeducted - change.removedFee) + summary.feeTotal;
    } else if (prev) {
      id = prev.id;
      feeDeducted = prev.feeDeducted || summary.feeTotal;
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
      feeDeducted = summary.feeTotal;
    }
    const lineIds = await insertLines(txDb, tenantId, id, lines);
    await tx.insert(s.importBatches).values({
      tenantId,
      month: input.month,
      kind: "payment_notice",
      fileName: input.fileName,
      fileHash,
      rowCount: lines.length,
      status: "applied",
      summary: { ...summary, noticeId: id, lineIds } as unknown as Record<string, unknown>,
      createdBy: userId,
    });
    await refreshNotice(txDb, tenantId, id, { feeDeducted });
    return { noticeId: id, prev: prev ?? null, replacedFile };
  });

  if (!pick.problem) {
    await saveProfile(db, tenantId, client, {
      mapping: columnsToMapping(rows[pick.headerIndex] ?? [], pick.det.columns),
      headerSignature: headerSignature(rows[pick.headerIndex] ?? []),
      options: { headerRow: pick.headerIndex },
    });
  }
  const added = Boolean(prev) && mode === "add";
  const run = pick.problem ? null : await runReconcile(db, tenantId, noticeId, userId);
  await audit(db, {
    tenantId,
    userId,
    action: prev && !added ? "reconcile.notice_replace" : "reconcile.notice_import",
    entity: "payment_notice",
    entityId: noticeId,
    detail: {
      clientId: client.id,
      month: input.month,
      fileName: input.fileName,
      lines: lines.length,
      total: summary.total,
      encoding: read.encoding,
      problem: pick.problem,
      ...(prev && (mode === "add" || mode === "replaceFile") ? { mode } : {}),
      ...(replacedFile ? { replacedFile } : {}),
    },
  });
  return {
    noticeId,
    lineCount: lines.length,
    replaced: Boolean(prev) && !added,
    added,
    replacedFile,
    problem: pick.problem,
    warnings: [...summary.notes, ...summary.warnings],
    run,
  };
}

async function insertLines(db: Db, tenantId: string, noticeId: string, lines: ParsedNotice["lines"]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    const rows = await db
      .insert(s.paymentNoticeLines)
      .values(chunk.map((l) => ({ tenantId, noticeId, rawProject: l.rawProject, rawDriver: l.rawDriver, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount })))
      .returning({ id: s.paymentNoticeLines.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

/**
 * 何通かを足したお支払通知から、ファイルを 1 つ外す（まちがえて足したとき）。
 * 残りのファイルで突き合わせ直す。ファイルが 1 つだけのときは外せない（削除か入れ替えを使う）
 */
export async function removeNoticeFile(db: Db, tenantId: string, userId: string | null, input: { noticeId: string; fileId: string }): Promise<{ fileName: string; run: RunResult }> {
  const notice = await getNotice(db, tenantId, input.noticeId);
  const done = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    await lockNotice(txDb, tenantId, notice.clientId ?? notice.id, notice.month);
    const fresh = await getNotice(txDb, tenantId, notice.id);
    const files = await noticeFiles(txDb, tenantId, notice.id);
    const target = files.find((f) => f.id === input.fileId);
    if (!target) throw new UserError("そのファイルが見つかりません。すでに外したのかもしれません。画面を読み込み直してください");
    if (files.length < 2) {
      throw new UserError("ファイルが 1 つだけのお支払通知からは外せません。直したファイルがあれば「入れ替える」、要らなければ「このお支払通知を削除する」を使ってください");
    }
    const current = await noticeLines(txDb, tenantId, notice.id);
    const { byFile } = assignLines(
      files,
      current.map((l) => l.id),
    );
    const ids = byFile.get(target.id) ?? [];
    await deleteLines(txDb, tenantId, ids);
    await tx
      .update(s.importBatches)
      .set({ status: "discarded" })
      .where(and(eq(s.importBatches.id, target.id), eq(s.importBatches.tenantId, tenantId)));
    await refreshNotice(txDb, tenantId, notice.id, { feeDeducted: Math.max(0, fresh.feeDeducted - target.feeTotal) });
    const [after] = await tx
      .select({ total: s.paymentNotices.total })
      .from(s.paymentNotices)
      .where(and(eq(s.paymentNotices.id, notice.id), eq(s.paymentNotices.tenantId, tenantId)));
    return { fileName: target.fileName, lines: ids.length, total: after?.total ?? 0 };
  });
  const run = await runReconcile(db, tenantId, notice.id, userId);
  // 操作の記録は「取り込み直した」として残す（何を外したかは detail に）
  await audit(db, {
    tenantId,
    userId,
    action: "reconcile.notice_replace",
    entity: "payment_notice",
    entityId: notice.id,
    detail: { clientId: notice.clientId, month: notice.month, fileName: `${done.fileName} を外した`, removedFile: done.fileName, removedLines: done.lines, total: done.total, mode: "removeFile" },
  });
  return { fileName: done.fileName, run };
}

/**
 * 見本（架空の A物流 の 10 月分）を入れる先の元請。デモの会社（架空）だけ。無ければ null。
 * 本番の会社では出さない（見本は同じ月の通知を入れ替えるので、名前の似た実在の元請（例：「JA物流」）の通知を消さないように）
 */
export async function findSampleClient(db: Db, tenantId: string): Promise<{ id: string; name: string } | null> {
  const tenant = await getTenant(db, tenantId);
  const isDemo = tenant.settings?.demo === true || process.env.DEMO_MODE === "1";
  if (!isDemo) return null;
  const clients = await db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId));
  const hit = matchName("A物流", clients.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })));
  return hit ? { id: hit.id, name: hit.name } : null;
}

export async function readSampleNotice(): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(path.join(process.cwd(), "public", "samples", SAMPLE_NOTICE_FILE)));
}

// ---------------------------------------------------------------- 列を選び直す

/** fileId：何通かを足したお支払通知で、どのファイルの列を選び直すか（無ければ、いちばん新しいファイル） */
export type ColumnsInput = { noticeId: string; headerRow: number; columns: ColumnMap; fileId?: string | null };

export async function updateNoticeColumns(db: Db, tenantId: string, userId: string | null, input: ColumnsInput): Promise<{ lineCount: number; run: RunResult }> {
  const notice = await getNotice(db, tenantId, input.noticeId);
  const batch = await fileBatch(db, tenantId, notice.id, input.fileId ?? null);
  if (!batch && input.fileId) throw new UserError("そのファイルが見つかりません。外したか、入れ替えたのかもしれません。画面を読み込み直してください");
  const summary = batch?.summary as unknown as NoticeBatchSummary | undefined;
  if (!batch || !summary || summary.recordOnly || !Array.isArray(summary.rows)) {
    throw new UserError("このお支払通知には、読み取ったファイルの記録がありません。列を選び直すには、ファイルをもう一度上げてください");
  }
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
  const client = notice.clientId ? await getClient(db, tenantId, notice.clientId).catch(() => null) : null;
  const parsed = parseNoticeRows(summary.rows, headerIndex, input.columns, {
    rounding: tenant.amountRounding as Rounding,
    month: notice.month,
    period: clientPeriod(client, notice.month),
  });
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
    const txDb = tx as unknown as Db;
    await lockNotice(txDb, tenantId, notice.clientId ?? notice.id, notice.month);
    // 入れ替えるのは、このファイルの行だけ（何通かを足したお支払通知の、ほかのファイルの行は残す）
    const files = await noticeFiles(txDb, tenantId, notice.id);
    if (!files.some((f) => f.id === batch.id)) throw new UserError("そのファイルが見つかりません。外したか、入れ替えたのかもしれません。画面を読み込み直してください");
    const current = (await noticeLines(txDb, tenantId, notice.id)).map((l) => l.id);
    const mine = files.length <= 1 ? current : (assignLines(files, current).byFile.get(batch.id) ?? []);
    await deleteLines(txDb, tenantId, mine);
    const lineIds = await insertLines(txDb, tenantId, notice.id, parsed.lines);
    await tx
      .update(s.importBatches)
      .set({ summary: { ...next, lineIds } as unknown as Record<string, unknown>, rowCount: parsed.lines.length })
      .where(and(eq(s.importBatches.id, batch.id), eq(s.importBatches.tenantId, tenantId)));
    await refreshNotice(txDb, tenantId, notice.id, { feeDeducted: notice.feeDeducted || parsed.feeTotal });
  });
  if (client) {
    const header = summary.rows[headerIndex] ?? [];
    await saveProfile(db, tenantId, client, { mapping: columnsToMapping(header, input.columns), headerSignature: headerSignature(header), options: { headerRow: headerIndex } });
  }
  const run = await runReconcile(db, tenantId, notice.id, userId);
  await audit(db, {
    tenantId,
    userId,
    action: "reconcile.columns",
    entity: "payment_notice",
    entityId: notice.id,
    detail: { headerRow: input.headerRow, columns: input.columns, lines: parsed.lines.length, fileName: batch.fileName },
  });
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

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export async function updateNoticeMeta(db: Db, tenantId: string, userId: string | null, input: { noticeId: string; paidOn: string | null; feeDeducted: number }): Promise<void> {
  const notice = await getNotice(db, tenantId, input.noticeId);
  if (input.paidOn !== null && !isRealDate(input.paidOn)) throw new UserError("入金日の形が正しくありません（例：2026-12-25）");
  if (!Number.isInteger(input.feeDeducted) || input.feeDeducted < 0 || input.feeDeducted > 2_000_000_000) throw new UserError("差し引かれた手数料は 0 以上の円で入れてください");
  await db
    .update(s.paymentNotices)
    .set({ paidOn: input.paidOn, feeDeducted: input.feeDeducted })
    .where(and(eq(s.paymentNotices.id, notice.id), eq(s.paymentNotices.tenantId, tenantId)));
  await audit(db, { tenantId, userId, action: "reconcile.notice_meta", entity: "payment_notice", entityId: notice.id, detail: { paidOn: input.paidOn, feeDeducted: input.feeDeducted } });
}

export type ItemStatusInput = {
  itemId: string;
  status: ItemStatus;
  note: string | null;
  /** 「解決」のとき：取り戻せた額（入金された・次の支払に上乗せされると決まった額。差と違ってよい）。わからなければ null */
  recoveredAmount?: number | null;
};

/** 「解決」にするのに足りないもの（取り戻せた額もメモも無い）を知らせる言葉 */
export function resolveNeeds(diff: number): string {
  return diff < 0
    ? "「解決」にするときは、取り戻せた額（円）か、どう片付いたかのメモのどちらかを入れてください（例：11月分に上乗せで入金／自社の記録を直した）"
    : "「解決」にするときは、どう片付いたかをメモに残してください（例：待機料の請求どおりと確認した）";
}

/**
 * 差の扱いを変える。問い合わせた日・片付けた日を残す（「返事待ち n 日」と、取り戻せたお金の記録に使う）。
 * - 「この金額で了承」は理由のメモが必須（あとで「なぜ受け入れたか」を説明できるように）
 * - 「解決」は、取り戻せた額（0 円以上。差と違ってよい）か、説明のメモ（例：自社の記録を直した）のどちらかが必須
 * - 取り戻せた額は「解決」で、受け取りが少ない可能性の差（マイナス）のときだけ残す
 */
export async function setItemStatus(db: Db, tenantId: string, userId: string | null, input: ItemStatusInput): Promise<{ noticeId: string }> {
  const rows = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.id, input.itemId)))
    .limit(1);
  const item = rows[0];
  if (!item) throw new UserError("その差が見つかりません。突き合わせ直したため消えたかもしれません。画面を読み込み直してください");
  const note = input.note?.trim() ? input.note.trim() : null;
  if (input.status === "accepted" && !note) {
    throw new UserError("「この金額で了承」にするときは、理由をメモに残してください（例：11/5 先方と電話。10月分はこの数で合意）");
  }
  const recovered = input.recoveredAmount ?? null;
  if (recovered !== null && (!Number.isInteger(recovered) || recovered < 0 || recovered > 2_000_000_000)) {
    throw new UserError("取り戻せた額は 0 以上の円で入れてください");
  }
  if (input.status === "resolved" && !note && !(item.diff < 0 && recovered !== null)) throw new UserError(resolveNeeds(item.diff));
  const now = new Date();
  const same = item.status === input.status;
  const values: Partial<typeof s.reconciliationItems.$inferInsert> = { status: input.status, note };
  if (input.status === "open") {
    Object.assign(values, { askedAt: null, resolvedAt: null });
  } else if (input.status === "asked") {
    // 未対応から問い合わせるときは今日から数える（突き合わせ直して未対応に戻った差の、前の問い合わせの日は使わない）。
    // 問い合わせ済みのまま・解決から戻したときは、前の問い合わせの日を残す
    Object.assign(values, { askedAt: item.status === "open" ? now : (item.askedAt ?? now), resolvedAt: null });
  } else {
    Object.assign(values, { resolvedAt: same && item.resolvedAt ? item.resolvedAt : now });
  }
  // 取り戻せた額：解決のときは入れた値（空なら前の値を消す）。ほかの扱いに変えたら外す
  values.recoveredAmount = input.status === "resolved" && item.diff < 0 ? recovered : null;
  await db
    .update(s.reconciliationItems)
    .set(values)
    .where(and(eq(s.reconciliationItems.id, item.id), eq(s.reconciliationItems.tenantId, tenantId)));
  await audit(db, {
    tenantId,
    userId,
    action: "reconcile.item_status",
    entity: "reconciliation_item",
    entityId: item.id,
    detail: { from: item.status, to: input.status, note, recoveredAmount: values.recoveredAmount ?? null, label: item.label, diff: item.diff },
  });
  return { noticeId: item.noticeId };
}

/** 問い合わせ文から：選んだ差のうち「未対応」を「問い合わせ済み」にする（問い合わせた日を残す） */
export async function markItemsAsked(db: Db, tenantId: string, userId: string | null, input: { noticeId: string; itemIds: string[] }): Promise<number> {
  await getNotice(db, tenantId, input.noticeId);
  if (input.itemIds.length === 0) return 0;
  const updated = await db
    .update(s.reconciliationItems)
    .set({ status: "asked", askedAt: new Date(), resolvedAt: null })
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
      items: items.map((i) => ({ kind: i.kind, label: i.label, diff: i.diff, status: i.status, note: i.note, recoveredAmount: i.recoveredAmount })),
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
  /** 問い合わせた日時・片付けた日時・取り戻せた額（保存した差だけ） */
  askedAt: Date | null;
  resolvedAt: Date | null;
  recoveredAmount: number | null;
  /** 差を最初に見つけた（保存した）日時。まだ保存していない差は null */
  createdAt: Date | null;
  /** 今の突き合わせにも出ている差か（false は、片付いたあとで差が無くなった履歴） */
  current: boolean;
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

export type NoticeBatchView = {
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
};

/** お支払通知を作っているファイル 1 つ（営業所ごとなど、何通かを足したときは複数） */
export type NoticeFileView = {
  id: string;
  fileName: string;
  createdAt: Date;
  lineCount: number;
  total: number;
  /** 読み取りの詳細（列を選び直せる）。ファイルの中身の記録が無い（前の版・見本の行）ときは null */
  detail: NoticeBatchView | null;
};

export type NoticeView = {
  notice: typeof s.paymentNotices.$inferSelect;
  /** closingDay：元請の締め日（0＝月末）。月末でなければ、暦の月で比べている旨を出す */
  client: { id: string; name: string; closingDay: number } | null;
  tenantName: string;
  /** 締めた月で、明細の写しの受注単価（締めたときの単価）を使った */
  snapshotRates: boolean;
  /** 比べた稼働の期間（元請の締め日が違えば、その締めの期間。日付が無ければ当社の月） */
  period: ComparePeriod;
  /** 保存した差（状態とメモを変えられる） */
  items: ItemView[];
  /**
   * 画面に並べる差：保存した結果が今の記録と同じなら items、違えば今の記録で出した差（状態とメモは同じ鍵の保存から）。
   * 違うときは「突き合わせ直す」まで状態を変えられない
   */
  display: ItemView[];
  live: CompareResult;
  stale: boolean;
  /** recovered：「解決」にした差で、取り戻せた額として入れた合計（確定。見込みの差とは足さない） */
  totals: ReturnType<typeof sumDiffs> & { settledCount: number; settledNet: number; recovered: number; recoveredCount: number };
  facts: ReceivingFact[];
  lineGroups: LineGroupView[];
  driverGroups: DriverGroupView[];
  projects: { id: string; name: string; own: boolean }[];
  drivers: { id: string; name: string; code: string | null }[];
  /** いちばん新しいファイルの読み取りの詳細（ファイルの記録が無ければ null） */
  batch: NoticeBatchView | null;
  /** お支払通知を作っているファイル（取り込んだ順。足したときは 2 つ以上） */
  files: NoticeFileView[];
};

function toBatchView(createdAt: Date, raw: unknown): NoticeBatchView | null {
  const bs = jsonValue(raw) as Partial<NoticeBatchSummary> | null;
  if (!bs || typeof bs !== "object" || bs.recordOnly || !bs.columns) return null;
  return {
    createdAt,
    encoding: bs.encoding ?? "",
    sheetName: bs.sheetName ?? "",
    sheetNames: bs.sheetNames ?? [],
    headerIndex: bs.headerIndex ?? 0,
    columns: bs.columns,
    fromSaved: bs.fromSaved ?? false,
    rows: bs.rows ?? [],
    rowsTruncated: bs.rowsTruncated ?? false,
    problem: bs.problem ?? null,
    skipped: bs.skipped ?? [],
    fileTotal: bs.fileTotal ?? null,
    taxTotal: bs.taxTotal ?? 0,
    feeTotal: bs.feeTotal ?? 0,
    total: bs.total ?? 0,
    dates: bs.dates ?? null,
    warnings: bs.warnings ?? [],
    notes: bs.notes ?? [],
  };
}

/** お支払通知のファイル（取り込んだ順）と読み取りの詳細。行の id の一覧（lineIds）は大きいので読まない */
async function loadNoticeFiles(db: Db, tenantId: string, noticeId: string): Promise<NoticeFileView[]> {
  const rows = await db
    .select({
      id: s.importBatches.id,
      fileName: s.importBatches.fileName,
      createdAt: s.importBatches.createdAt,
      rowCount: s.importBatches.rowCount,
      summary: sql<unknown>`${s.importBatches.summary} - 'lineIds'`,
    })
    .from(s.importBatches)
    .where(appliedFilesOf(tenantId, noticeId))
    .orderBy(asc(s.importBatches.createdAt), asc(s.importBatches.id));
  return rows.map((r) => {
    const summary = jsonValue(r.summary) as { total?: unknown } | null;
    const total = Number(summary?.total ?? 0);
    return { id: r.id, fileName: r.fileName, createdAt: r.createdAt, lineCount: r.rowCount, total: Number.isFinite(total) ? total : 0, detail: toBatchView(r.createdAt, summary) };
  });
}

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
    askedAt: row.askedAt,
    resolvedAt: row.resolvedAt,
    recoveredAmount: row.recoveredAmount,
    createdAt: row.createdAt,
    current: live.has(key),
  };
}

/** 取り戻せた額の合計（「解決」にした差だけ。確定したお金） */
function recoveredOf(list: { status: string; recoveredAmount: number | null }[]): { recovered: number; recoveredCount: number } {
  const done = list.filter((i) => i.status === "resolved" && i.recoveredAmount !== null && i.recoveredAmount > 0);
  return { recovered: done.reduce((a, i) => a + (i.recoveredAmount ?? 0), 0), recoveredCount: done.length };
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
  const { result: live, period } = compareWithPeriod(ctx, resolved);
  const [rows, files] = await Promise.all([
    db
      .select()
      .from(s.reconciliationItems)
      .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)))
      .orderBy(asc(s.reconciliationItems.createdAt)),
    loadNoticeFiles(db, tenantId, noticeId),
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
    .sort(
      (a, b) =>
        Number(!a.current) - Number(!b.current) ||
        Number(a.kind === "extra") - Number(b.kind === "extra") ||
        a.label.localeCompare(b.label, "ja") ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );

  // 保存した結果が今の記録と同じか：今の差がすべて同じ額で保存されていて、保存した未対応・問い合わせ済みの差が今もある
  // （片付いたあとで差が無くなった履歴は、今の突き合わせに出なくてよい）
  const liveKeys = new Set(live.items.map((i) => i.key));
  const rowKeys = rows.map((r) => itemKey(r.kind, r.projectId, r.label));
  const persistedByKey = new Map(rows.map((r, i) => [rowKeys[i], r]));
  const stale =
    ctx.lines.length > 0 &&
    (live.items.some((i) => persistedByKey.get(i.key)?.diff !== i.diff) ||
      rows.some((r, i) => !liveKeys.has(rowKeys[i]) && !isSettledHistory(r, liveKeys, rowKeys[i])) ||
      new Set(rowKeys).size !== rowKeys.length);

  const savedByKey = new Map(items.map((i) => [i.key, i]));
  const liveDisplay = live.items.map((l): ItemView => {
    const saved = savedByKey.get(l.key);
    return {
      ...l,
      id: null,
      status: saved?.status ?? "open",
      note: saved?.note ?? null,
      driverName: l.driverId ? (driverNames.get(l.driverId) ?? null) : null,
      askedAt: saved?.askedAt ?? null,
      resolvedAt: saved?.resolvedAt ?? null,
      recoveredAmount: saved?.recoveredAmount ?? null,
      createdAt: saved?.createdAt ?? null,
      current: true,
    };
  });
  // 古いときは今の記録で出した差を並べ、片付いた履歴はそのまま後ろに付ける
  const display: ItemView[] = stale ? [...liveDisplay, ...items.filter((i) => !i.current && !isUnsettled(i.status))] : items;
  const unsettled = display.filter((i) => isUnsettled(i.status));
  const settled = display.filter((i) => !isUnsettled(i.status));

  const { lineMap, driverMap } = profileOptions(ctx.profile);
  const groups = new Map<string, ResolvedLine[]>();
  for (const l of resolved) {
    const k = lineKey(l.rawProject);
    const arr = groups.get(k);
    if (arr) arr.push(l);
    else groups.set(k, [l]);
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
    const arr = dgroups.get(k);
    if (arr) arr.push(l);
    else dgroups.set(k, [l]);
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

  return {
    notice: ctx.notice,
    client: ctx.client ? { id: ctx.client.id, name: ctx.client.name, closingDay: ctx.client.closingDay } : null,
    tenantName: ctx.tenant.name,
    snapshotRates: ctx.snapshotRates > 0,
    period,
    items,
    display,
    live,
    stale,
    totals: { ...sumDiffs(unsettled), settledCount: settled.length, settledNet: settled.reduce((a, i) => a + i.diff, 0), ...recoveredOf(display) },
    facts: receivingFacts({ month: ctx.notice.month, paidOn: ctx.notice.paidOn, feeDeducted: ctx.notice.feeDeducted, periodEnd: clientPeriod(ctx.client, ctx.notice.month)?.to }),
    lineGroups,
    driverGroups,
    projects: ctx.projects
      .map((p) => ({ id: p.id, name: p.name, own: ctx.notice.clientId !== null && p.clientId === ctx.notice.clientId }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name, "ja")),
    drivers: ctx.drivers.map((d) => ({ id: d.id, name: d.name, code: d.code })),
    batch: files.length > 0 ? files[files.length - 1].detail : null,
    files,
  };
}


// ---------------------------------------------------------------- 月の一覧

export type MonthClientRow = {
  clientId: string | null;
  clientName: string;
  /** 取引中の元請か（取引をやめた元請は、お支払通知か稼働がある月だけ並べる） */
  clientActive: boolean;
  /** その元請の案件の、当社の記録（受注単価 × 数量）の合計。通知があれば、通知の行が当たった案件も含む */
  ourTotal: number;
  projectsWithWork: number;
  /** 比べた稼働の期間（元請の締め日が違えば、その締めの期間） */
  period: ComparePeriod | null;
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
    /** 取り戻せた額（確定）の合計 */
    recovered: number;
    /** 問い合わせてから 14 日を過ぎても返事待ちの差 */
    waitingLong: number;
    /** 受注単価が 0 円の案件の名前（当社の記録が出ない） */
    zeroRate: string[];
    /** 保存した差と、今の記録で出した差が違う（突き合わせ直すとよい） */
    stale: boolean;
  } | null;
};

/** その月の元請ごとのまとめ（差は今の記録で計算し、状態は保存したものを使う）。found は「見つけたお金」（確定と見込みを分けて） */
export async function listMonth(
  db: Db,
  tenantId: string,
  month: string,
  now: Date = new Date(),
): Promise<{ rows: MonthClientRow[]; clients: { id: string; name: string; active: boolean; closingDay: number }[]; found: FoundMoney }> {
  assertMonth(month);
  const report = await loadReport(db, tenantId, month, month, { includeEmpty: true });
  const rows: MonthClientRow[] = report.cells.map((c) => ({
    clientId: c.clientId,
    clientName: c.clientName,
    clientActive: c.clientActive ?? true,
    ourTotal: c.ourTotal,
    projectsWithWork: c.projectsWithWork,
    period: c.period ?? null,
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
          recovered: c.recovered,
          waitingLong: waitingLongOf(c.items, now),
          zeroRate: c.zeroRate,
          stale: c.stale,
        }
      : null,
  }));
  return { rows, clients: report.clients, found: foundMoneyFromReport(report, now) };
}

// ---------------------------------------------------------------- 突合レポート（何か月分か）

export type ReportItem = CompareItem & {
  status: ItemStatus;
  note: string | null;
  askedAt: Date | null;
  resolvedAt: Date | null;
  recoveredAmount: number | null;
  /** 今の突き合わせにも出ている差か（false は、片付いたあとで差が無くなった履歴） */
  current: boolean;
};

export type ReportCell = {
  clientId: string | null;
  clientName: string;
  /** 取引中の元請か（無ければ取引中として扱う） */
  clientActive?: boolean;
  month: string;
  ourTotal: number;
  /** その元請の案件のうち、当社に稼働がある数 */
  projectsWithWork: number;
  /** 比べた稼働の期間（元請の締め日が違えば、その締めの期間。日付が無ければ当社の月） */
  period?: ComparePeriod;
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
  /** 取り戻せた額（「解決」にして額を入れた差の合計。確定） */
  recovered: number;
  recoveredCount: number;
  /** 受注単価が 0 円の案件の名前 */
  zeroRate: string[];
  facts: ReceivingFact[];
  stale: boolean;
};

export type Report = {
  tenantName: string;
  /** closingDay：元請の締め日（0＝月末） */
  clients: { id: string; name: string; active: boolean; closingDay: number }[];
  from: string;
  to: string;
  months: string[];
  cells: ReportCell[];
  totals: { short: number; shortCount: number; over: number; overCount: number; notices: number; missingNotices: number; recovered: number; recoveredCount: number };
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
  // 元請の締めの期間で比べるときは、前後の月の稼働（日付つき）も使う
  const workFrom = shiftMonth(months[0], -1);
  const workTo = shiftMonth(months[months.length - 1], 1);

  const [tenant, clients, projects, drivers, work, notices, profiles, closedRates] = await Promise.all([
    getTenant(db, tenantId),
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)).orderBy(asc(s.clients.name)),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ id: s.drivers.id, name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    db
      .select({ month: s.workEntries.month, projectId: s.workEntries.projectId, driverId: s.workEntries.driverId, qty: s.workEntries.qty, workDate: s.workEntries.workDate })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), gte(s.workEntries.month, workFrom), lte(s.workEntries.month, workTo))),
    db
      .select()
      .from(s.paymentNotices)
      .where(and(eq(s.paymentNotices.tenantId, tenantId), gte(s.paymentNotices.month, months[0]), lte(s.paymentNotices.month, months[months.length - 1]))),
    db.select().from(s.mappingProfiles).where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "payment_notice"))),
    closedBillRates(db, tenantId, months),
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
  // 締めた月は、締めたときの受注単価（明細の写し）で数える
  const cmpProjectsFor = (month: string) => {
    const rates = closedRates.get(month);
    return projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, unit: p.unit, billRate: rates?.get(p.id) ?? p.billRate }));
  };

  const lineMapFor = (clientId: string | null): Record<string, LineTarget> => {
    if (!clientId) return {};
    const c = clients.find((x) => x.id === clientId);
    const p = profiles.find((x) => (x.options as ProfileOptions)?.clientId === clientId) ?? (c ? profiles.find((x) => x.name === c.name) : undefined);
    return (p?.options as ProfileOptions)?.lineMap ?? {};
  };

  const cells: ReportCell[] = [];
  const clientList: { id: string | null; name: string; row: (typeof clients)[number] | null }[] = clients.map((c) => ({ id: c.id as string | null, name: c.name, row: c }));
  if (notices.some((n) => !n.clientId || !clients.some((c) => c.id === n.clientId))) clientList.push({ id: null, name: "（元請が削除されています）", row: null });

  const workByMonth = new Map<string, PeriodWork[]>();
  for (const w of work) {
    const arr = workByMonth.get(w.month);
    if (arr) arr.push(w);
    else workByMonth.set(w.month, [w]);
  }
  const linesByNotice = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesByNotice.get(l.noticeId);
    if (arr) arr.push(l);
    else linesByNotice.set(l.noticeId, [l]);
  }

  for (const c of clientList) {
    const active = c.row?.active ?? false;
    for (const month of months) {
      const cmpProjects = cmpProjectsFor(month);
      const notice = notices.find((n) => n.month === month && (c.id ? n.clientId === c.id : !n.clientId || !clients.some((x) => x.id === n.clientId)));
      const lineMap = notice ? lineMapFor(notice.clientId) : {};
      const cache = new Map<string, { projectId: string | null; role: LineRole }>();
      const nLines: CmpLine[] = notice
        ? (linesByNotice.get(notice.id) ?? []).map((l) => {
            // まだ突き合わせていない通知も、突き合わせたときと同じ当て方で数える（DB には書かない。同じ名前は 1 回だけ照合）
            const ck = `${l.rawProject}\u0000${l.projectId ?? ""}`;
            let hit = cache.get(ck);
            if (!hit) {
              hit = resolveLine(l, lineMap, notice.clientId, projectRefs);
              cache.set(ck, hit);
            }
            return { id: l.id, rawProject: l.rawProject, rawDriver: l.rawDriver, projectId: hit.projectId, driverId: l.driverId, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, role: hit.role };
          })
        : [];
      // 比べる稼働：元請の締め日が当社と違い、稼働に日付があれば、元請の締めの期間の稼働
      const scopeClientId = notice ? notice.clientId : c.id;
      const { work: monthWork, period } = selectPeriodWork({
        month,
        tenantClosingDay: tenant.closingDay,
        clientClosingDay: c.row ? c.row.closingDay : null,
        projectIds: scopeProjectIds(scopeClientId, projects, nLines),
        work: [shiftMonth(month, -1), month, shiftMonth(month, 1)].flatMap((m) => workByMonth.get(m) ?? []),
      });
      const qty = new Map<string, number>();
      for (const w of monthWork) if (w.qty > 0) qty.set(w.projectId, (qty.get(w.projectId) ?? 0) + w.qty);
      const own = cmpProjects.filter((p) => c.id && p.clientId === c.id && (qty.get(p.id) ?? 0) > 0);
      const ownTotal = () => own.reduce((a, p) => a + roundYen((qty.get(p.id) ?? 0) * p.billRate, rounding), 0);
      if (!notice) {
        const ourTotal = ownTotal();
        // 稼働もお支払通知も無い月は並べない（一覧では、取引中の元請だけ「未登録」として並べる）
        if (ourTotal === 0 && (!opts.includeEmpty || !active)) continue;
        cells.push({
          clientId: c.id,
          clientName: c.name,
          clientActive: active,
          month,
          ourTotal,
          projectsWithWork: own.length,
          period,
          notice: null,
          items: [],
          short: 0,
          shortCount: 0,
          over: 0,
          overCount: 0,
          open: 0,
          asked: 0,
          settled: 0,
          recovered: 0,
          recoveredCount: 0,
          zeroRate: own.filter((p) => !(p.billRate > 0)).map((p) => p.name),
          facts: [],
          stale: false,
        });
        continue;
      }
      const result = compareNotice({ clientId: notice.clientId, projects: cmpProjects, drivers, work: monthWork, lines: nLines, rounding });
      const saved = stored.filter((i) => i.noticeId === notice.id);
      const savedKeys = saved.map((i) => itemKey(i.kind, i.projectId, i.label));
      const savedByKey = new Map(saved.map((i, n) => [savedKeys[n], i]));
      const liveKeys = new Set(result.items.map((it) => it.key));
      const liveItems: ReportItem[] = result.items.map((it) => {
        const sv = savedByKey.get(it.key);
        return {
          ...it,
          status: (sv?.status as ItemStatus) ?? "open",
          note: sv?.note ?? null,
          askedAt: sv?.askedAt ?? null,
          resolvedAt: sv?.resolvedAt ?? null,
          recoveredAmount: sv?.recoveredAmount ?? null,
          current: true,
        };
      });
      // 片付いたあとで差が無くなった履歴（直したお支払通知が届いた など）も、取り戻せたお金の記録として載せる
      const history: ReportItem[] = saved
        .filter((sv, n) => isSettledHistory(sv, liveKeys, savedKeys[n]))
        .map((sv) => ({
          key: itemKey(sv.kind, sv.projectId, sv.label),
          kind: sv.kind as ItemKind,
          projectId: sv.projectId,
          driverId: sv.driverId,
          label: sv.label,
          unit: sv.projectId ? (projects.find((p) => p.id === sv.projectId)?.unit ?? null) : null,
          ourQty: sv.ourQty,
          theirQty: sv.theirQty,
          ourPrice: sv.ourPrice,
          theirPrice: sv.theirPrice,
          ourAmount: sv.ourAmount,
          theirAmount: sv.theirAmount,
          diff: sv.diff,
          split: false,
          mixedPrices: false,
          confirmedExtra: false,
          status: sv.status as ItemStatus,
          note: sv.note,
          askedAt: sv.askedAt,
          resolvedAt: sv.resolvedAt,
          recoveredAmount: sv.recoveredAmount,
          current: false,
        }));
      const items: ReportItem[] = nLines.length === 0 ? [] : [...liveItems, ...history];
      const unsettled = items.filter((i) => isUnsettled(i.status));
      const d = sumDiffs(unsettled);
      // 取り戻せた額（確定）は保存した記録から数える。直したファイルの列が読めず行が 0 のあいだも、確定したお金は消さない
      const rec = recoveredOf(saved);
      const stale =
        nLines.length > 0 &&
        (result.items.some((it) => savedByKey.get(it.key)?.diff !== it.diff) ||
          saved.some((sv, n) => !liveKeys.has(savedKeys[n]) && isUnsettled(sv.status)) ||
          new Set(savedKeys).size !== savedKeys.length);
      cells.push({
        clientId: c.id,
        clientName: c.name,
        clientActive: active,
        month,
        ourTotal: nLines.length ? result.ourTotal : ownTotal(),
        projectsWithWork: own.length,
        period,
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
        recovered: rec.recovered,
        recoveredCount: rec.recoveredCount,
        zeroRate: nLines.length ? result.zeroRateProjects.map((p) => p.name) : own.filter((p) => !(p.billRate > 0)).map((p) => p.name),
        facts: receivingFacts({ month, paidOn: notice.paidOn, feeDeducted: notice.feeDeducted, periodEnd: clientPeriod(c.row, month)?.to }),
        stale,
      });
    }
  }
  const withNotice = cells.filter((x) => x.notice);
  return {
    tenantName: tenant.name,
    clients: clients.map((c) => ({ id: c.id, name: c.name, active: c.active, closingDay: c.closingDay })),
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
      recovered: withNotice.reduce((a, x) => a + x.recovered, 0),
      recoveredCount: withNotice.reduce((a, x) => a + x.recoveredCount, 0),
    },
  };
}

/** レポートの期間の既定（今の月を含む 3 か月） */
export function defaultReportParams(month: string): { from: string; to: string } {
  return { from: monthParam(shiftMonth(month, -2)), to: monthParam(month) };
}

// ---------------------------------------------------------------- 見つけたお金（確定と見込みを分けて。足し合わせない）

export type FoundMoney = {
  /** YYYY-MM-01 */
  from: string;
  to: string;
  /** 確定：「解決」にして入れた、取り戻せた額の合計（入金された・次の支払に上乗せされると決まった額） */
  confirmed: number;
  confirmedCount: number;
  /** 見込み：未対応・問い合わせ済みの差のうち、受け取りが少ない可能性（マイナスの差）の額の合計。まだ決まったお金ではない */
  estimated: number;
  estimatedCount: number;
  /** 問い合わせてから 14 日を過ぎても返事待ちの差の数 */
  waitingLong: number;
  /** 突き合わせたお支払通知の数 */
  notices: number;
  /** 月ごと（お支払通知の月＝稼働の月で数える） */
  byMonth: { month: string; confirmed: number; estimated: number }[];
};

function waitingLongOf(items: { status: string; askedAt: Date | null }[], now: Date): number {
  return items.filter((i) => (waitingDays(i.status, i.askedAt, now) ?? -1) >= WAIT_ALERT_DAYS).length;
}

/**
 * レポートから「見つけたお金」を出す（突合の画面・レポートと同じ数え方）。
 * 確定と見込みは別の数で、足し合わせた数は作らない（盛らない）
 */
export function foundMoneyFromReport(report: Pick<Report, "from" | "to" | "months" | "cells">, now: Date = new Date()): FoundMoney {
  const withNotice = report.cells.filter((c) => c.notice);
  const byMonth = report.months.map((month) => {
    const list = withNotice.filter((c) => c.month === month);
    return { month, confirmed: list.reduce((a, c) => a + c.recovered, 0), estimated: list.reduce((a, c) => a + c.short, 0) };
  });
  return {
    from: report.months[0] ?? report.from,
    to: report.months[report.months.length - 1] ?? report.to,
    confirmed: withNotice.reduce((a, c) => a + c.recovered, 0),
    confirmedCount: withNotice.reduce((a, c) => a + c.recoveredCount, 0),
    estimated: withNotice.reduce((a, c) => a + c.short, 0),
    estimatedCount: withNotice.reduce((a, c) => a + c.shortCount, 0),
    waitingLong: withNotice.reduce((a, c) => a + waitingLongOf(c.items, now), 0),
    notices: withNotice.length,
    byMonth,
  };
}

function toMonthStart(value: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value);
  if (!m) throw new UserError("月の形が正しくありません");
  return `${m[1]}-${m[2]}-01`;
}

/**
 * 見つけたお金（ホーム・利益の画面から使う入口）。when は 1 か月（YYYY-MM か YYYY-MM-01）か、期間 { from, to }（12 か月まで）。
 * - confirmed：取り戻せた額（確定）。「解決」にして額を入れた差の合計
 * - estimated：見込み。未対応・問い合わせ済みの差のうち、受け取りが少ない可能性の額の合計
 * 2 つは足さないこと（SPEC P1-1.2）
 */
export async function foundMoney(db: Db, tenantId: string, when: string | { from: string; to: string }, now: Date = new Date()): Promise<FoundMoney> {
  let from = toMonthStart(typeof when === "string" ? when : when.from);
  let to = toMonthStart(typeof when === "string" ? when : when.to);
  if (from > to) [from, to] = [to, from];
  if (shiftMonth(from, 11) < to) from = shiftMonth(to, -11);
  const report = await loadReport(db, tenantId, from, to);
  return foundMoneyFromReport(report, now);
}

// ---------------------------------------------------------------- 返事待ちの追いかけ

export type WaitingItem = {
  itemId: string;
  noticeId: string;
  clientName: string;
  month: string;
  kind: ItemKind;
  label: string;
  diff: number;
  note: string | null;
  askedAt: Date | null;
  /** 問い合わせてからの日数（日付の記録が無い古い差は null） */
  days: number | null;
};

/** 「問い合わせ済み」のまま返事を待っている差（全部の月。長く待っている順） */
export async function listWaiting(db: Db, tenantId: string, now: Date = new Date()): Promise<WaitingItem[]> {
  const rows = await db
    .select({
      itemId: s.reconciliationItems.id,
      noticeId: s.reconciliationItems.noticeId,
      kind: s.reconciliationItems.kind,
      label: s.reconciliationItems.label,
      diff: s.reconciliationItems.diff,
      note: s.reconciliationItems.note,
      askedAt: s.reconciliationItems.askedAt,
      month: s.paymentNotices.month,
      clientName: s.clients.name,
    })
    .from(s.reconciliationItems)
    .innerJoin(s.paymentNotices, and(eq(s.paymentNotices.id, s.reconciliationItems.noticeId), eq(s.paymentNotices.tenantId, tenantId)))
    .leftJoin(s.clients, and(eq(s.clients.id, s.paymentNotices.clientId), eq(s.clients.tenantId, tenantId)))
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.status, "asked")));
  return rows
    .map((r) => ({
      itemId: r.itemId,
      noticeId: r.noticeId,
      clientName: r.clientName ?? "（元請が削除されています）",
      month: r.month,
      kind: r.kind as ItemKind,
      label: r.label,
      diff: r.diff,
      note: r.note,
      askedAt: r.askedAt,
      days: waitingDays("asked", r.askedAt, now),
    }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.month.localeCompare(b.month) || a.clientName.localeCompare(b.clientName, "ja") || a.label.localeCompare(b.label, "ja"));
}

// ---------------------------------------------------------------- 問い合わせ文（画面と PDF で同じ中身）

export type LetterSourceItem = LetterItem & { status: ItemStatus };

export type LetterSource = {
  view: NoticeView;
  clientName: string;
  /** 問い合わせられる差（未対応・問い合わせ済みで、差のあるもの）。保存していない差は鍵を id にする */
  items: LetterSourceItem[];
  /** 元請の締めの期間で比べたときだけ、その期間（本文と表に書く） */
  period: { from: string; to: string } | null;
  /** お支払通知の行を読み取れていない（列が分からない）。このときは問い合わせる差を出さない（前のファイルの数字で送らないように） */
  unreadable: boolean;
  /** 元請の締め日が違うのに、稼働に日付が無く当社の月で比べたとき、当社の記録の期間（PDF の表の注記に書く） */
  ourSpan: { from: string; to: string } | null;
};

/** 問い合わせ文の材料（画面の文面と PDF で同じものを使う） */
export async function loadLetterSource(db: Db, tenantId: string, noticeId: string): Promise<LetterSource> {
  const view = await loadNoticeView(db, tenantId, noticeId);
  const unreadable = view.lineGroups.length === 0;
  // 保存した結果が古いときも、文面は今の記録の数字で作る（「問い合わせ済み」にするのは突き合わせ直してから）
  const items: LetterSourceItem[] = (unreadable ? [] : view.display)
    .filter((i) => isUnsettled(i.status) && i.diff !== 0)
    .map((i) => ({
      id: i.id ?? i.key,
      kind: i.kind,
      label: i.label,
      unit: i.unit,
      ourQty: i.ourQty,
      theirQty: i.theirQty,
      ourPrice: i.ourPrice,
      theirPrice: i.theirPrice,
      ourAmount: i.ourAmount,
      theirAmount: i.theirAmount,
      diff: i.diff,
      split: i.split,
      status: i.status,
    }));
  return {
    view,
    clientName: view.client?.name ?? "元請",
    items,
    period: view.period.mode === "closing" && view.period.differs ? { from: view.period.from, to: view.period.to } : null,
    unreadable,
    ourSpan: view.period.differs && view.period.fallback ? { from: view.period.from, to: view.period.to } : null,
  };
}
