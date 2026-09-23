import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { buildStatementDrafts, payDateFor, type StatementDraft } from "~/server/calc/statement";
import { loadReport as defaultLoadReport, type Report } from "~/server/features/reconcile";
import { listMonthStatements } from "~/server/features/statements";
import { runWatch as defaultRunWatch } from "~/server/features/watch";
import type { WatchIssue } from "~/server/features/watch-types";
import { shiftMonth } from "~/server/month";
import { getTenant, isMonthClosed, loadBuildInput } from "~/server/repo";
import { readSnapshot, statementsStatus } from "~/server/statements-core";
import {
  burdenSplit,
  changeOf,
  futureBurden,
  summarizeDrafts,
  toTrendPoint,
  topAndBottom,
  type BurdenSplit,
  type BurdenStep,
  type Change,
  type FutureBurden,
  type ProfitSummary,
  type ProfitTotals,
  type ProjectProfit,
  type TrendPoint,
} from "~/server/features/profit/summary";

export * from "~/server/features/profit/summary";

/**
 * 利益（案件・元請・ドライバー・推移）と、社長の 1 枚の中身。
 * - 締めた月は、保存した明細の写し（readSnapshot）から。締めたあとで単価や設定を変えても、数字は変わらない
 * - まだ締めていない月は、今の稼働と設定から buildStatementDrafts で作る（締めるまで変わる）
 * - 締めたのに写しが無い月（明細を作らずに締めた月）は、今の稼働と設定から作り、そう伝える
 * どの関数も (db, tenantId, …) を受け取り、会社で絞って読む。
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
}

export type MonthDrafts = {
  month: string;
  closed: boolean;
  /** snapshot（締めた明細の写し）・calc（今の稼働と設定から計算） */
  source: "snapshot" | "calc";
  /** 締めた月なのに、明細の写しが無かった */
  snapshotMissing: boolean;
  drafts: StatementDraft[];
};

/** その月の明細（締めた月は写し、開いている月は今の計算） */
export async function loadMonthDrafts(db: Db, tenantId: string, month: string): Promise<MonthDrafts> {
  assertMonth(month);
  const closed = await isMonthClosed(db, tenantId, month);
  if (closed) {
    const rows = await db
      .select({ snapshot: s.statements.snapshot })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
    if (rows.length > 0) {
      const drafts = rows.map(readSnapshot).sort((a, b) => a.driver.name.localeCompare(b.driver.name, "ja"));
      return { month, closed, source: "snapshot", snapshotMissing: false, drafts };
    }
  }
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  return { month, closed, source: "calc", snapshotMissing: closed, drafts };
}

export type MonthProfit = Omit<MonthDrafts, "drafts"> & ProfitSummary & { drafts: StatementDraft[] };

/** 1 か月の利益（合計・案件・元請・ドライバー） */
export async function monthProfit(db: Db, tenantId: string, month: string): Promise<MonthProfit> {
  const md = await loadMonthDrafts(db, tenantId, month);
  return { ...md, ...summarizeDrafts(md.drafts) };
}

/** 直近 count か月の推移（古い順。最後がこの月）。known を渡すと、その月は読み直さない */
export async function profitTrend(db: Db, tenantId: string, month: string, count = 6, known?: MonthProfit): Promise<TrendPoint[]> {
  assertMonth(month);
  const points: TrendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const mp = known && known.month === m ? known : await monthProfit(db, tenantId, m);
    points.push(toTrendPoint(m, mp.totals, mp.closed, mp.source));
  }
  return points;
}

export type ProfitChanges = {
  sales: Change | null;
  pay: Change | null;
  profit: Change | null;
  /** 利益率の差（ポイント。0.012 = 1.2 ポイント） */
  rate: Change | null;
};

/** 前の月との比べ（前の月に明細が 1 件も無ければ比べない） */
export function changesFrom(current: ProfitTotals, prev: TrendPoint | null): ProfitChanges {
  if (!prev || prev.drivers === 0) return { sales: null, pay: null, profit: null, rate: null };
  return {
    sales: changeOf(current.sales, prev.sales),
    pay: changeOf(current.pay, prev.pay),
    profit: changeOf(current.profit, prev.profit),
    rate: current.rate !== null && prev.rate !== null ? { diff: current.rate - prev.rate, ratio: null } : null,
  };
}

/**
 * 見つけたお金（その月の元請の支払通知との突合）。突合の画面・レポートと同じ数え方（reconcile の loadReport のセル）。
 * - confirmed：「解決」にして取り戻せた額を入れた差の合計（確定）
 * - estimated：未対応・問い合わせ済みの差のうち、支払通知が当社の記録より少ない額の合計（見込み）
 * 2 つは足し合わせない（SPEC P1-1.2）。error は突合を読めなかったとき
 * unread は行を読み取れていない支払通知の数（比べられないので、見込みが 0 でも「差が無い」とは言えない）
 */
