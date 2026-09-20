/**
 * 予実の差を 5 つに分解する（純関数）
 *
 * 「なぜ営業利益が目標より少ない（多い）のか」を代表が一目で分かるようにする。
 *
 * ■ 使う式
 *     営業利益 ＝ 人数 × 1 人当たり売上 × 会社利益率 − 経費
 *     会社利益率 ＝ 粗利率 ＋ その他の利益率（ロイヤリティ・管理費・調整 ÷ 売上）
 *
 * ■ 割り振り方（目標から実績へ 1 つずつ入れ替えていく。順番に効き目を取り出す）
 *   1. 人数     ＝ (実績の人数 − 目標の人数) × 目標の 1 人当たり売上 × 目標の会社利益率
 *   2. 稼働量   ＝ (実績の売上 − 実績の人数 × 目標の 1 人当たり売上) × 目標の会社利益率
 *   3. 受注単価 ＝ 実績の売上 × (実績の粗利率 − 目標の粗利率)
 *   4. 支払単価 ＝ 実績の売上 × (実績のその他の利益率 − 目標のその他の利益率)
 *   5. 経費     ＝ 実際の差 − 1〜4（計算すると「目標の経費 − 実績の経費」になる。端数もここが吸収する）
 *   1〜5 を足すと必ず「実績の営業利益 − 目標の営業利益」に一致する。
 *
 * ■ 目標に無い数字の補い方（`month_targets` にあるのは売上・営業利益・経費・人数の 4 つだけ）
 *   - 目標の人数・経費が 0（未設定）なら実績と同じとみなす（その項目の差は 0 になる）
 *   - 目標の粗利率は `month_targets` に無い。既定では「ロイヤリティ率と管理費は契約で決まっていて
 *     目標に置くものではない」と考え、目標のその他の利益率 ＝ 実績のその他の利益率 として逆算する
 *     （＝ 単価の差はすべて「受注単価」に出て、「支払単価」は 0 になる）。
 *     粗利率の目標を持っている会社は `plan.marginRate` に渡すと受注単価と支払単価に分かれる
 *
 * 金額の足し引きは `lib/calc/money` の `sumMoney` / `subMoney`、
 * 割り算の結果は `lib/calc/forecast.ts` と同じく S4（小数 4 桁）へそろえる（独自の丸めは書かない）。
 */
import { fromS4, subMoney, sumMoney, toS4 } from "@/lib/calc/money";
import { pct, qty, yen } from "@/lib/format";

export type VarianceKey = "drivers" | "volume" | "billRate" | "payRate" | "expense";

/** ＋ ＝ 営業利益を押し上げた／− ＝ 押し下げた */
export type VarianceDirection = "plus" | "minus";

export const VARIANCE_KEYS: VarianceKey[] = ["drivers", "volume", "billRate", "payRate", "expense"];

export const VARIANCE_LABELS: Record<VarianceKey, string> = {
  drivers: "人数",
  volume: "稼働量",
  billRate: "受注単価",
  payRate: "支払単価",
  expense: "経費",
};

export interface VarianceItem {
  key: VarianceKey;
  /** 日本語の見出し */
  label: string;
  /** 営業利益への効き（＋は目標より増やした、−は減らした） */
  amount: number;
  direction: VarianceDirection;
  /** 何がどれだけ違ったかの一言 */
  detail: string;
}

/** 月の目標（`month_targets` / `v_month_kpi` の目標列をそのまま渡す） */
export interface VariancePlan {
  /** 売上の目標。0（未設定）なら予実を比べない（空配列を返す） */
  bill: number;
  /** 営業利益の目標 */
  operatingProfit: number;
  /** 経費の目標（0・未設定なら実績と同じとみなす） */
  expense?: number;
  /** 稼働ドライバー数の目標（0・未設定なら実績と同じとみなす） */
  driverCount?: number;
  /** 粗利率の目標（未設定なら実績のその他の利益率から逆算する。■ の説明を参照） */
  marginRate?: number | null;
}

