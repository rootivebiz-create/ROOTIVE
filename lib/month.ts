/** 稼動月ユーティリティ。稼動月は "YYYY-MM"、DB では月初日 "YYYY-MM-01" */

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(s: unknown): s is string {
  return typeof s === "string" && MONTH_RE.test(s);
}

export function monthToDate(month: string): string {
  if (!isMonthKey(month)) throw new Error(`不正な稼動月: ${month}`);
  return `${month}-01`;
}

export function dateToMonth(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function prevMonth(month: string): string {
  return addMonths(month, -1);
}

export function nextMonth(month: string): string {
  return addMonths(month, 1);
}

export function compareMonth(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 日本時間の現在の稼動月 */
export function currentMonthJST(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isFutureMonth(month: string, now: Date = new Date()): boolean {
  return compareMonth(month, currentMonthJST(now)) > 0;
}

export function isPastMonth(month: string, now: Date = new Date()): boolean {
  return compareMonth(month, currentMonthJST(now)) < 0;
}

export function formatMonthJa(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * 振込予定日：稼動月 + offset か月の payoutDay 日（0 = 末日）
 * 例: 2026-09, offset 1, day 0 → 2026-10-31
 */
export function payoutDate(month: string, offsetMonths: number, payoutDay: number): string {
  const target = addMonths(month, offsetMonths);
  const dim = daysInMonth(target);
  const day = payoutDay <= 0 || payoutDay > dim ? dim : payoutDay;
  return `${target}-${String(day).padStart(2, "0")}`;
}

export function formatDateJa(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** URL の ?m= から稼動月を取り出す（不正なら当月） */
export function monthFromParam(param: string | string[] | undefined, now: Date = new Date()): string {
  const v = Array.isArray(param) ? param[0] : param;
  return isMonthKey(v) ? v : currentMonthJST(now);
}

/** from〜to の月の配列（両端含む） */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let m = from;
  while (compareMonth(m, to) <= 0) {
    out.push(m);
    m = nextMonth(m);
  }
  return out;
}