export type MonthFound = {
  notices: number;
  confirmed: number;
  confirmedCount: number;
  estimated: number;
  estimatedCount: number;
  error: string | null;
  unread?: number;
};

/** 突合のセルから、その月の見つけたお金を出す（純関数。reconcile の foundMoneyFromReport と同じ足し方）。ホームもこれを使う */
export function foundFromCells(cells: Pick<Report, "cells">["cells"], month: string): MonthFound {
  const out: MonthFound = { notices: 0, confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0, error: null, unread: 0 };
  for (const c of cells) {
    if (!c.notice || c.month !== month) continue;
    out.notices++;
    if (c.notice.lineCount === 0) out.unread = (out.unread ?? 0) + 1;
    out.confirmed += c.recovered;
    out.confirmedCount += c.recoveredCount;
    out.estimated += c.short;
    out.estimatedCount += c.shortCount;
  }
  return out;
}

const FOUND_ERROR = "突合の結果を読めませんでした。元請との突合の画面で確かめてください。";

export type ProfitPage = {
  companyName: string;
  taxMethod: string;
  current: MonthProfit;
  prev: TrendPoint | null;
  changes: ProfitChanges;
  trend: TrendPoint[];
  future: FutureBurden;
  /** 期間の途中で経過措置の割合が変わる月の、日ごとに分けた内訳（またがない月は空） */
  split: BurdenSplit;
  /** 見つけたお金（確定と見込みを分けて。足し合わせない） */
  found: MonthFound;
};

export type ProfitDeps = Pick<CeoDeps, "loadReport">;

/** 利益の画面の中身 */
export async function loadProfitPage(db: Db, tenantId: string, month: string, deps: ProfitDeps = {}): Promise<ProfitPage> {
  const tenant = await getTenant(db, tenantId);
  const current = await monthProfit(db, tenantId, month);
  const trend = await profitTrend(db, tenantId, month, 6, current);
  const prev = trend.length >= 2 ? trend[trend.length - 2] : null;
  let found: MonthFound;
  try {
    const report = await (deps.loadReport ?? defaultLoadReport)(db, tenantId, month, month);
    found = foundFromCells(report.cells, month);
  } catch (error) {
    console.error("profit page: reconcile failed", error instanceof Error ? error.message : error);
    found = { notices: 0, confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0, error: FOUND_ERROR, unread: 0 };
  }
  return {
    companyName: tenant.name,
    taxMethod: tenant.taxMethod,
    current,
    prev,
    changes: changesFrom(current.totals, prev),
    trend,
    future: futureBurden(current.drafts, month, tenant.taxMethod),
    split: burdenSplit(current.drafts),
    found,
  };
}

// ---------------------------------------------------------------- 社長の 1 枚

export type CeoDeps = {
  /** 見張り番（テストでは差し替える） */
  runWatch?: (db: Db, tenantId: string, month: string) => Promise<WatchIssue[]>;
  /** 突合のまとめ（テストでは差し替える） */
  loadReport?: (db: Db, tenantId: string, from: string, to: string) => Promise<Pick<Report, "cells">>;
};

export type CeoSheet = {
  companyName: string;
  month: string;
  closed: boolean;
  source: "snapshot" | "calc";
  snapshotMissing: boolean;
  totals: ProfitTotals;
  prev: TrendPoint | null;
  changes: ProfitChanges;
  trend: TrendPoint[];
  topProjects: ProjectProfit[];
  bottomProjects: ProjectProfit[];
  burden: { affected: boolean; people: number; current: BurdenStep | null; next: BurdenStep | null };
  /** この月の実際の負担（明細の invoiceBurden の合計）と、期間の途中で割合が変わる月の日ごとの内訳 */
  split: BurdenSplit;
  /** 見つけたお金（確定と見込み。別の行に出し、足し合わせない） */
  found: MonthFound;
  /**
   * 元請の支払通知との突合で、まだ片付いていない差（未対応・問い合わせ済み）。
   * 突合の画面と同じ出し方（差は今の記録で出し、状態は保存したもの）。まだ突合の画面を開いていない通知の差も入る
   * short・over は支払通知が当社の記録より少ない・多い額。unread は行を読み取れていない（比べられない）通知の数
   */
  reconcile: { notices: number; unread: number; count: number; net: number; short: number; shortCount: number; over: number; overCount: number; error: string | null };
  /** 見張り番（まだ確認済みにしていない赤・黄） */
  watch: { red: number; yellow: number; acked: number; titles: { severity: "red" | "yellow"; title: string; subject: string }[]; error: string | null };
  /**
   * ドライバーの確認（保存した明細のうち、今の版を確認した人）。
   * stale：まだ締めていない月で、保存した明細が今の稼働・設定と違う（作り直すと確認の数も変わる）
   */
  confirm: { statements: number; confirmed: number; deemed: number; stale: boolean };
  /**
   * 振込（振込額がプラスの人の合計と、明細に書いた支払日）。
   * 控除が委託料を上回って 0 円以下になった人は振込が無いので、合計に入れず人数だけ数える（振込データの画面と同じ）
   */
  transfer: { total: number; people: number; notPositive: number; payDate: string };
};

