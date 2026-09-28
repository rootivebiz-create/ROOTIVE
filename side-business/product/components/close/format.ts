/** 締め・振込の画面で使う日付の見せ方（純関数。サーバーでもブラウザでも使える） */
import { jpDate } from "@/lib/format";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-11-25 → 2026年11月25日(水) */
export function dateWithWeekday(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${jpDate(date)}(${WEEKDAYS[wd]})`;
}

const jst = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** 日時を日本時間で：2026/10/5 09:00 */
export function jstDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "" : jst.format(d);
}

/** 今日（日本時間）の YYYY-MM-DD */
export function todayJst(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

/** a から b まで何日あとか（b が後なら正） */
export function daysBetween(a: string, b: string): number {
  const toUtc = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
