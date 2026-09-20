/**
 * 前週比（純関数）。増減額・増減率と、上向き／下向きの判定を返す。
 * 金額の引き算は lib/calc の subMoney を使う（独自の丸めは書かない）。
 */
import { subMoney } from "@/lib/calc";
import type { WeeklyNumbers } from "./numbers";

/** 比較する項目 */
export type WeeklyMetricKey = "bill" | "profit" | "operatingProfit" | "payoutIncl" | "expenseTotal" | "entryCount" | "workDayCount" | "driverCount";

export const WEEKLY_METRIC_KEYS: WeeklyMetricKey[] = ["bill", "profit", "operatingProfit", "payoutIncl", "expenseTotal", "entryCount", "workDayCount", "driverCount"];

export const WEEKLY_METRIC_LABELS: Record<WeeklyMetricKey, string> = {
  bill: "売上",
  profit: "会社利益",
  operatingProfit: "営業利益",
  payoutIncl: "支払（税込）",
  expenseTotal: "経費",
  entryCount: "稼働件数",
  workDayCount: "稼働日数",
  driverCount: "稼働ドライバー",
};

/** 金額の項目（表示で ¥ を付けるか、件数として扱うか） */
export const WEEKLY_METRIC_IS_MONEY: Record<WeeklyMetricKey, boolean> = {
  bill: true,
  profit: true,
  operatingProfit: true,
  payoutIncl: true,
  expenseTotal: true,
  entryCount: false,
  workDayCount: false,
  driverCount: false,
};

/** 減ったほうが良い項目（経費・支払） */
const LOWER_IS_BETTER: Record<WeeklyMetricKey, boolean> = {
  bill: false,
  profit: false,
  operatingProfit: false,
  payoutIncl: false,
  expenseTotal: true,
  entryCount: false,
  workDayCount: false,
  driverCount: false,
};

export type WeeklyDirection = "up" | "down" | "flat";

/** 1 項目の前週比 */
export interface WeeklyDelta {
  key: WeeklyMetricKey;
  label: string;
  isMoney: boolean;
  current: number;
  previous: number;
  /** 増減額（今週 − 前週） */
  diff: number;
  /** 増減率（前週が 0 のときは null）。前週がマイナスでも符号が逆にならないよう絶対値で割る */
  rate: number | null;
  direction: WeeklyDirection;
  /** 事業として望ましい向きか（経費は減ったほうが良い） */
  isGood: boolean;
}

/** 前週比のまとめ */
export interface WeeklyComparison {
  /** 前週の数字があるか（無いときは増減を画面に出さない） */
  hasPrevious: boolean;
  items: WeeklyDelta[];
  byKey: Record<WeeklyMetricKey, WeeklyDelta>;
}

function valueOf(numbers: WeeklyNumbers, key: WeeklyMetricKey): number {
  return Number(numbers[key] ?? 0);
}

function deltaOf(key: WeeklyMetricKey, current: number, previous: number): WeeklyDelta {
  const diff = subMoney(current, previous);
  const direction: WeeklyDirection = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const lower = LOWER_IS_BETTER[key];
  return {
    key,
    label: WEEKLY_METRIC_LABELS[key],
    isMoney: WEEKLY_METRIC_IS_MONEY[key],
    current,
    previous,
    diff,
    rate: previous !== 0 ? diff / Math.abs(previous) : null,
    direction,
    isGood: direction === "flat" ? true : lower ? direction === "down" : direction === "up",
  };
}

/**
 * 前週比を作る。
 * previous が null（前週の数字が無い）ときは previous を 0 として増減額だけ返し、
 * hasPrevious を false にする（画面・LINE では増減を出さない）。
 */
export function compareWeeks(current: WeeklyNumbers, previous: WeeklyNumbers | null | undefined): WeeklyComparison {
  const items = WEEKLY_METRIC_KEYS.map((key) => deltaOf(key, valueOf(current, key), previous ? valueOf(previous, key) : 0));
  const byKey = Object.fromEntries(items.map((d) => [d.key, d])) as Record<WeeklyMetricKey, WeeklyDelta>;
  return { hasPrevious: Boolean(previous), items, byKey };
}
