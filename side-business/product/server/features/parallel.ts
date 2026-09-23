import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { buildStatementDrafts } from "~/server/calc/statement";
import { explainDiff, parallelSummary, partsOf, type DiffParts, type Explanation, type ParallelSummary } from "~/server/features/parallel/explain";
import { readAmountTable, rowsFromText, type AmountTable } from "~/server/features/parallel/paste";
import { monthLabelJa, shiftMonth } from "~/server/month";
import { getTenant, isMonthClosed, loadBuildInput } from "~/server/repo";
import { readSnapshot, snapshotHash } from "~/server/statements-core";
import { readTable, TableReadError } from "~/server/tabular";

export * from "~/server/features/parallel/explain";
export type { AmountRow, AmountTable } from "~/server/features/parallel/paste";

/**
 * 並行運用の比べ合わせ：しめ日ラボの振込額（保存した明細。無ければ今の稼働から作った見込み）と、
 * 今の Excel で出した振込額（お客様が入れる）を、ドライバーごとに並べる。差があれば、理由の見当を出す。
 * どの関数も (db, tenantId, …) を受け取り、会社で絞る。
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_EXCEL_TOTAL = 100_000_000;
export const MAX_PARALLEL_FILE_BYTES = 5 * 1024 * 1024;

function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
}

export type ParallelRow = {
  driverId: string;
  name: string;
  code: string | null;
  /** しめ日ラボの振込額（明細が無ければ null） */
  ours: number | null;
  /** saved：保存した明細 ／ draft：今の稼働から作った見込み（明細はまだ保存していない） */
  source: "saved" | "draft" | null;
  /** 保存した明細のあとで、稼働・設定が変わった（作り直すと額が変わる） */
  stale: boolean;
  /** 作り直したときの額（stale のとき） */
  draftTotal: number | null;
  excelTotal: number | null;
  note: string | null;
  updatedAt: Date | null;
  /** しめ日ラボ − Excel（Excel の額が無ければ null） */
  diff: number | null;
  parts: DiffParts | null;
  explanations: Explanation[];
};

export type ParallelView = {
  month: string;
  closed: boolean;
  rows: ParallelRow[];
  summary: ParallelSummary;
  /** 一覧に出ていない人（名前を選んで Excel の額を入れるため） */
  otherDrivers: { id: string; name: string; code: string | null }[];
  lastUpdated: Date | null;
};

export async function loadParallel(db: Db, tenantId: string, month: string): Promise<ParallelView> {
  assertMonth(month);
  await getTenant(db, tenantId);
  const [closed, input, saved, checks, drivers] = await Promise.all([
    isMonthClosed(db, tenantId, month),
    loadBuildInput(db, tenantId, month),
    db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
    db.select().from(s.parallelChecks).where(and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.month, month))),
    db
      .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code, kana: s.drivers.kana, active: s.drivers.active })
      .from(s.drivers)
      .where(eq(s.drivers.tenantId, tenantId)),
  ]);
  const drafts = buildStatementDrafts(input);
  const draftBy = new Map(drafts.map((d) => [d.driverId, d]));
  const savedBy = new Map(saved.map((r) => [r.driverId, r]));
  const checkBy = new Map(checks.map((c) => [c.driverId, c]));
  const driverBy = new Map(drivers.map((d) => [d.id, d]));

  const ids = new Set<string>([...savedBy.keys(), ...draftBy.keys(), ...checkBy.keys()]);
  const rows: ParallelRow[] = [...ids]
    .filter((id) => driverBy.has(id))
    .map((driverId) => {
      const drv = driverBy.get(driverId)!;
      const st = savedBy.get(driverId);
      const draft = draftBy.get(driverId) ?? null;
      const check = checkBy.get(driverId);
      const snap = st ? readSnapshot(st) : null;
      const ours = st ? st.total : draft ? draft.total : null;
      // 締めた月は保存した明細のまま。開いている月は、今の稼働と違えば知らせる
      const stale = !!st && !closed && (draft ? snapshotHash(draft) !== st.hash : true);
      const parts = snap ? partsOf(snap) : draft ? partsOf(draft) : null;
      const excelTotal = check ? check.excelTotal : null;
      const diff = excelTotal === null ? null : (ours ?? 0) - excelTotal;
      return {
        driverId,
        name: drv.name,
        code: drv.code,
        ours,
        source: st ? "saved" : draft ? "draft" : null,
        stale,
        draftTotal: stale ? (draft?.total ?? 0) : null,
        excelTotal,
        note: check?.note ?? null,
        updatedAt: check?.updatedAt ?? null,
        diff,
        parts,
        explanations: diff === null ? [] : explainDiff(parts, diff),
      } satisfies ParallelRow;
    })
    .sort((a, b) => {
      const ka = (driverBy.get(a.driverId)?.kana || a.name).normalize("NFKC");
      const kb = (driverBy.get(b.driverId)?.kana || b.name).normalize("NFKC");
      return ka.localeCompare(kb, "ja") || (a.code ?? "").localeCompare(b.code ?? "");
    });

  const listed = new Set(rows.map((r) => r.driverId));
  const otherDrivers = drivers
    .filter((d) => d.active && !listed.has(d.id))
    .sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, "ja"))
    .map((d) => ({ id: d.id, name: d.name, code: d.code }));
  const lastUpdated = checks.reduce<Date | null>((m, c) => (!m || c.updatedAt > m ? c.updatedAt : m), null);
  return { month, closed, rows, summary: parallelSummary(rows), otherDrivers, lastUpdated };
}

