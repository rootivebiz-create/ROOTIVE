/**
 * 経営指標の推移（純関数）
 *
 * `v_month_kpi` の行を 1 年（12 か月）ぶんに並べ直し、グラフと表で使う形にする。
 * 金額・率はビューの値をそのまま使い、ここでは 0 埋めと平均だけを行う。
 */
import type { MonthKpi } from "@/lib/db/types";
import { sumMoney } from "@/lib/calc/money";
import { monthRange } from "@/lib/month";
import { toKpiValues, type KpiValues } from "./metrics";

export interface KpiTrendRow extends KpiValues {
  /** "YYYY-MM"（データが無い月も入る） */
  month: string;
  /** グラフの横軸（"9月"） */
  label: string;
}

/** 12 か月ぶんに並べる（データが無い月は 0 埋め） */
export function toKpiTrendRows(rows: MonthKpi[], year: number): KpiTrendRow[] {
  return toKpiTrendRowsForMonths(rows, monthRange(`${year}-01`, `${year}-12`));
}

/** 指定した月（期の月など）に並べる（データが無い月は 0 埋め。0030） */
export function toKpiTrendRowsForMonths(rows: MonthKpi[], months: string[]): KpiTrendRow[] {
  const byMonth = new Map<string, MonthKpi>();
  for (const r of rows) {
    const values = toKpiValues(r);
    if (values.month) byMonth.set(values.month, r);
  }
  return months.map((m) => {
    const values = toKpiValues(byMonth.get(m));
    return { ...values, month: m, label: `${Number(m.slice(5, 7))}月` };
  });
}

/** 1 か月でも数字がある年か */
export function hasKpiTrendData(rows: KpiTrendRow[]): boolean {
  return rows.some((r) => r.hasData);
}

export interface KpiTrendSummary {
  /** 数字のある月数 */
  monthCount: number;
  /** 平均の限界利益率（売上合計 ÷ 限界利益合計。売上 0 なら 0） */
  contributionRate: number;
  /** 平均の営業利益率 */
  operatingMargin: number;
  /** 損益分岐点を下回った（赤字の）月数 */
  belowBreakEvenCount: number;
  /** いちばん損益分岐点比率が高かった（苦しかった）月 */
  worst: KpiTrendRow | null;
  /** いちばん営業利益が多かった月 */
  best: KpiTrendRow | null;
  bill: number;
  contribution: number;
  operatingProfit: number;
}

/** 年間の平均と、良かった月・苦しかった月 */
export function kpiTrendSummary(rows: KpiTrendRow[]): KpiTrendSummary {
  const withData = rows.filter((r) => r.hasData);
  const bill = sumMoney(withData.map((r) => r.bill));
  const contribution = sumMoney(withData.map((r) => r.contribution));
  const operatingProfit = sumMoney(withData.map((r) => r.operatingProfit));
  const rated = withData.filter((r) => r.breakEvenRatio != null);
  const worst = rated.length > 0 ? rated.reduce((a, b) => ((b.breakEvenRatio ?? 0) > (a.breakEvenRatio ?? 0) ? b : a)) : null;
  const best = withData.length > 0 ? withData.reduce((a, b) => (b.operatingProfit > a.operatingProfit ? b : a)) : null;
  return {
    monthCount: withData.length,
    contributionRate: bill !== 0 ? contribution / bill : 0,
    operatingMargin: bill !== 0 ? operatingProfit / bill : 0,
    belowBreakEvenCount: withData.filter((r) => r.operatingProfit < 0).length,
    worst,
    best,
    bill,
    contribution,
    operatingProfit,
  };
}
