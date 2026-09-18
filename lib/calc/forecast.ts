import { fromS4, subMoney, sumMoney, toS4 } from "./money";
import { compareMonth, currentMonthJST, daysInMonth } from "@/lib/month";

/**
 * 今月の着地見込み（月末の予測）
 *
 * ■ 予測の考え方
 * 稼働は「月 × ドライバー × 案件内容の数量」で持っており日付ごとの明細が無いため、
 * 月の経過に対する按分（実績 ÷ 経過率）で月末を見込む。
 *  - 経過率 progress ＝ 当月なら「今日（日本時間） ÷ 月の日数」、過去月は 1、未来月は 0
 *  - 売上・ドライバー支払・ロイヤリティ・調整は月の経過に比例するとみなして按分する
 *  - 管理費（mgmt_fee）は月額で決まっているため按分しない。
 *    会社利益は「按分する部分（利益 − 管理費）を按分して管理費を足し戻す」、
 *    支払額は「按分する部分（支払 ＋ 管理費）を按分して管理費を引き直す」形で見込む
 *    （payout = Σpay − Σroyalty − 管理費 + Σ調整、profit = Σmargin + Σroyalty + 管理費 + Σ調整 のため）
 *  - 経費のうち固定費（expense_fixed）は月の初めに計上されることが多いため按分せずそのままの額を使い、
 *    変動費（expense_variable）だけを按分する
 *  - 営業利益の見込み ＝ 会社利益の見込み − 経費の見込み
 *  - 過去月・締め済みの月は予測せず実績をそのまま返す（basis: "actual"）
 *  - 稼働が 1 件も無い月・未来月は予測できない（basis: "none"）ので実績をそのまま返す
 *  - 経過率が浅いほど予測の幅が大きいので reliability（low / medium / high）を添える
 *
 * 日付は引数（now）で受け取り、日本時間で判定する純関数。
 */

/** 予測の根拠：actual ＝ 実績そのまま／prorated ＝ 経過率で按分／none ＝ 実績が無くて予測できない */
export type ForecastBasis = "actual" | "prorated" | "none";

/** 見込みの確からしさ（経過率で決まる） */
export type ForecastReliability = "low" | "medium" | "high";

/** medium の下限（これ未満は low ＝「まだ月初のため参考値」） */
export const FORECAST_MEDIUM_MIN = 0.2;
/** high の下限 */
export const FORECAST_HIGH_MIN = 0.6;

/** 月の実績（v_month_pl の値をそのまま渡す。金額はすべて税抜） */
export interface ForecastActual {
  /** 会社売上 */
  bill: number;
  /** ドライバー支払合計（税抜） */
  payout: number;
  /** 会社利益 */
  profit: number;
  /** 管理費（按分しない） */
  mgmtFee: number;
  /** 経費の合計 */
  expenseTotal: number;
  /** 固定費（按分しない） */
  expenseFixed: number;
  /** 変動費（按分する） */
  expenseVariable: number;
  /** 営業利益 ＝ 会社利益 − 経費 */
  operatingProfit: number;
  /** 稼働行の件数（0 なら予測できない） */
  entryCount: number;
  /** 月次目標（0 ＝ 未設定） */
  billTarget: number;
  profitTarget: number;
}

export interface ForecastInput {
  /** 稼動月 "YYYY-MM" */
  month: string;
  /** 判定の基準時刻（日本時間で解釈する） */
  now: Date;
  actual: ForecastActual;
  /** 締め済みの月（実績をそのまま返す） */
  isClosed?: boolean;
}

export interface ForecastResult {
  month: string;
  /** その月の日数 */
  days: number;
  /** 経過日数（当月は日本時間の今日、過去月は月の日数、未来月は 0） */
  elapsedDays: number;
  /** 月の経過率 0〜1 */
  progress: number;
  /** 基準日 "YYYY-MM-DD"（当月のときだけ。過去月・未来月は null） */
  asOfDate: string | null;
  basis: ForecastBasis;
  reliability: ForecastReliability;
  /** 実績（入力そのまま） */
  bill: number;
  payout: number;
  profit: number;
  expenseTotal: number;
  operatingProfit: number;
  /** 月末の見込み */
  billForecast: number;
  payoutForecast: number;
  profitForecast: number;
  expenseForecast: number;
  operatingProfitForecast: number;
  /** 見込みベースの達成率（目標未設定 ＝ 0 なら null） */
  billTargetRate: number | null;
  profitTargetRate: number | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 日本時間の日付 "YYYY-MM-DD" */
function jstDateParts(now: Date): { month: string; day: number; date: string } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = jst.getUTCDate();
  return { month: `${y}-${m}`, day: d, date: `${y}-${m}-${String(d).padStart(2, "0")}` };
}