// ---------------------------------------------------------------- 切り替えの目安と記録

export type MonthCheck = { month: string; state: "ok" | "diff" | "none"; compared: number; matched: number };

/**
 * この月を含む直近 count か月の比べ合わせ（新しい順）。ok：比べた人が全員「一致」か「理由のメモあり」。
 * streak：この月から続けて ok の月の数（切り替えの目安は 2〜3 か月）。
 */
export async function parallelHistory(
  db: Db,
  tenantId: string,
  month: string,
  count = 3,
  /** この月の比べ合わせをもう読んであれば渡す（読み直さない） */
  known?: ParallelView,
): Promise<{ months: MonthCheck[]; streak: number }> {
  assertMonth(month);
  const months = Array.from({ length: count }, (_, i) => shiftMonth(month, -i));
  const rows = await db
    .select({ month: s.parallelChecks.month })
    .from(s.parallelChecks)
    .where(and(eq(s.parallelChecks.tenantId, tenantId), inArray(s.parallelChecks.month, months)));
  const withChecks = new Set(rows.map((r) => r.month));
  const out: MonthCheck[] = [];
  for (const m of months) {
    if (!withChecks.has(m)) {
      out.push({ month: m, state: "none", compared: 0, matched: 0 });
      continue;
    }
    const v = known && known.month === m ? known : await loadParallel(db, tenantId, m);
    out.push({ month: m, state: v.summary.allExplained ? "ok" : "diff", compared: v.summary.compared, matched: v.summary.matched });
  }
  let streak = 0;
  for (const c of out) {
    if (c.state !== "ok") break;
    streak++;
  }
  return { months: out, streak };
}

/** しめ日ラボだけで締め始めた月（まだなら null）。tenants.onboarding.golive に入れる */
export async function goLiveMonth(db: Db, tenantId: string): Promise<string | null> {
  const t = await getTenant(db, tenantId);
  const v = t.onboarding?.golive;
  return typeof v === "string" && MONTH_RE.test(v) ? v : null;
}

/**
 * 「Excel をやめて、しめ日ラボで締める」を記録する（オーナーが決める。役割は Server Action で確かめる）。
 * その月に比べた人が全員「一致」か「理由のメモあり」でないと記録しない。
 */
export async function goLive(db: Db, tenantId: string, month: string, userId?: string | null): Promise<void> {
  assertMonth(month);
  const v = await loadParallel(db, tenantId, month);
  if (v.summary.compared === 0) throw new UserError(`${monthLabelJa(month)}分は、まだ Excel の額を入れていません。比べてから切り替えてください`);
  if (!v.summary.allExplained) {
    throw new UserError(`差があって、理由のメモがまだ無い人が ${v.summary.unexplained}人います。どちらに合わせるかを決めてメモに残してから切り替えてください`);
  }
  const t = await getTenant(db, tenantId);
  const next = { ...(t.onboarding ?? {}), parallel: "done", golive: month };
  await db.update(s.tenants).set({ onboarding: next }).where(eq(s.tenants.id, tenantId));
  const history = await parallelHistory(db, tenantId, month);
  await audit(db, {
    tenantId,
    userId,
    action: "parallel.golive",
    entity: "month",
    entityId: month,
    detail: { compared: v.summary.compared, matched: v.summary.matched, explained: v.summary.different, streak: history.streak },
  });
}

/** 切り替えの記録を取り消す（Excel との並行に戻す） */
export async function undoGoLive(db: Db, tenantId: string, userId?: string | null): Promise<void> {
  const t = await getTenant(db, tenantId);
  const next = { ...(t.onboarding ?? {}) };
  const was = next.golive ?? null;
  delete next.golive;
  await db.update(s.tenants).set({ onboarding: next }).where(eq(s.tenants.id, tenantId));
  await audit(db, { tenantId, userId, action: "parallel.golive_undo", entity: "tenant", entityId: tenantId, detail: { was } });
}

export type ParallelEntry = { driverId: string; excelTotal: number | null; note?: string | null };

/**
 * Excel の額を保存する（同じ人・同じ月は上書き。null は消す）。
 * 明細を変えるものではないので、締めた月でも入れられる（締めたあとに比べることが多い）。
 */
