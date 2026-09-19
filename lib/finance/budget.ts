/**
 * 年間予算と予実対比の純関数（React・DB に依存しない）
 *
 * - 実績と目標は DB ビュー `v_month_kpi` の 1 行から取り出す（手計算をしない）
 * - 金額の合計は `lib/calc` の sumMoney（独自の丸めを書かない）
 * - 達成率は 実績 ÷ 目標。目標が 0 の月は「—」（null）
 * - 経費だけは「少ないほど良い」ので色分けを逆にする
 */
import { mulMoney, roundDisplay, subMoney, sumMoney } from "@/lib/calc";
import { dateToMonth } from "@/lib/month";
import { yearMonths } from "./date";

/** 予算で扱う 4 つの指標 */
export const BUDGET_METRICS = ["bill", "profit", "expense", "driver"] as const;
export type BudgetMetric = (typeof BUDGET_METRICS)[number];

export const BUDGET_METRIC_LABELS: Record<BudgetMetric, string> = {
  bill: "売上",
  profit: "営業利益",
  expense: "経費",
  driver: "ドライバー数",
};

export const BUDGET_METRIC_HINTS: Record<BudgetMetric, string> = {
  bill: "会社売上（税抜）",
  profit: "営業利益（会社利益 − 経費）",
  expense: "経費（税抜）。予算内に収まっていれば緑",
  driver: "数量のあった稼働ドライバーの人数",
};

/** 金額の指標（ドライバー数だけ人数） */
export function isMoneyMetric(metric: BudgetMetric): boolean {
  return metric !== "driver";
}

/** 少ないほど良い指標（経費だけ） */
export function isLowerBetter(metric: BudgetMetric): boolean {
  return metric === "expense";
}

export type BudgetValues = Record<BudgetMetric, number>;

export const ZERO_BUDGET_VALUES: BudgetValues = { bill: 0, profit: 0, expense: 0, driver: 0 };

