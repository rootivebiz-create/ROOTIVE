/**
 * 週次サマリーの数字（純関数。React・DB・SDK に依存しない）。
 *
 * - 金額の計算・合計は lib/calc（calcEntry / calcTax / sumMoney）だけを使う。独自の丸めは書かない
 * - 管理費と調整は「ドライバー × 月」の単位なので、週の集計には入れない（週次は稼働と経費だけで見る）
 * - 消費税はドライバーごとに tax_base ＝ Σpay − Σroyalty で計算する（課税区分が exempt なら 0）
 */
import { addMoney, calcEntry, calcTax, subMoney, sumMoney, type RoundingMode, type TaxMode } from "@/lib/calc";
import type { WeekRange } from "./range";

/** 週の稼働 1 行（日別の稼働 ＋ その月の単価スナップショット） */
export interface WeeklyEntryInput {
  /** "YYYY-MM-DD" */
  workDate: string;
  driverId: string;
  driverName: string;
  projectName: string;
  itemName: string;
  qty: number;
  billRate: number;
  payRate: number;
  royaltyRate: number;
  roundingMode: RoundingMode;
  /** ドライバーの課税区分（消費税を上乗せするか） */
  taxMode: TaxMode;
}

/** 週に計上した経費 1 件 */
export interface WeeklyExpenseInput {
  category: string;
  kind: "fixed" | "variable";
  /** 税抜の金額 */
  amount: number;
}

/** 未対応のアラート（見出しと重さだけ） */
export interface WeeklyAlertInput {
  title: string;
  severity: "high" | "medium" | "low";
}

/** 資金繰りの見込み（cash_forecast の結果を渡す。入金 ＋／支払 −） */
export interface WeeklyCashInput {
  /** 集計の期間 "YYYY-MM-DD" */
  from: string;
  to: string;
  events: readonly { amount: number | null }[];
  /** 起点の残高（未登録なら null） */
  balance: number | null;
}

/** 会社の消費税設定（null なら消費税を計算しない） */
export interface WeeklyTaxSetting {
  /** 0.1 = 10% */
  rate: number;
  rounding: RoundingMode;
}

export interface WeeklyNumbersInput {
  range: WeekRange;
  entries: readonly WeeklyEntryInput[];
  expenses?: readonly WeeklyExpenseInput[];
  alerts?: readonly WeeklyAlertInput[];
  cash?: WeeklyCashInput | null;
  tax?: WeeklyTaxSetting | null;
}

/** 資金の見込み（30 日以内などの期間の合計） */
export interface WeeklyCashSummary {
  from: string;
  to: string;
  /** 入金の合計（正の数） */
  inflow: number;
  /** 支払の合計（正の数） */
  outflow: number;
  /** 入金 − 支払 */
  net: number;
  /** 起点の残高（未登録なら null） */
  balance: number | null;
  /** 起点の残高 ＋ 入金 − 支払（起点が未登録なら null） */
  endingBalance: number | null;
  eventCount: number;
}

/** 週次サマリーの数字 */
export interface WeeklyNumbers {
  from: string;
  to: string;
  label: string;
  /** 稼働行の件数（承認済み） */
  entryCount: number;
  /** 数量 > 0 の稼働行の件数 */
  activeEntryCount: number;
  /** 稼働のあった日数 */
  workDayCount: number;
  /** 稼働したドライバーの人数 */
  driverCount: number;
  qtyTotal: number;
  /** 会社売上 */
  bill: number;
  /** ドライバー売上 */
  pay: number;
  margin: number;
  royalty: number;
  /** 会社利益（margin ＋ royalty。管理費・調整は月単位なので含めない） */
  profit: number;
  /** 利益率（会社利益 ÷ 会社売上） */
  profitRate: number;
  /** ドライバーへの支払（税抜。Σpay − Σroyalty） */
  payout: number;
  /** 消費税 */
  tax: number;
  /** ドライバーへの支払（税込） */
  payoutIncl: number;
  /** 経費（税抜） */
  expenseTotal: number;
  expenseFixed: number;
  expenseVariable: number;
  expenseCount: number;
  /** 営業利益（会社利益 − 経費） */
  operatingProfit: number;
  /** 営業利益率 */
  operatingMargin: number;
  /** 未対応のアラート件数 */
  openAlertCount: number;
  /** そのうち重大なもの */
  highAlertCount: number;
  /** 資金の見込み（渡されなければ null） */
  cash: WeeklyCashSummary | null;
}

/** 空の週（データが 1 件も無いとき） */
export function emptyWeeklyNumbers(range: WeekRange): WeeklyNumbers {
  return weeklyNumbers({ range, entries: [] });
}

function rateOf(value: number, base: number): number {
  return base !== 0 ? value / base : 0;
}

/** 入金 ＋／支払 − のイベントを集計する */
export function summarizeWeeklyCash(cash: WeeklyCashInput | null | undefined): WeeklyCashSummary | null {
  if (!cash) return null;
  const amounts = cash.events.map((e) => Number(e.amount ?? 0));
  const inflow = sumMoney(amounts.filter((a) => a > 0));
  const outflow = sumMoney(amounts.filter((a) => a < 0).map((a) => -a));
  const net = subMoney(inflow, outflow);
  const balance = cash.balance == null || !Number.isFinite(cash.balance) ? null : cash.balance;
  return {
    from: cash.from,
    to: cash.to,
    inflow,
    outflow,
    net,
    balance,
    endingBalance: balance == null ? null : addMoney(balance, net),
    eventCount: cash.events.length,
  };
}