export async function saveParallelChecks(db: Db, tenantId: string, month: string, entries: ParallelEntry[], userId?: string | null): Promise<{ saved: number; removed: number }> {
  assertMonth(month);
  if (entries.length === 0) throw new UserError("入れた額がありません");
  if (entries.length > 1000) throw new UserError("一度に保存できるのは 1,000人までです");
  const byDriver = new Map<string, ParallelEntry>();
  for (const e of entries) {
    if (!UUID.test(e.driverId)) throw new UserError("ドライバーが見つかりません。画面を読み直してください");
    if (e.excelTotal !== null && (!Number.isInteger(e.excelTotal) || Math.abs(e.excelTotal) > MAX_EXCEL_TOTAL)) {
      throw new UserError("Excel の振込額は 1 円単位の数で入れてください（桁を確かめてください）");
    }
    byDriver.set(e.driverId, e);
  }
  const ids = [...byDriver.keys()];
  const own = await db
    .select({ id: s.drivers.id })
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), inArray(s.drivers.id, ids)));
  if (own.length !== ids.length) throw new UserError("ドライバーが見つかりません。画面を読み直してください");

  const upserts = [...byDriver.values()].filter((e) => e.excelTotal !== null);
  const removes = [...byDriver.values()].filter((e) => e.excelTotal === null).map((e) => e.driverId);
  await db.transaction(async (tx) => {
    for (const e of upserts) {
      const note = e.note?.trim() ? e.note.trim().slice(0, 200) : null;
      await tx
        .insert(s.parallelChecks)
        .values({ tenantId, month, driverId: e.driverId, excelTotal: e.excelTotal!, note, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [s.parallelChecks.tenantId, s.parallelChecks.month, s.parallelChecks.driverId],
          set: { excelTotal: e.excelTotal!, note, updatedAt: new Date() },
        });
    }
    if (removes.length) {
      await tx
        .delete(s.parallelChecks)
        .where(and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.month, month), inArray(s.parallelChecks.driverId, removes)));
    }
  });
  await audit(db, {
    tenantId,
    userId,
    action: "parallel.save",
    entity: "month",
    entityId: month,
    detail: { saved: upserts.length, removed: removes.length },
  });
  return { saved: upserts.length, removed: removes.length };
}

/** この月の Excel の額をすべて消す（やり直し） */
export async function clearParallelChecks(db: Db, tenantId: string, month: string, userId?: string | null): Promise<number> {
  assertMonth(month);
  const removed = await db
    .delete(s.parallelChecks)
    .where(and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.month, month)))
    .returning({ driverId: s.parallelChecks.driverId });
  await audit(db, { tenantId, userId, action: "parallel.clear", entity: "month", entityId: month, detail: { removed: removed.length } });
  return removed.length;
}

// ---------------------------------------------------------------- 貼り付け・ファイルから

async function driverCandidates(db: Db, tenantId: string) {
  const rows = await db
    .select({ id: s.drivers.id, name: s.drivers.name, aliases: s.drivers.aliases, code: s.drivers.code, kana: s.drivers.kana })
    .from(s.drivers)
    .where(eq(s.drivers.tenantId, tenantId));
  return rows;
}

export type AmountReadOptions = { nameCol?: number | null; amountCol?: number | null };

/** 貼り付けた「名前・金額」を読む（保存はしない） */
export async function readParallelPaste(db: Db, tenantId: string, text: string, opts: AmountReadOptions = {}): Promise<AmountTable> {
  if (!text.trim()) throw new UserError("Excel の「名前」と「振込額」の 2 列をコピーして、貼り付けてください");
  const rows = rowsFromText(text);
  if (rows.length > 2000) throw new UserError("行が多すぎます（2,000 行まで）");
  return readAmountTable(rows, await driverCandidates(db, tenantId), opts);
}

/** ファイル（CSV・Excel）の「名前・金額」を読む（保存はしない）。シートが何枚かあれば、名前がいちばん多く当たるシート */
export async function readParallelFile(db: Db, tenantId: string, fileName: string, bytes: Uint8Array, opts: AmountReadOptions = {}): Promise<AmountTable & { sheetName: string }> {
  if (bytes.byteLength > MAX_PARALLEL_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）");
  let sheets;
  try {
    ({ sheets } = await readTable(fileName, bytes));
  } catch (error) {
    if (error instanceof TableReadError) throw new UserError(error.message);
    throw error;
  }
  const candidates = await driverCandidates(db, tenantId);
  let best: (AmountTable & { sheetName: string }) | null = null;
  for (const sheet of sheets) {
    const t = { ...readAmountTable(sheet.rows.slice(0, 2000), candidates, opts), sheetName: sheet.name };
    if (!best || t.matched > best.matched) best = t;
  }
  if (!best) throw new UserError("読み込める表がありませんでした");
  return best;
}
