/**
 * 週次サマリーの期間（純関数。React・DB・SDK に依存しない）。
 *
 * - 週は「月曜はじまり・日曜おわり」。判定はすべて日本時間で行う
 * - 日付は DB と同じ "YYYY-MM-DD" の文字列で扱う（Date は入口で 1 回だけ使う）
 * - 毎週月曜の朝に届くのは「先週（前の月曜〜前の日曜）」のサマリー
 */

/** 週の範囲 */
export interface WeekRange {
  /** 週のはじめ（月曜）"YYYY-MM-DD" */
  from: string;
  /** 週のおわり（日曜）"YYYY-MM-DD" */
  to: string;
  /** 「2026年9月8日〜9月14日」（年をまたぐときは両方に年を付ける） */
  label: string;
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** "YYYY-MM-DD" として読めるか */
export function isDateKey(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 日本時間の今日 "YYYY-MM-DD" */
export function jstDate(now: Date = new Date()): string {
  return isoOf(new Date(now.getTime() + 9 * 60 * 60 * 1000));
}

/** "YYYY-MM-DD" に日数を足す（マイナス可。月・年をまたいでも正しい） */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoOf(new Date(Date.UTC(y, m - 1, d + days)));
}

/** 曜日（0＝日曜 … 6＝土曜） */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** その日が属する週の月曜 */
export function mondayOf(date: string): string {
  // 日曜(0) は 6 日戻す、月曜(1) は 0 日、火曜(2) は 1 日 …
  return shiftDate(date, -((dayOfWeek(date) + 6) % 7));
}

/** 入力（Date でも "YYYY-MM-DD" でも可）を日本時間の日付文字列にする */
function toDateKey(today: Date | string): string {
  if (typeof today === "string") {
    if (isDateKey(today)) return today;
    const parsed = new Date(today);
    if (Number.isNaN(parsed.getTime())) throw new Error(`不正な日付: ${today}`);
    return jstDate(parsed);
  }
  return jstDate(today);
}

/** 「2026年9月8日〜9月14日」（年をまたぐときは「2025年12月29日〜2026年1月4日」） */
export function formatRangeJa(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const head = `${fy}年${fm}月${fd}日`;
  const tail = fy === ty ? `${tm}月${td}日` : `${ty}年${tm}月${td}日`;
  return `${head}〜${tail}`;
}

/** 月曜の日付から週の範囲を作る（月曜以外を渡してもその週の月曜に丸める） */
export function weekRangeFrom(monday: string): WeekRange {
  const from = mondayOf(monday);
  const to = shiftDate(from, 6);
  return { from, to, label: formatRangeJa(from, to) };
}

/**
 * 先週（前の月曜〜前の日曜）の範囲。
 * 月曜の朝に呼べば「昨日までの 1 週間」、週の途中で呼んでも同じ先週を返す。
 */
export function weekRange(today: Date | string = new Date()): WeekRange {
  return weekRangeFrom(shiftDate(mondayOf(toDateKey(today)), -7));
}

/** 今週（今日が属する月曜〜日曜）の範囲 */
export function currentWeekRange(today: Date | string = new Date()): WeekRange {
  return weekRangeFrom(mondayOf(toDateKey(today)));
}

/** 1 週間前の範囲（前週比に使う） */
export function previousWeekRange(range: WeekRange): WeekRange {
  return weekRangeFrom(shiftDate(range.from, -7));
}

/** その週が属する稼動月 "YYYY-MM"（月曜の月。ai_insights.month はこの月の月初日） */
export function weekMonth(range: WeekRange): string {
  return range.from.slice(0, 7);
}

/** 週にまたがる稼動月（1 つか 2 つ。古い順） */
export function weekMonths(range: WeekRange): string[] {
  const first = range.from.slice(0, 7);
  const last = range.to.slice(0, 7);
  return first === last ? [first] : [first, last];
}

/** 日付が範囲（両端を含む）に入っているか */
export function inWeek(range: WeekRange, date: string | null | undefined): boolean {
  if (!isDateKey(date)) return false;
  return date >= range.from && date <= range.to;
}

/** 週次サマリーの画面へのリンク（?m は稼動月、?w は週のはじめの月曜） */
export function weekLinkPath(range: WeekRange): string {
  return `/ai?tab=weekly&m=${weekMonth(range)}&w=${range.from}`;
}

/** URL の ?w=YYYY-MM-DD から週を取り出す（不正なら先週） */
export function weekFromParam(param: string | string[] | undefined, today: Date | string = new Date()): WeekRange {
  const v = Array.isArray(param) ? param[0] : param;
  return isDateKey(v) ? weekRangeFrom(v) : weekRange(today);
}
