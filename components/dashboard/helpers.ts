/**
 * ダッシュボードの目標進捗・経費内訳の計算（純関数）
 * 金額は DB ビュー（v_month_pl / v_expense_summary）と month_targets の値をそのまま使う。
 */
import type { ExpenseSummaryRow } from "@/lib/db/types";
import { subMoney, sumMoney } from "@/lib/calc/money";
import { expenseRanking, type ExpenseRankRow } from "@/components/reports/helpers";

/** 月次目標に対する進捗 */
export interface TargetProgress {
  target: number;
  actual: number;
  /** 達成率（目標が 0 なら null ＝「目標未設定」） */
  rate: number | null;
  /** 目標までの残り（達成済み・目標 0 なら 0） */
  remaining: number;
  achieved: boolean;
  /** 進捗バーの幅 0〜1（100% で頭打ち、実績がマイナスなら 0） */
  barRatio: number;
}

/** 達成率・残り金額（目標 0 ＝ 未設定は rate を null にする） */
export function targetProgress(actual: number, target: number): TargetProgress {
  if (!(target > 0)) {
    return { target: target > 0 ? target : 0, actual, rate: null, remaining: 0, achieved: false, barRatio: 0 };
  }
  const rate = actual / target;
  const remaining = actual >= target ? 0 : subMoney(target, actual);
  return {
    target,
    actual,
    rate,
    remaining,
    achieved: actual >= target,
    barRatio: Math.min(1, Math.max(0, rate)),
  };
}

/** 目標が 1 つでも設定されているか */
export function hasTarget(billTarget: number, profitTarget: number): boolean {
  return billTarget > 0 || profitTarget > 0;
}

export interface ExpenseBreakdown {
  /** 上位 limit 件（金額の降順） */
  rows: ExpenseRankRow[];
  /** 上位に入らなかったカテゴリの合計 */
  othersAmount: number;
  othersCount: number;
  total: number;
}

/** カテゴリ別の経費内訳（上位 limit 件 ＋ その他） */
export function expenseBreakdown(rows: ExpenseSummaryRow[], limit = 5): ExpenseBreakdown {
  const ranked = expenseRanking(rows);
  const top = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  return {
    rows: top,
    othersAmount: sumMoney(rest.map((r) => r.amount)),
    othersCount: rest.length,
    total: sumMoney(ranked.map((r) => r.amount)),
  };
}

/** 「経費が 1 件も登録されていません」の警告を出すか（未締め月かつ稼働行があるとき） */
export function needsExpenseWarning(input: { isClosed: boolean; entryCount: number; expenseCount: number }): boolean {
  return !input.isClosed && input.entryCount > 0 && input.expenseCount === 0;
}
