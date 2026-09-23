/**
 * 年次レポート（/reports）の集計（純関数）
 *
 * 月ごとの数字は DB ビュー（v_month_pl / v_driver_month_summary / v_project_summary / v_expense_summary）の
 * 値をそのまま使い、年間の合計は sumMoney で誤差なく足し合わせるだけにする（独自の丸め・再計算はしない）。
 */
import type { DriverMonthSummary, ExpenseKind, ExpenseSummaryRow, MonthPl, MonthStatus, ProjectSummary } from "@/lib/db/types";
import { subMoney, sumMoney } from "@/lib/calc/money";
import { dateToMonth } from "@/lib/month";
import { fiscalPeriod, parsePeriodYear, periodEndYearOf, periodOptions, periodTitle, type FiscalSettings } from "@/lib/fiscal";

/** 月の状態の表示 */
export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = { open: "未締め", closed: "締め済み" };

export const REPORT_MIN_YEAR = 2000;
export const REPORT_MAX_YEAR = 2100;

/** 年次レポートの 1 か月分（v_month_pl の 1 行。データが無い月は 0 埋め） */
export interface ReportMonthRow {
  /** "YYYY-MM" */
  month: string;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFee: number;
  adjPay: number;
  adjProfit: number;
  profit: number;
  expenseTotal: number;
  expenseFixed: number;
  expenseVariable: number;
  expenseCount: number;
  operatingProfit: number;
  operatingMargin: number;
  payout: number;
  tax: number;
  payoutIncl: number;
  entryCount: number;
  activeDriverCount: number;
  billTarget: number;
  profitTarget: number;
  status: MonthStatus;
  /** v_month_pl に行があるか（無い月は「—」表示） */
  hasData: boolean;
}

/** 年間の合計 */
export interface ReportTotals {
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFee: number;
  adjPay: number;
  adjProfit: number;
  profit: number;
  expenseTotal: number;
  expenseFixed: number;
  expenseVariable: number;
  expenseCount: number;
  operatingProfit: number;
  /** 営業利益率 ＝ 営業利益 ÷ 売上（売上 0 なら 0） */
  operatingMargin: number;
  payout: number;
  tax: number;
  payoutIncl: number;
  entryCount: number;
  /** 稼働ドライバー数のピーク（月ごとの最大） */
  peakActiveDriverCount: number;
  /** 稼働行か経費のある月数 */
  dataMonthCount: number;
  billTarget: number;
  profitTarget: number;
}

/** 前年比（増減額と増減率。前年が 0 なら増減率は null） */
export interface YearDelta {
  diff: number;
  ratio: number | null;
}

export interface YearComparison {
  /** 比べる相手の呼び方（「2025年」「第2期」） */
  previousLabel: string;
  bill: YearDelta;
  profit: YearDelta;
  expenseTotal: YearDelta;
  operatingProfit: YearDelta;
}

export interface DriverRankRow {
  driverId: string;
  driverName: string;
  isActive: boolean;
  /** 稼働行のあった月数 */
  monthCount: number;
  entryCount: number;
  bill: number;
  profit: number;
  payout: number;
  payoutIncl: number;
  /** 会社利益率 ＝ 会社利益 ÷ 売上（売上 0 なら 0） */
  profitRate: number;
}

export interface ProjectRankRow {
  key: string;
  projectName: string;
  itemName: string;
  clientName: string;
  entryCount: number;
  qtyTotal: number;
  bill: number;
  pay: number;
  profit: number;
  profitRate: number;
}

export interface ExpenseRankRow {
  categoryId: string;
  categoryName: string;
  kind: ExpenseKind;
  expenseCount: number;
  amount: number;
  /** 経費合計に占める割合（合計 0 なら 0） */
  share: number;
}

// ---------------------------------------------------------------------------
// 年の扱い
// ---------------------------------------------------------------------------