/**
 * 週の数字をまとめる。
 * 稼働行は lib/calc の calcEntry で 1 行ずつ計算し、合計は sumMoney で足す。
 */
export function weeklyNumbers(input: WeeklyNumbersInput): WeeklyNumbers {
  const entries = input.entries ?? [];
  const expenses = input.expenses ?? [];
  const alerts = input.alerts ?? [];

  const rows = entries.map((e) => ({
    entry: e,
    calc: calcEntry({ qty: e.qty, billRate: e.billRate, payRate: e.payRate, royaltyRate: e.royaltyRate, roundingMode: e.roundingMode }),
  }));
  const active = rows.filter((r) => r.entry.qty > 0);

  const bill = sumMoney(rows.map((r) => r.calc.bill));
  const pay = sumMoney(rows.map((r) => r.calc.pay));
  const margin = sumMoney(rows.map((r) => r.calc.margin));
  const royalty = sumMoney(rows.map((r) => r.calc.royalty));
  const profit = addMoney(margin, royalty);
  const payout = subMoney(pay, royalty);

  // 消費税はドライバーごとに（課税区分が違うため）
  const byDriver = new Map<string, { pay: number[]; royalty: number[]; taxMode: TaxMode }>();
  for (const r of rows) {
    const key = r.entry.driverId;
    const cur = byDriver.get(key) ?? { pay: [], royalty: [], taxMode: r.entry.taxMode };
    cur.pay.push(r.calc.pay);
    cur.royalty.push(r.calc.royalty);
    byDriver.set(key, cur);
  }
  const setting = input.tax ?? null;
  const tax = sumMoney(
    Array.from(byDriver.values()).map((d) =>
      calcTax(subMoney(sumMoney(d.pay), sumMoney(d.royalty)), setting ? { mode: d.taxMode, rate: setting.rate, rounding: setting.rounding } : null),
    ),
  );

  const expenseTotal = sumMoney(expenses.map((e) => e.amount));
  const expenseFixed = sumMoney(expenses.filter((e) => e.kind === "fixed").map((e) => e.amount));
  const expenseVariable = sumMoney(expenses.filter((e) => e.kind === "variable").map((e) => e.amount));
  const operatingProfit = subMoney(profit, expenseTotal);

  return {
    from: input.range.from,
    to: input.range.to,
    label: input.range.label,
    entryCount: rows.length,
    activeEntryCount: active.length,
    workDayCount: new Set(active.map((r) => r.entry.workDate)).size,
    driverCount: new Set(active.map((r) => r.entry.driverId)).size,
    qtyTotal: sumMoney(rows.map((r) => r.entry.qty)),
    bill,
    pay,
    margin,
    royalty,
    profit,
    profitRate: rateOf(profit, bill),
    payout,
    tax,
    payoutIncl: addMoney(payout, tax),
    expenseTotal,
    expenseFixed,
    expenseVariable,
    expenseCount: expenses.length,
    operatingProfit,
    operatingMargin: rateOf(operatingProfit, bill),
    openAlertCount: alerts.length,
    highAlertCount: alerts.filter((a) => a.severity === "high").length,
    cash: summarizeWeeklyCash(input.cash),
  };
}

/** 内訳の 1 行（ドライバー別・案件別に共通） */
export interface WeeklyBreakdownRow {
  name: string;
  entryCount: number;
  qty: number;
  bill: number;
  pay: number;
  profit: number;
  profitRate: number;
}

function breakdown(entries: readonly WeeklyEntryInput[], keyOf: (e: WeeklyEntryInput) => string, limit: number): WeeklyBreakdownRow[] {
  const groups = new Map<string, WeeklyEntryInput[]>();
  for (const e of entries) {
    const key = keyOf(e) || "（未設定）";
    const cur = groups.get(key);
    if (cur) cur.push(e);
    else groups.set(key, [e]);
  }
  const rows: WeeklyBreakdownRow[] = [];
  for (const [name, list] of groups) {
    const calcs = list.map((e) => calcEntry({ qty: e.qty, billRate: e.billRate, payRate: e.payRate, royaltyRate: e.royaltyRate, roundingMode: e.roundingMode }));
    const bill = sumMoney(calcs.map((c) => c.bill));
    const profit = sumMoney(calcs.map((c) => c.entryProfit));
    rows.push({
      name,
      entryCount: list.length,
      qty: sumMoney(list.map((e) => e.qty)),
      bill,
      pay: sumMoney(calcs.map((c) => c.pay)),
      profit,
      profitRate: rateOf(profit, bill),
    });
  }
  rows.sort((a, b) => b.bill - a.bill || a.name.localeCompare(b.name, "ja"));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/** ドライバー別の内訳（会社売上の多い順） */
export function weeklyDrivers(entries: readonly WeeklyEntryInput[], limit = 5): WeeklyBreakdownRow[] {
  return breakdown(entries, (e) => e.driverName, limit);
}

/** 案件別の内訳（会社売上の多い順。「案件名 内容名」でまとめる） */
export function weeklyProjects(entries: readonly WeeklyEntryInput[], limit = 5): WeeklyBreakdownRow[] {
  return breakdown(entries, (e) => [e.projectName, e.itemName].filter((v) => v).join(" "), limit);
}