/** v_month_kpi の 1 行のうち、予実対比で使う列だけ */
export interface MonthKpiLike {
  month: string | null;
  status?: string | null;
  bill?: number | null;
  operating_profit?: number | null;
  expense_total?: number | null;
  active_driver_count?: number | null;
  bill_target?: number | null;
  profit_target?: number | null;
  expense_target?: number | null;
  driver_target?: number | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** その月の目標（未設定は 0） */
export function targetsOf(kpi: MonthKpiLike | null | undefined): BudgetValues {
  return {
    bill: num(kpi?.bill_target),
    profit: num(kpi?.profit_target),
    expense: num(kpi?.expense_target),
    driver: num(kpi?.driver_target),
  };
}

/** その月の実績（行が無い月は 0） */
export function actualsOf(kpi: MonthKpiLike | null | undefined): BudgetValues {
  return {
    bill: num(kpi?.bill),
    profit: num(kpi?.operating_profit),
    expense: num(kpi?.expense_total),
    driver: num(kpi?.active_driver_count),
  };
}

/** 予実対比の 1 か月ぶん */
export interface BudgetRow {
  /** "YYYY-MM" */
  month: string;
  /** 締め済みの月 */
  closed: boolean;
  /** v_month_kpi に行があったか（稼働も経費も目標も無い月は false） */
  hasData: boolean;
  target: BudgetValues;
  actual: BudgetValues;
}

/** その年の 12 か月ぶんの行（データの無い月も 0 で埋める） */
export function toBudgetRows(year: number, kpis: MonthKpiLike[]): BudgetRow[] {
  const byMonth = new Map<string, MonthKpiLike>();
  for (const k of kpis) {
    const m = k.month ? dateToMonth(k.month) : "";
    if (m) byMonth.set(m, k);
  }
  return yearMonths(year).map((month) => {
    const k = byMonth.get(month);
    return { month, closed: k?.status === "closed", hasData: k != null, target: targetsOf(k), actual: actualsOf(k) };
  });
}

// ---------------------------------------------------------------------------
// 達成率と色分け
// ---------------------------------------------------------------------------

/** 100% 以上は緑 */
export const ACHIEVEMENT_GOOD = 1;
/** 80% 未満は赤 */
export const ACHIEVEMENT_BAD = 0.8;
/** 経費は 120% を超えたら赤（予算の 2 割超過） */
export const EXPENSE_ACHIEVEMENT_BAD = 1.2;

export type BudgetLevel = "good" | "warn" | "bad" | "none";

/**
 * 達成率の色分け
 * - 売上・営業利益・ドライバー数：100% 以上＝緑、80% 未満＝赤、その間＝黄
 * - 経費：100% 以下（予算内）＝緑、120% 超＝赤、その間＝黄
 * - 目標が未設定（null）＝色なし
 */
export function achievementLevel(achievement: number | null | undefined, metric: BudgetMetric = "bill"): BudgetLevel {
  if (achievement == null || !Number.isFinite(achievement)) return "none";
  if (isLowerBetter(metric)) {
    if (achievement <= ACHIEVEMENT_GOOD) return "good";
    return achievement <= EXPENSE_ACHIEVEMENT_BAD ? "warn" : "bad";
  }
  if (achievement >= ACHIEVEMENT_GOOD) return "good";
  return achievement < ACHIEVEMENT_BAD ? "bad" : "warn";
}

/** 目標 / 実績 / 差 / 達成率 */
export interface BudgetCompare {
  metric: BudgetMetric;
  target: number;
  actual: number;
  /** 実績 − 目標（経費はプラスが予算オーバー） */
  diff: number;
  /** 実績 ÷ 目標。目標が 0 のときは null */
  achievement: number | null;
  level: BudgetLevel;
}

export function compareBudget(metric: BudgetMetric, target: number, actual: number): BudgetCompare {
  const t = num(target);
  const a = num(actual);
  const diff = isMoneyMetric(metric) ? subMoney(a, t) : a - t;
  const achievement = t === 0 ? null : Math.round((a / t) * 1_000_000) / 1_000_000;
  return { metric, target: t, actual: a, diff, achievement, level: achievementLevel(achievement, metric) };
}

export function compareRow(row: BudgetRow, metric: BudgetMetric): BudgetCompare {
  return compareBudget(metric, row.target[metric], row.actual[metric]);
}

/** 差の説明（経費は「予算オーバー」「予算内」と言い換える） */
export function diffLabel(compare: BudgetCompare): string {
  if (compare.diff === 0) return "±0";
  if (isLowerBetter(compare.metric)) return compare.diff > 0 ? "予算オーバー" : "予算内";
  return compare.diff > 0 ? "目標超え" : "目標未達";
}

// ---------------------------------------------------------------------------
// 年間の合計
// ---------------------------------------------------------------------------

/** ドライバー数の月平均（0 の月は数えない。小数 1 桁） */
export function averageDrivers(rows: BudgetRow[], which: "target" | "actual"): number {
  const values = rows.map((r) => r[which].driver).filter((v) => v > 0);
  if (values.length === 0) return 0;
  const total = values.reduce((a, b) => a + b, 0);
  return Math.round((total / values.length) * 10) / 10;
}

export interface BudgetTotals {
  target: BudgetValues;
  actual: BudgetValues;
  /** 行数（ふつう 12） */
  months: number;
  /** v_month_kpi に行があった月の数 */
  actualMonths: number;
}

/** 年間の合計（ドライバー数だけ月平均） */
export function budgetTotals(rows: BudgetRow[]): BudgetTotals {
  const pick = (which: "target" | "actual", metric: BudgetMetric) => rows.map((r) => r[which][metric]);
  return {
    target: {
      bill: sumMoney(pick("target", "bill")),
      profit: sumMoney(pick("target", "profit")),
      expense: sumMoney(pick("target", "expense")),
      driver: averageDrivers(rows, "target"),
    },
    actual: {
      bill: sumMoney(pick("actual", "bill")),
      profit: sumMoney(pick("actual", "profit")),
      expense: sumMoney(pick("actual", "expense")),
      driver: averageDrivers(rows, "actual"),
    },
    months: rows.length,
    actualMonths: rows.filter((r) => r.hasData).length,
  };
}

/** 年間合計の予実対比（ドライバー数は月平均で比べる） */
export function budgetTotalCompare(rows: BudgetRow[], metric: BudgetMetric): BudgetCompare {
  const totals = budgetTotals(rows);
  return compareBudget(metric, totals.target[metric], totals.actual[metric]);
}

/** 合計行の見出し（ドライバー数だけ「月平均」） */
export function totalLabel(metric: BudgetMetric): string {
  return isMoneyMetric(metric) ? "年間合計" : "月平均";
}

/** 目標が 1 つでも入っているか */
export function hasAnyTarget(rows: BudgetRow[]): boolean {
  return rows.some((r) => BUDGET_METRICS.some((m) => r.target[m] > 0));
}

// ---------------------------------------------------------------------------
// かんたん入力（クライアントで入力欄を埋めるだけ。保存は 1 回）
// ---------------------------------------------------------------------------

/** 前年実績 ＋ ◯%（円未満・人未満は四捨五入） */
export function growValues(values: number[], percent: number): number[] {
  const rate = 1 + (Number.isFinite(percent) ? percent : 0) / 100;
  return values.map((v) => roundDisplay(mulMoney(num(v), rate)));
}

/** 全月に同じ値 */
export function sameValues(value: number, count = 12): number[] {
  const v = roundDisplay(num(value));
  return Array.from({ length: Math.max(0, count) }, () => v);
}

/** 年間合計から等分（端数は最終月で調整して合計をきっちり合わせる） */
export function splitEvenly(total: number, count = 12): number[] {
  if (count <= 0) return [];
  const t = roundDisplay(num(total));
  const base = Math.floor(t / count);
  const out = Array.from({ length: count }, () => base);
  out[count - 1] = t - base * (count - 1);
  return out;
}

/** 行から指標の実績だけを取り出す（前年実績 ＋ ◯% に使う） */
export function actualSeries(rows: BudgetRow[], metric: BudgetMetric): number[] {
  return rows.map((r) => r.actual[metric]);
}

/** 行から指標の目標だけを取り出す */
export function targetSeries(rows: BudgetRow[], metric: BudgetMetric): number[] {
  return rows.map((r) => r.target[metric]);
}