/** その年の 12 か月（"YYYY-MM"、昇順） */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** その年の稼動月の範囲（v_* の読み込み用） */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01`, to: `${year}-12` };
}

export function yearOfMonth(month: string): number {
  return Number(month.slice(0, 4));
}

// ---------------------------------------------------------------------------
// 期（事業年度）と暦年（0030）
// ---------------------------------------------------------------------------

/** 期で見る（決算月で区切る）／暦年で見る（1〜12 月） */
export type ReportView = "fiscal" | "calendar";

/** レポートの対象の範囲 */
export interface ReportRange {
  view: ReportView;
  /** 暦年、または期の決算の年 */
  year: number;
  /** 最初と最後の月（YYYY-MM） */
  from: string;
  to: string;
  months: string[];
  /** 「第3期」「2026年9月期」「2026年」 */
  label: string;
  /** 「第3期（2025年10月〜2026年9月）」「2026年」 */
  title: string;
  /** 比べる相手の呼び方（「前期」「前年」） */
  prevName: "前期" | "前年";
}

export function calendarReportRange(year: number): ReportRange {
  const months = monthsOfYear(year);
  return { view: "calendar", year, from: months[0], to: months[11], months, label: `${year}年`, title: `${year}年`, prevName: "前年" };
}

export function fiscalReportRange(endYear: number, settings: FiscalSettings): ReportRange {
  const p = fiscalPeriod(endYear, settings);
  return { view: "fiscal", year: endYear, from: p.startMonth, to: p.endMonth, months: p.months, label: p.label, title: periodTitle(p), prevName: "前期" };
}

/** ひとつ前（前期・前年） */
export function previousReportRange(r: ReportRange, settings: FiscalSettings): ReportRange {
  return r.view === "fiscal" ? fiscalReportRange(r.year - 1, settings) : calendarReportRange(r.year - 1);
}

/**
 * 表示する範囲：?fy=（期の決算の年）→ ?y=（暦年）→ 稼動月（?m=）の期 の順。
 * 何も指定が無ければ期で見る（決算月が 12 月なら暦年と同じ月になる）
 */
export function resolveReportRange(params: { y?: string | string[]; fy?: string | string[] }, month: string, settings: FiscalSettings): ReportRange {
  const fy = parsePeriodYear(params.fy);
  if (fy != null) return fiscalReportRange(fy, settings);
  const y = parseYear(params.y);
  if (y != null) return calendarReportRange(y);
  return fiscalReportRange(periodEndYearOf(month, settings.fiscalMonth), settings);
}

/** 範囲の選択肢（新しい順）。値は ?fy= / ?y= に入れる年 */
export function reportRangeOptions(view: ReportView, dataMonths: (string | null | undefined)[], settings: FiscalSettings, extraMonths: string[]): { value: number; label: string }[] {
  if (view === "calendar") {
    const years = availableYears(dataMonths, extraMonths.map((m) => yearOfMonth(m)));
    return years.map((y) => ({ value: y, label: `${y}年` }));
  }
  return periodOptions(dataMonths.map((m) => (m ? String(m).slice(0, 7) : m)), settings, extraMonths).map((p) => ({ value: p.endYear, label: periodTitle(p) }));
}

/** 範囲の月に並べる（データが無い月も 0 で入れる） */
export function toReportRowsForMonths(rows: MonthPl[], months: string[]): ReportMonthRow[] {
  const byMonth = new Map<string, MonthPl>();
  for (const r of rows) {
    if (r.month) byMonth.set(dateToMonth(String(r.month)), r);
  }
  return months.map((m) => toReportRow(byMonth.get(m), m));
}

/** URL の ?y= を西暦 4 桁として読む（不正なら null） */
export function parseYear(param: string | string[] | undefined): number | null {
  const v = Array.isArray(param) ? param[0] : param;
  if (typeof v !== "string" || !/^\d{4}$/.test(v)) return null;
  const y = Number(v);
  return y >= REPORT_MIN_YEAR && y <= REPORT_MAX_YEAR ? y : null;
}

/** 表示する年：?y= → 稼動月（?m=）の年 の順（month は monthFromParam() の結果） */
export function resolveReportYear(param: string | string[] | undefined, month: string): number {
  return parseYear(param) ?? yearOfMonth(month);
}

/** 年セレクタの選択肢（データのある年 ＋ extraYears、降順） */
export function availableYears(months: (string | null | undefined)[], extraYears: number[] = []): number[] {
  const years = new Set<number>();
  for (const y of extraYears) {
    if (Number.isFinite(y) && y >= REPORT_MIN_YEAR && y <= REPORT_MAX_YEAR) years.add(y);
  }
  for (const m of months) {
    if (!m) continue;
    const y = Number(String(m).slice(0, 4));
    if (Number.isFinite(y) && y >= REPORT_MIN_YEAR && y <= REPORT_MAX_YEAR) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// 月次推移
// ---------------------------------------------------------------------------

function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** v_month_pl の 1 行 → レポートの行（null は 0 埋め） */
export function toReportRow(row: MonthPl | null | undefined, month: string): ReportMonthRow {
  return {
    month,
    bill: num(row?.bill),
    pay: num(row?.pay),
    margin: num(row?.margin),
    royalty: num(row?.royalty),
    mgmtFee: num(row?.mgmt_fee),
    adjPay: num(row?.adj_pay),
    adjProfit: num(row?.adj_profit),
    profit: num(row?.profit),
    expenseTotal: num(row?.expense_total),
    expenseFixed: num(row?.expense_fixed),
    expenseVariable: num(row?.expense_variable),
    expenseCount: num(row?.expense_count),
    operatingProfit: num(row?.operating_profit),
    operatingMargin: num(row?.operating_margin),
    payout: num(row?.payout),
    tax: num(row?.tax),
    payoutIncl: num(row?.payout_incl),
    entryCount: num(row?.entry_count),
    activeDriverCount: num(row?.active_driver_count),
    billTarget: num(row?.bill_target),
    profitTarget: num(row?.profit_target),
    status: row?.status ?? "open",
    hasData: Boolean(row),
  };
}

/** その年の 12 か月分（データが無い月は 0 埋め、昇順） */
export function toReportRows(rows: MonthPl[], year: number): ReportMonthRow[] {
  return toReportRowsForMonths(rows, monthsOfYear(year));
}

/** 稼働行・経費・目標のいずれかがある年か（1 件も無ければ Empty を出す） */
export function hasReportData(rows: ReportMonthRow[]): boolean {
  return rows.some((r) => r.entryCount > 0 || r.expenseCount > 0 || r.bill !== 0 || r.profit !== 0 || r.billTarget !== 0 || r.profitTarget !== 0);
}

/** 年間の合計（金額は sumMoney、率は合計どうしの比） */
export function sumReport(rows: ReportMonthRow[]): ReportTotals {
  const sum = (pick: (r: ReportMonthRow) => number) => sumMoney(rows.map(pick));
  const count = (pick: (r: ReportMonthRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const bill = sum((r) => r.bill);
  const operatingProfit = sum((r) => r.operatingProfit);
  return {
    bill,
    pay: sum((r) => r.pay),
    margin: sum((r) => r.margin),
    royalty: sum((r) => r.royalty),
    mgmtFee: sum((r) => r.mgmtFee),
    adjPay: sum((r) => r.adjPay),
    adjProfit: sum((r) => r.adjProfit),
    profit: sum((r) => r.profit),
    expenseTotal: sum((r) => r.expenseTotal),
    expenseFixed: sum((r) => r.expenseFixed),
    expenseVariable: sum((r) => r.expenseVariable),
    expenseCount: count((r) => r.expenseCount),
    operatingProfit,
    operatingMargin: bill !== 0 ? operatingProfit / bill : 0,
    payout: sum((r) => r.payout),
    tax: sum((r) => r.tax),
    payoutIncl: sum((r) => r.payoutIncl),
    entryCount: count((r) => r.entryCount),
    peakActiveDriverCount: rows.reduce((a, r) => Math.max(a, r.activeDriverCount), 0),
    dataMonthCount: rows.filter((r) => r.entryCount > 0 || r.expenseCount > 0).length,
    billTarget: sum((r) => r.billTarget),
    profitTarget: sum((r) => r.profitTarget),
  };
}

/** 増減額と増減率（前年が 0 なら増減率は null。前年がマイナスでも符号は増減額に合わせる） */
export function yearDelta(current: number, previous: number): YearDelta {
  const diff = subMoney(current, previous);
  return { diff, ratio: previous !== 0 ? diff / Math.abs(previous) : null };
}

/** 前年比（前年のデータが無ければ null） */
export function compareYears(current: ReportTotals, previous: ReportTotals | null, previousLabel: string): YearComparison | null {
  if (!previous) return null;
  return {
    previousLabel,
    bill: yearDelta(current.bill, previous.bill),
    profit: yearDelta(current.profit, previous.profit),
    expenseTotal: yearDelta(current.expenseTotal, previous.expenseTotal),
    operatingProfit: yearDelta(current.operatingProfit, previous.operatingProfit),
  };
}

// ---------------------------------------------------------------------------
// ランキング
// ---------------------------------------------------------------------------

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 利益の降順（同額なら売上の降順 → 名前順） */
function byProfitDesc<T extends { profit: number; bill: number; name: string }>(a: T, b: T): number {
  if (a.profit !== b.profit) return b.profit - a.profit;
  if (a.bill !== b.bill) return b.bill - a.bill;
  return byName(a.name, b.name);
}

/** ドライバー別ランキング（年間。v_driver_month_summary をドライバーごとに合計し、会社利益の降順） */
export function driverRanking(rows: DriverMonthSummary[]): DriverRankRow[] {
  const groups = new Map<string, DriverMonthSummary[]>();
  for (const r of rows) {
    const key = r.driver_id ?? "";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: DriverRankRow[] = [];
  for (const [driverId, g] of groups) {
    const first = g[0];
    const bill = sumMoney(g.map((r) => num(r.bill)));
    const profit = sumMoney(g.map((r) => num(r.driver_profit)));
    out.push({
      driverId,
      driverName: first.driver_name ?? "",
      isActive: Boolean(first.driver_is_active),
      monthCount: g.filter((r) => num(r.entry_count) > 0).length,
      entryCount: g.reduce((a, r) => a + num(r.entry_count), 0),
      bill,
      profit,
      payout: sumMoney(g.map((r) => num(r.payout))),
      payoutIncl: sumMoney(g.map((r) => num(r.payout_incl))),
      profitRate: bill !== 0 ? profit / bill : 0,
    });
  }
  return out.sort((a, b) => byProfitDesc({ profit: a.profit, bill: a.bill, name: a.driverName }, { profit: b.profit, bill: b.bill, name: b.driverName }));
}

/** 案件（内容）別ランキング（年間。v_project_summary を案件内容ごとに合計し、利益の降順） */
export function projectRanking(rows: ProjectSummary[]): ProjectRankRow[] {
  const groups = new Map<string, ProjectSummary[]>();
  for (const r of rows) {
    const key = r.project_item_id ?? `${r.project_id ?? ""}-${r.item_name ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: ProjectRankRow[] = [];
  for (const [key, g] of groups) {
    const first = g[0];
    const bill = sumMoney(g.map((r) => num(r.bill)));
    const profit = sumMoney(g.map((r) => num(r.entry_profit)));
    out.push({
      key,
      projectName: first.project_name ?? "",
      itemName: first.item_name ?? "",
      clientName: first.client_name ?? "",
      entryCount: g.reduce((a, r) => a + num(r.entry_count), 0),
      qtyTotal: sumMoney(g.map((r) => num(r.qty_total))),
      bill,
      pay: sumMoney(g.map((r) => num(r.pay))),
      profit,
      profitRate: bill !== 0 ? profit / bill : 0,
    });
  }
  return out.sort((a, b) => byProfitDesc({ profit: a.profit, bill: a.bill, name: projectLabel(a) }, { profit: b.profit, bill: b.bill, name: projectLabel(b) }));
}

