/**
 * 表示の書式（純関数）。円・日付・月の見せ方はここだけで決める（画面ごとに同じ関数を書かない）。
 * 金額の表の「¥1,234」は lib/payroll/money の yen、明細の「1,234円（マイナスは −）」は lib/engine/types の en を使う。
 */
import { num } from "@/lib/engine/types";

/* ───────────── 円 ───────────── */

const intFormat = new Intl.NumberFormat("ja-JP");

/** 1100000 → "1,100,000"（入力欄に戻すときの書式。小数は円に丸める） */
export function groupDigits(value: number): string {
  return intFormat.format(Math.round(value));
}

/** 250000 → 250,000円 */
export function yenText(value: number): string {
  return `${groupDigits(value)}円`;
}

/** 250000 → 25万円、18000 → 1.8万円（千円単位で割り切れないときは 12,345円 のまま） */
export function compactYen(value: number): string {
  if (value >= 10_000 && value % 1_000 === 0) return `${value / 10_000}万円`;
  return yenText(value);
}

/** 250000, 480000 → 25万〜48万円 */
export function rangeYen(min: number, max: number): string {
  if (min === max) return compactYen(min);
  return `${compactYen(min).replace(/円$/, "")}〜${compactYen(max)}`;
}

/** 50000 → 5万円、1500 → 0.15万円（万円の単位で小数 4 桁まで） */
export function manYen(value: number): string {
  return `${num(value / 10_000)}万円`;
}

/** インボイスの登録番号。数字だけで入っていたら頭に T を付ける（T1234567890123） */
export function regNoText(value: string): string {
  const v = value.replace(/\s+/g, "");
  return /^\d{13}$/.test(v) ? `T${v}` : v;
}

/* ───────────── 日付 ───────────── */

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const MONTH_RE = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/;

/** 2026-10-01 → 2026年10月1日（形が違えばそのまま返す） */
export function jpDate(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 2026-10 または 2026-10-01 → 2026年10月（形が違えばそのまま返す） */
export function jpMonth(date: string): string {
  const m = MONTH_RE.exec(date);
  if (!m) return date;
  return `${Number(m[1])}年${Number(m[2])}月`;
}

/** 2026-10-31 → 2026年10月分 */
export function monthLabel(date: string): string {
  const month = jpMonth(date);
  return month === date ? date : `${month}分`;
}

/** いまの日付（日本時間）を「2026年9月23日」にする */
export function jpToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(now);
}
