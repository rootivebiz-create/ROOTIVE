/**
 * 「先週いちばん大事だったこと」を日本語で最大 3 件（純関数）。
 * AI が使えないとき（ANTHROPIC_API_KEY が無いとき）は、この結果をそのまま所見として使う。
 */
import { pct, yen } from "@/lib/format";
import { formatDateJa } from "@/lib/month";
import type { WeeklyComparison } from "./compare";
import type { WeeklyAlertInput, WeeklyNumbers } from "./numbers";

/** 1 回のサマリーに出す件数の上限 */
export const MAX_HIGHLIGHTS = 3;

/** 前週比を「大きな変化」とみなすしきい値（±10%） */
export const BIG_CHANGE_RATE = 0.1;

function directionWord(diff: number): string {
  return diff > 0 ? "増えました" : "減りました";
}

/**
 * 先週の要点を重要な順に最大 3 件返す。
 * 稼働が 1 件も無い週でも必ず 1 件は返す（「記録がありません」）。
 */
export function weeklyHighlights(
  numbers: WeeklyNumbers,
  alerts: readonly WeeklyAlertInput[] = [],
  comparison?: WeeklyComparison | null,
): string[] {
  const out: string[] = [];
  const push = (text: string) => {
    if (text && out.length < MAX_HIGHLIGHTS && !out.includes(text)) out.push(text);
  };

  const highAlerts = alerts.filter((a) => a.severity === "high");

  // 1. 稼働が無い週は、まずそれを伝える
  if (numbers.activeEntryCount === 0) {
    push("先週は稼働の記録がありませんでした。日報の提出と承認の状況を確認してください。");
  }

  // 2. 重大な未対応
  if (highAlerts.length > 0) {
    const first = (highAlerts[0]?.title ?? "").trim();
    push(`重大な未対応が ${highAlerts.length} 件あります${first ? `（${first}）` : ""}。アプリのお知らせから確認してください。`);
  }

  // 3. 営業利益がマイナス
  if (numbers.activeEntryCount > 0 && numbers.operatingProfit < 0) {
    push(`先週の営業利益は ${yen(numbers.operatingProfit)} でした。経費 ${yen(numbers.expenseTotal)} が会社利益 ${yen(numbers.profit)} を上回っています。`);
  }

  // 4. 資金の見込みがマイナス
  if (numbers.cash && numbers.cash.endingBalance != null && numbers.cash.endingBalance < 0) {
    push(`このままだと ${formatDateJa(numbers.cash.to)}時点の資金は ${yen(numbers.cash.endingBalance)} の見込みです。入金と支払の時期を確認してください。`);
  }

  // 5. 売上の大きな増減（前週の数字があるときだけ）
  const bill = comparison?.hasPrevious ? comparison.byKey.bill : null;
  if (bill && bill.rate != null && Math.abs(bill.rate) >= BIG_CHANGE_RATE) {
    push(`売上は前週より ${yen(Math.abs(bill.diff))}（${pct(Math.abs(bill.rate))}）${directionWord(bill.diff)}。`);
  }

  // 6. 週の実績（いつも出したい基本の 1 行）
  if (numbers.activeEntryCount > 0) {
    push(`先週の売上は ${yen(numbers.bill)}、営業利益は ${yen(numbers.operatingProfit)}（営業利益率 ${pct(numbers.operatingMargin)}）でした。`);
    push(`稼働は ${numbers.entryCount} 件・${numbers.workDayCount} 日、ドライバーは ${numbers.driverCount} 名でした。`);
  }

  // 7. 重大以外の未対応
  if (numbers.openAlertCount > 0) {
    push(`未対応のお知らせが ${numbers.openAlertCount} 件あります。`);
  }

  // 8. それでも 1 件も無いときの保険
  if (out.length === 0) {
    push(`${numbers.label}のデータはまだありません。`);
  }
  return out;
}