/** 案件（内容）の表示名：内容が「標準」なら案件名だけ */
export function projectLabel(r: Pick<ProjectRankRow, "projectName" | "itemName">): string {
  return r.itemName && r.itemName !== "標準" ? `${r.projectName}（${r.itemName}）` : r.projectName;
}

/** 経費のカテゴリ別内訳（v_expense_summary をカテゴリごとに合計し、金額の降順） */
export function expenseRanking(rows: ExpenseSummaryRow[]): ExpenseRankRow[] {
  const groups = new Map<string, ExpenseRankRow>();
  for (const r of rows) {
    const key = r.category_id ?? r.category_name ?? "";
    const prev = groups.get(key);
    const amount = num(r.amount);
    const expenseCount = num(r.expense_count);
    if (prev) {
      prev.amount = sumMoney([prev.amount, amount]);
      prev.expenseCount += expenseCount;
    } else {
      groups.set(key, {
        categoryId: key,
        categoryName: r.category_name ?? "",
        kind: r.kind ?? "variable",
        expenseCount,
        amount,
        share: 0,
      });
    }
  }
  const out = [...groups.values()];
  const total = sumMoney(out.map((r) => r.amount));
  for (const r of out) r.share = total !== 0 ? r.amount / total : 0;
  return out.sort((a, b) => (a.amount !== b.amount ? b.amount - a.amount : byName(a.categoryName, b.categoryName)));
}

/** 固定費・変動費の合計 */
export function expenseKindTotals(rows: ExpenseRankRow[]): { fixed: number; variable: number; total: number } {
  return {
    fixed: sumMoney(rows.filter((r) => r.kind === "fixed").map((r) => r.amount)),
    variable: sumMoney(rows.filter((r) => r.kind === "variable").map((r) => r.amount)),
    total: sumMoney(rows.map((r) => r.amount)),
  };
}
