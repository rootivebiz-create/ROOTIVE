/**
 * 財務画面（/finance）の日付・年のユーティリティ（純関数）
 *
 * - 日付は日本時間の "YYYY-MM-DD"、稼動月は "YYYY-MM"（lib/month.ts と同じ書き方）
 * - 予算タブ・税務タブは稼動月（?m）ではなく年（?y）で切り替える
 */
import { isDateString } from "@/lib/schemas/expenses";

/** 扱える年の範囲（税務の期限・借入の返済予定がこの範囲に収まる） */
export const FINANCE_MIN_YEAR = 2000;
export const FINANCE_MAX_YEAR = 2100;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 日本時間の今日 "YYYY-MM-DD" */
export function todayJST(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

/** "2026-04-30" → 2026 */
export function yearOfDate(date: string | null | undefined): number {
  const y = Number(String(date ?? "").slice(0, 4));
  return Number.isFinite(y) ? y : 0;
}

/** "2026-04-30" → "2026-04" */
export function monthOfDate(date: string | null | undefined): string {
  return String(date ?? "").slice(0, 7);
}

/** 扱える年か（2000〜2100 の整数） */
export function isFinanceYear(y: unknown): y is number {
  return typeof y === "number" && Number.isInteger(y) && y >= FINANCE_MIN_YEAR && y <= FINANCE_MAX_YEAR;
}

/** URL の ?y= を西暦 4 桁として読む（不正なら null） */
export function parseYearParam(param: string | string[] | undefined): number | null {
  const v = Array.isArray(param) ? param[0] : param;
  if (typeof v !== "string" || !/^\d{4}$/.test(v)) return null;
  const y = Number(v);
  return isFinanceYear(y) ? y : null;
}

/** 表示する年：?y= → 今日の年 の順 */
export function resolveFinanceYear(param: string | string[] | undefined, today: string): number {
  return parseYearParam(param) ?? yearOfDate(today);
}

/** その年の 12 か月 "YYYY-MM"（1 月から） */
export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
}

/** その年の 1 月 1 日 */
export function yearStartDate(year: number): string {
  return `${year}-01-01`;
}

/** その年の 12 月 31 日 */
export function yearEndDate(year: number): string {
  return `${year}-12-31`;
}

/** 年セレクタの選択肢（今年の前後 ＋ データのある年、降順） */
export function yearOptions(currentYear: number, extra: number[] = [], back = 3, forward = 2): number[] {
  const years = new Set<number>();
  for (let y = currentYear - back; y <= currentYear + forward; y += 1) {
    if (isFinanceYear(y)) years.add(y);
  }
  for (const y of extra) {
    if (isFinanceYear(y)) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/** from から to までの日数（同じ日なら 0、to が前なら負）。不正な日付は 0 */
export function daysBetweenDates(from: string, to: string): number {
  if (!isDateString(from) || !isDateString(to)) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** "2026-11-30" → "11月30日" */
export function formatMonthDayJa(date: string | null | undefined): string {
  const [, m, d] = String(date ?? "").split("-");
  if (!m || !d) return "—";
  return `${Number(m)}月${Number(d)}日`;
}

/** 決算月（1〜12）の表示 */
export function fiscalMonthLabel(fiscalMonth: number | null | undefined): string {
  const m = Number(fiscalMonth);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? `${m}月決算` : "決算月が未設定";
}

/** その年に到来する決算日（決算月の末日） */
export function fiscalYearEnd(year: number, fiscalMonth: number | null | undefined): string {
  const m = Number.isInteger(Number(fiscalMonth)) && Number(fiscalMonth) >= 1 && Number(fiscalMonth) <= 12 ? Number(fiscalMonth) : 3;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${pad2(m)}-${pad2(last)}`;
}
