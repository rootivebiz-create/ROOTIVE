/**
 * 日報・点呼（/daily）のタブ
 * 「労務」は日報の時刻から出す見える化で、入力するものが無いため lib/schemas/daily.ts の入力スキーマには入れていない。
 * ここで ?tab=labor だけを足して、残りは dayTabFromParam に任せる。
 */
import { dayTabFromParam, type DayTab } from "@/lib/schemas/daily";

export type DailyTab = DayTab | "labor";

export const DAILY_TABS: { key: DailyTab; label: string }[] = [
  { key: "reports", label: "日報" },
  { key: "entries", label: "稼働報告" },
  { key: "labor", label: "労務" },
];

/** URL の ?tab= からタブを取り出す（不正・未指定なら "reports"） */
export function dailyTabFromParam(param: string | string[] | undefined): DailyTab {
  const v = Array.isArray(param) ? param[0] : param;
  return v === "labor" ? "labor" : dayTabFromParam(param);
}
