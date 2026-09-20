/**
 * 現金があと何日もつか（ランウェイ）— 純関数
 *
 * - 入力は RPC `cash_forecast` の行（入金 ＋／支払 −、税込）と起点の残高（`cash_snapshots`）
 * - 残高の積み上げは `components/cashflow/helpers.ts` の `buildCashTimeline` / `cashSummary` を
 *   そのまま使う。資金繰り画面・CSV と同じ考え方・同じ丸めにするため、ここで積み上げを書き直さない
 * - 金額の足し引きは `lib/calc/money` の `sumMoney` / `subMoney`（独自の丸めは書かない）
 * - 基準日は引数（from）で受け取る。`new Date()` / `Date.now()` には依存しない
 */
import { buildCashTimeline, cashSummary, daysBetween, formatMonthDayJa } from "@/components/cashflow/helpers";
import { roundDisplay, subMoney } from "@/lib/calc/money";
import type { CashEvent } from "@/lib/db/types";

/** 資金の信号 */
export type RunwayStatus = "safe" | "watch" | "danger";

export const RUNWAY_STATUS_LABELS: Record<RunwayStatus, string> = {
  safe: "余裕あり",
  watch: "注意",
  danger: "危険",
};

/** safe の下限（これ以上もてば余裕あり） */
export const RUNWAY_SAFE_DAYS = 90;
/** watch の下限（これ未満は危険） */
export const RUNWAY_WATCH_DAYS = 30;
/** 持ち月数を出すときの 1 か月の日数 */
export const RUNWAY_DAYS_PER_MONTH = 30;

export interface RunwayInput {
  /** 起点の日付 "YYYY-MM-DD"（基準日。ここから数える） */
  from: string;
  /** 見る期間の終わり "YYYY-MM-DD" */
  to: string;
  /** 起点の残高（`cash_snapshots` の最新。未登録なら 0） */
  openingBalance: number;
  /** RPC `cash_forecast` の行（入金 ＋／支払 −） */
  events: readonly CashEvent[];
}

export interface RunwayResult {
  from: string;
  to: string;
  openingBalance: number;
  /** 見た期間の日数（起点からの日数。to が起点と同じなら 0） */
  coveredDays: number;
  /** いちばん残高が少なくなる額（起点の残高も候補に入れる） */
  minBalance: number;
  /** いちばん残高が少なくなる日 */
  minBalanceOn: string;
  /** 残高がマイナスになる最初の日（ならなければ null） */
  zeroOn: string | null;
  /** 起点から zeroOn までの日数（zeroOn が null なら null） */
  daysLeft: number | null;
  /** もつ日数＝マイナスになるならその日まで、ならなければ見た期間の日数 */
  holdDays: number;
  /** 直近の平均支出から割り出した持ち月数（小数 1 桁。支出が無ければ null） */
  monthsLeft: number | null;
  /** マイナスになるなら、いちばん足りない額（正の数）。ならなければ 0 */
  shortfall: number;
  status: RunwayStatus;
  /** 期間内の入金の合計（正の数） */
  inflow: number;
  /** 期間内の支払の合計（正の数） */
  outflow: number;
  /** 入金 − 支払 */
  net: number;
  /** 期間の終わりの残高 */
  endingBalance: number;
  /** 予定の件数（0 なら判断材料が無い） */
  eventCount: number;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 起点から date までの日数（両端を含まない差。date が起点なら 0） */
function daysFrom(from: string, date: string): number {
  return Math.max(0, daysBetween(from, date) - 1);
}

/**
 * 資金の信号を決める。
 *
 * 判定の順番（上から順に当てはめる）：
 *   1. 期間内に残高がマイナスになる見込みがある → danger（日数にかかわらず。壁が見えているため）
 *   2. もつ日数が 30 日未満 → danger（30 日先の資金が見えていない）
 *   3. もつ日数が 90 日未満（30〜89 日）→ watch
 *   4. それ以外（90 日以上もつ）→ safe
 */
export function runwayStatus(holdDays: number, goesNegative: boolean): RunwayStatus {
  if (goesNegative) return "danger";
  if (holdDays < RUNWAY_WATCH_DAYS) return "danger";
  if (holdDays < RUNWAY_SAFE_DAYS) return "watch";
  return "safe";
}

/**
 * 現金があと何日もつかを出す。
 * 起点の残高から日付順に積み上げ、いちばん少なくなる日・マイナスになる日・持ち月数・信号を返す。
 */
export function calcRunway(opts: RunwayInput): RunwayResult {
  const from = opts.from;
  const to = opts.to;
  const openingBalance = num(opts.openingBalance);

  // 積み上げは資金繰り画面と同じ純関数に任せる（ここで計算し直さない）
  const timeline = buildCashTimeline({ events: [...opts.events], openingBalance, from, to });
  const summary = cashSummary(timeline);

  // いちばん少ない残高：起点の残高も候補に入れる（入金しか無い月は起点が最低になるため）
  let minBalance = openingBalance;
  let minBalanceOn = from;
  if (summary.minBalance != null && summary.minBalance < minBalance) {
    minBalance = summary.minBalance;
    minBalanceOn = summary.minBalanceDate ?? from;
  }

  // 起点でもうマイナスなら、その日がマイナスになる日
  const zeroOn = openingBalance < 0 ? from : summary.firstNegativeDate;
  const daysLeft = zeroOn == null ? null : daysFrom(from, zeroOn);
  const coveredDays = daysFrom(from, to);
  const holdDays = daysLeft ?? coveredDays;

  // 持ち月数：入金が止まったと考え、いまの残高を「1 か月あたりの平均支出」で割る
  const monthlyOutflow = coveredDays > 0 ? (summary.outflow / coveredDays) * RUNWAY_DAYS_PER_MONTH : 0;
  const monthsLeft =
    monthlyOutflow > 0 ? Math.max(0, roundDisplay((Math.max(0, openingBalance) / monthlyOutflow) * 10) / 10) : null;

  const lastDay = timeline.length > 0 ? timeline[timeline.length - 1] : null;

  return {
    from,
    to,
    openingBalance,
    coveredDays,
    minBalance,
    minBalanceOn,
    zeroOn,
    daysLeft,
    holdDays,
    monthsLeft,
    shortfall: minBalance < 0 ? subMoney(0, minBalance) : 0,
    status: runwayStatus(holdDays, zeroOn != null),
    inflow: summary.inflow,
    outflow: summary.outflow,
    net: summary.net,
    endingBalance: lastDay ? lastDay.balance : openingBalance,
    eventCount: summary.eventCount,
  };
}

/** 資金の状態を 1 行の日本語にする（画面のバッジの下・朝のひとことで使う） */
export function runwayText(runway: RunwayResult | null | undefined): string {
  if (!runway) return "資金の見込みはまだ出せません。";
  if (runway.zeroOn != null) {
    return `現金はあと ${runway.daysLeft ?? 0} 日です（${formatMonthDayJa(runway.zeroOn)}に残高がマイナスの見込み）。`;
  }
  return `現金は ${runway.coveredDays} 日先まで足りる見込みです。`;
}