/** 月の実績（`v_month_pl` と `v_month_kpi` の値をそのまま渡す） */
export interface VarianceActual {
  /** 会社売上（v_month_pl.bill） */
  bill: number;
  /** 粗利（v_month_pl.margin） */
  margin: number;
  /** 会社利益（v_month_pl.profit） */
  profit: number;
  /** 経費の合計（v_month_pl.expense_total） */
  expenseTotal: number;
  /** 営業利益（v_month_pl.operating_profit） */
  operatingProfit: number;
  /** 稼働ドライバー数（v_month_pl.active_driver_count） */
  activeDriverCount: number;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 割り算・率の掛け算の結果を金額の精度（小数 4 桁）へそろえる */
function money(x: number): number {
  return Number.isFinite(x) ? fromS4(toS4(x)) : 0;
}

function directionOf(amount: number): VarianceDirection {
  return amount < 0 ? "minus" : "plus";
}

/** 「多い／少ない」「高い／低い」の言い回し */
function moreOrLess(diff: number, more: string, less: string, same: string): string {
  if (diff > 0) return more;
  if (diff < 0) return less;
  return same;
}

function item(key: VarianceKey, amount: number, detail: string): VarianceItem {
  return { key, label: VARIANCE_LABELS[key], amount, direction: directionOf(amount), detail };
}

/**
 * 営業利益の予実の差を 人数・稼働量・受注単価・支払単価・経費 の 5 つに割り振る。
 * 売上の目標が 0（未設定）の月は比べられないので空配列を返す。
 */
export function explainVariance(plan: VariancePlan, actual: VarianceActual): VarianceItem[] {
  const planBill = num(plan.bill);
  if (!(planBill > 0)) return [];

  const planOperatingProfit = num(plan.operatingProfit);
  const actualBill = num(actual.bill);
  const actualExpense = num(actual.expenseTotal);
  const actualDrivers = num(actual.activeDriverCount);

  // 目標に無い数字は実績で補う（その項目の差は 0 になる）
  const planExpense = num(plan.expense) > 0 ? num(plan.expense) : actualExpense;
  const planDrivers = num(plan.driverCount) > 0 ? num(plan.driverCount) : actualDrivers;

  // 率：目標の会社利益率は「目標の営業利益 ＋ 目標の経費 ÷ 目標の売上」
  const planProfitRate = (planOperatingProfit + planExpense) / planBill;
  const actualProfitRate = actualBill !== 0 ? num(actual.profit) / actualBill : 0;
  const actualMarginRate = actualBill !== 0 ? num(actual.margin) / actualBill : 0;
  // その他の利益率＝ロイヤリティ・管理費・調整のぶん（会社利益率 − 粗利率）
  const actualOtherRate = actualProfitRate - actualMarginRate;
  const planMarginRate = plan.marginRate == null ? planProfitRate - actualOtherRate : num(plan.marginRate);
  const planOtherRate = planProfitRate - planMarginRate;

  // 1. 人数／2. 稼働量：売上の差を「人数 × 1 人当たり売上」に分ける
  const planBillPerDriver = planDrivers > 0 ? planBill / planDrivers : 0;
  const driverDiff = actualDrivers - planDrivers;
  const driversAmount = planDrivers > 0 ? money(driverDiff * planBillPerDriver * planProfitRate) : 0;
  const volumeBillDiff = planDrivers > 0 ? actualBill - actualDrivers * planBillPerDriver : actualBill - planBill;
  const volumeAmount = money(volumeBillDiff * planProfitRate);

  // 3. 受注単価（粗利率の差）／4. 支払単価（粗利率で説明できない残り＝支払比率の効き）
  const marginRateDiff = actualMarginRate - planMarginRate;
  const otherRateDiff = actualOtherRate - planOtherRate;
  const billRateAmount = money(actualBill * marginRateDiff);
  const payRateAmount = money(actualBill * otherRateDiff);

  // 5. 経費：実際の差から 1〜4 を引いた残り（＝ 目標の経費 − 実績の経費。端数もここで吸収する）
  const diff = subMoney(num(actual.operatingProfit), planOperatingProfit);
  const expenseAmount = subMoney(diff, sumMoney([driversAmount, volumeAmount, billRateAmount, payRateAmount]));

  const actualBillPerDriver = actualDrivers > 0 ? actualBill / actualDrivers : 0;
  const billPerDriverDiff = planDrivers > 0 ? actualBillPerDriver - planBillPerDriver : 0;
  const expenseDiff = subMoney(actualExpense, planExpense);

  return [
    item(
      "drivers",
      driversAmount,
      planDrivers > 0
        ? `稼働ドライバーは ${qty(actualDrivers)} 名（目標 ${qty(planDrivers)} 名）で、${moreOrLess(driverDiff, `${qty(Math.abs(driverDiff))} 名多い`, `${qty(Math.abs(driverDiff))} 名少ない`, "目標どおり")}です。`
        : "人数の目標がありません。",
    ),
    item(
      "volume",
      volumeAmount,
      planDrivers > 0
        ? `1 人当たりの売上は ${yen(actualBillPerDriver)}（目標 ${yen(planBillPerDriver)}）で、${moreOrLess(billPerDriverDiff, `${yen(Math.abs(billPerDriverDiff))} 多い`, `${yen(Math.abs(billPerDriverDiff))} 少ない`, "目標どおり")}です。`
        : `売上は ${yen(actualBill)}（目標 ${yen(planBill)}）です。`,
    ),
    item(
      "billRate",
      billRateAmount,
      `粗利率は ${pct(actualMarginRate)}（目標 ${pct(planMarginRate)}）で、${moreOrLess(marginRateDiff, `${pct(Math.abs(marginRateDiff))} 高い`, `${pct(Math.abs(marginRateDiff))} 低い`, "目標どおり")}です。`,
    ),
    item(
      "payRate",
      payRateAmount,
      // 率そのものは割り算の誤差が残るので、金額に直したうえで「目標どおり」かを決める
      payRateAmount === 0
        ? "支払（ロイヤリティ・管理費を含む）の比率は目標どおりです。"
        : `支払（ロイヤリティ・管理費を含む）の比率が目標より ${pct(Math.abs(otherRateDiff))} ${moreOrLess(otherRateDiff, "低い", "高い", "同じ")}です。`,
    ),
    item(
      "expense",
      expenseAmount,
      `経費は ${yen(actualExpense)}（目標 ${yen(planExpense)}）で、${moreOrLess(expenseDiff, `${yen(Math.abs(expenseDiff))} 多い`, `${yen(Math.abs(expenseDiff))} 少ない`, "目標どおり")}です。`,
    ),
  ];
}

/** 5 項目の合計（実際の差と一致する） */
export function varianceTotal(items: readonly VarianceItem[]): number {
  return sumMoney(items.map((i) => i.amount));
}

/** いちばん効き目の大きい項目（差が 0 の項目しか無ければ null） */
export function biggestVariance(items: readonly VarianceItem[]): VarianceItem | null {
  let best: VarianceItem | null = null;
  for (const i of items) {
    if (i.amount === 0) continue;
    if (best == null || Math.abs(i.amount) > Math.abs(best.amount)) best = i;
  }
  return best;
}

/** 営業利益を押し下げた順（マイナスの大きい順）に並べ替える */
export function sortVarianceByImpact(items: readonly VarianceItem[]): VarianceItem[] {
  return [...items].sort((a, b) => a.amount - b.amount || VARIANCE_KEYS.indexOf(a.key) - VARIANCE_KEYS.indexOf(b.key));
}