/**
 * 実績 ÷ 経過率。金額として小数 4 桁精度に丸める（独自の丸めはせず money の S4 精度に合わせる）
 * 経過率が 0 以下（予測できない）・1 以上（月末・過去月）のときは実績のまま
 */
function prorate(actual: number, progress: number): number {
  if (!(progress > 0) || progress >= 1) return actual;
  return fromS4(toS4(actual / progress));
}

/** 経過率から見込みの確からしさを決める（0.2 未満 low ／ 0.2〜0.6 medium ／ 0.6 以上 high） */
export function forecastReliability(progress: number): ForecastReliability {
  if (progress >= FORECAST_HIGH_MIN) return "high";
  if (progress >= FORECAST_MEDIUM_MIN) return "medium";
  return "low";
}

/** 月末の着地見込み（§経営の見える化）。集計値は v_month_pl の実績をそのまま渡す */
export function forecastMonth(input: ForecastInput): ForecastResult {
  const { month } = input;
  const days = daysInMonth(month);
  const today = jstDateParts(input.now);
  const cmp = compareMonth(month, currentMonthJST(input.now));
  const isCurrent = cmp === 0;
  const isPast = cmp < 0;

  // 経過日数：当月は日本時間の「今日」、過去月は月の日数、未来月は 0
  const elapsedDays = isCurrent ? Math.min(today.day, days) : isPast ? days : 0;
  const progress = days > 0 ? elapsedDays / days : 0;
  const asOfDate = isCurrent ? today.date : null;

  const bill = num(input.actual.bill);
  const payout = num(input.actual.payout);
  const profit = num(input.actual.profit);
  const mgmtFee = num(input.actual.mgmtFee);
  const expenseTotal = num(input.actual.expenseTotal);
  const expenseFixed = num(input.actual.expenseFixed);
  const expenseVariable = num(input.actual.expenseVariable);
  const operatingProfit = num(input.actual.operatingProfit);
  const entryCount = num(input.actual.entryCount);
  const billTarget = num(input.actual.billTarget);
  const profitTarget = num(input.actual.profitTarget);

  // 締め済み・過去月は確定しているので予測しない。稼働が無い月・未来月は予測できない
  const basis: ForecastBasis = input.isClosed || isPast ? "actual" : entryCount <= 0 || progress <= 0 ? "none" : "prorated";

  const billForecast = basis === "prorated" ? prorate(bill, progress) : bill;
  // 管理費は月額で決まっているため按分しない（利益からは外して按分し、あとで足し戻す）
  const profitForecast = basis === "prorated" ? sumMoney([prorate(subMoney(profit, mgmtFee), progress), mgmtFee]) : profit;
  // 支払額も同じく、管理費を戻して按分してから引き直す
  const payoutForecast = basis === "prorated" ? subMoney(prorate(sumMoney([payout, mgmtFee]), progress), mgmtFee) : payout;
  // 固定費は按分せず、変動費だけ按分する
  const expenseForecast = basis === "prorated" ? sumMoney([expenseFixed, prorate(expenseVariable, progress)]) : expenseTotal;
  const operatingProfitForecast = basis === "prorated" ? subMoney(profitForecast, expenseForecast) : operatingProfit;

  return {
    month,
    days,
    elapsedDays,
    progress,
    asOfDate,
    basis,
    // 実績が確定している月は確からしさも high として扱う
    reliability: basis === "actual" ? "high" : forecastReliability(progress),
    bill,
    payout,
    profit,
    expenseTotal,
    operatingProfit,
    billForecast,
    payoutForecast,
    profitForecast,
    expenseForecast,
    operatingProfitForecast,
    billTargetRate: billTarget > 0 ? billForecast / billTarget : null,
    profitTargetRate: profitTarget > 0 ? operatingProfitForecast / profitTarget : null,
  };
}