/** 突合の差と見つけたお金（突合の画面と同じ読み方。読めなくても 1 枚は出す） */
async function reconcileSummary(
  db: Db,
  tenantId: string,
  month: string,
  load: NonNullable<CeoDeps["loadReport"]>,
): Promise<{ reconcile: CeoSheet["reconcile"]; found: MonthFound }> {
  const out: CeoSheet["reconcile"] = { notices: 0, unread: 0, count: 0, net: 0, short: 0, shortCount: 0, over: 0, overCount: 0, error: null };
  let found: MonthFound;
  try {
    const report = await load(db, tenantId, month, month);
    found = foundFromCells(report.cells, month);
    for (const c of report.cells) {
      if (!c.notice || c.month !== month) continue;
      out.notices++;
      if (c.notice.lineCount === 0) out.unread++;
      out.short += c.short;
      out.shortCount += c.shortCount;
      out.over += c.over;
      out.overCount += c.overCount;
    }
    out.count = out.shortCount + out.overCount;
    out.net = out.over - out.short;
  } catch (error) {
    console.error("ceo sheet: reconcile failed", error instanceof Error ? error.message : error);
    return {
      reconcile: { ...out, error: FOUND_ERROR },
      found: { notices: 0, confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0, error: FOUND_ERROR, unread: 0 },
    };
  }
  return { reconcile: out, found };
}

export async function loadCeoSheet(db: Db, tenantId: string, month: string, deps: CeoDeps = {}): Promise<CeoSheet> {
  assertMonth(month);
  const tenant = await getTenant(db, tenantId);
  const current = await monthProfit(db, tenantId, month);
  const trend = await profitTrend(db, tenantId, month, 6, current);
  const prev = trend.length >= 2 ? trend[trend.length - 2] : null;
  const future = futureBurden(current.drafts, month, tenant.taxMethod);
  const { top, bottom } = topAndBottom(current.projects, 3);

  // 突合の差と見つけたお金（この月の支払通知。会社で絞る）
  const { reconcile, found } = await reconcileSummary(db, tenantId, month, deps.loadReport ?? defaultLoadReport);

  // 見張り番（読めなくても 1 枚は出す）
  const watch: CeoSheet["watch"] = { red: 0, yellow: 0, acked: 0, titles: [], error: null };
  try {
    const issues = await (deps.runWatch ?? defaultRunWatch)(db, tenantId, month);
    for (const i of issues) {
      if (i.acked) watch.acked++;
      else if (i.severity === "red") watch.red++;
      else if (i.severity === "yellow") watch.yellow++;
    }
    watch.titles = issues
      .filter((i): i is WatchIssue & { severity: "red" | "yellow" } => !i.acked && (i.severity === "red" || i.severity === "yellow"))
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1))
      .slice(0, 3)
      .map((i) => ({ severity: i.severity, title: i.title, subject: i.subjectLabel }));
  } catch (error) {
    console.error("ceo sheet: watch failed", error instanceof Error ? error.message : error);
    watch.error = "見張り番を読めませんでした。見張り番の画面で確かめてください。";
  }

  const statements = await listMonthStatements(db, tenantId, month);
  // 締める前の月は、保存した明細が今の計算と同じかも見る（利益と振込は今の計算、確認は保存した明細のため）
  const status = !current.closed && statements.counts.all > 0 ? await statementsStatus(db, tenantId, month) : null;

  return {
    companyName: tenant.name,
    month,
    closed: current.closed,
    source: current.source,
    snapshotMissing: current.snapshotMissing,
    totals: current.totals,
    prev,
    changes: changesFrom(current.totals, prev),
    trend,
    topProjects: top,
    bottomProjects: bottom,
    burden: { affected: future.affected, people: future.people, current: future.current, next: future.next },
    split: burdenSplit(current.drafts),
    found,
    reconcile,
    watch,
    confirm: { statements: statements.counts.all, confirmed: statements.counts.confirmed, deemed: statements.counts.deemed, stale: status ? !status.upToDate : false },
    transfer: {
      total: current.drafts.reduce((a, d) => a + (d.total > 0 ? d.total : 0), 0),
      people: current.drafts.filter((d) => d.total > 0).length,
      notPositive: current.drafts.filter((d) => d.total <= 0).length,
      payDate: current.drafts[0]?.payDate ?? payDateFor(month, tenant),
    },
  };
}
