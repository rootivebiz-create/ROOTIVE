/**
 * 日報・点呼の純関数（React・DB に依存しない。画面・CSV 出力・テストから使う）
 *
 * - 日付は "YYYY-MM-DD"、時刻は "HH:MM"、いずれも日本時間（JST）として扱う
 * - 変換は Intl・ローカルタイムゾーンに頼らず自前で計算する（サーバーとブラウザで結果を揃えるため）
 * - 入力は全角数字・全角コロンでも受け付ける（スマホの日本語入力）
 */
import type { DayEntryStatus } from "@/lib/db/types";

/** 日本時間の時差（ミリ秒） */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ドライバーが報告できる過去の日数（今日を含めて 15 日ぶん） */
export const EDIT_WINDOW_DAYS = 14;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** 全角数字・全角記号を半角へ（"０９：３０" → "09:30"） */
export function normalizeDigits(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[－ー−‐]/g, "-")
    .replace(/[／]/g, "/")
    .replace(/\s+/g, "")
    .trim();
}

/** "YYYY-MM-DD" として実在する日付か */
export function isWorkDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "HH:MM"（0:00〜23:59）として正しいか。全角も可 */
export function isWorkTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = TIME_RE.exec(normalizeDigits(value));
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] == null ? 0 : Number(m[3]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

/**
 * 日本時間の日付＋時刻を ISO（UTC）へ。不正なら null
 * 例：("2026-09-18", "09:30") → "2026-09-18T00:30:00.000Z"
 */
export function jstDateTimeToIso(dateStr: string, timeStr: string): string | null {
  const date = typeof dateStr === "string" ? normalizeDigits(dateStr) : "";
  if (!isWorkDate(date) || !isWorkTime(timeStr)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const t = TIME_RE.exec(normalizeDigits(timeStr));
  if (!t) return null;
  const ms = Date.UTC(y, m - 1, d, Number(t[1]), Number(t[2]), t[3] == null ? 0 : Number(t[3])) - JST_OFFSET_MS;
  return new Date(ms).toISOString();
}

/** `datetime-local` 相当の "YYYY-MM-DDTHH:MM"（日本時間）を ISO へ。不正なら null */
export function jstLocalToIso(local: string): string | null {
  if (typeof local !== "string") return null;
  const [date, time] = normalizeDigits(local).split("T");
  if (!date || !time) return null;
  return jstDateTimeToIso(date, time);
}

/** ISO の時刻を日本時間の "HH:MM" へ。空・不正は "" */
export function isoToJstTime(iso: string | null | undefined): string {
  const ms = isoToJstMs(iso);
  if (ms == null) return "";
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** ISO の時刻を日本時間の日付 "YYYY-MM-DD" へ。空・不正は "" */
export function isoToJstDate(iso: string | null | undefined): string {
  const ms = isoToJstMs(iso);
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** ISO の時刻を `datetime-local` 用の "YYYY-MM-DDTHH:MM"（日本時間）へ。空・不正は "" */
export function isoToJstLocal(iso: string | null | undefined): string {
  const date = isoToJstDate(iso);
  return date === "" ? "" : `${date}T${isoToJstTime(iso)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO → 日本時間に読み替えたミリ秒（不正なら null） */
function isoToJstMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ms + JST_OFFSET_MS;
}

/** 日本時間の今日 "YYYY-MM-DD" */
export function todayJST(now: Date = new Date()): string {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 日本時間の現在時刻 "HH:MM" */
export function nowJstTime(now: Date = new Date()): string {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 日付に n 日足す（月またぎ・うるう年も正しく計算する）。不正なら "" */
export function addDays(date: string, n: number): string {
  if (!isWorkDate(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * MS_PER_DAY);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** to − from の日数。不正なら NaN */
export function diffDays(from: string, to: string): number {
  if (!isWorkDate(from) || !isWorkDate(to)) return Number.NaN;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

/** 新しい順の日付の配列（today から count 日ぶん）。["2026-09-18", "2026-09-17", …] */
export function recentDates(today: string, count: number): string[] {
  if (!isWorkDate(today) || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => addDays(today, -i));
}

/** その日の稼動月 "YYYY-MM"。不正なら "" */
export function monthOfDate(date: string): string {
  return isWorkDate(date) ? date.slice(0, 7) : "";
}

/** 日付に含まれる稼動月（重複なし・昇順） */
export function monthsOfDates(dates: readonly string[]): string[] {
  return [...new Set(dates.map(monthOfDate).filter((m) => m !== ""))].sort();
}

/** 表示用の日付 "9/18(金)"。不正なら元の文字列 */
export function formatWorkDate(date: string): string {
  if (!isWorkDate(date)) return typeof date === "string" ? date : "";
  const [y, m, d] = date.split("-").map(Number);
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${w})`;
}

/** 曜日（"日"〜"土"）。不正なら "" */
export function weekdayJa(date: string): string {
  if (!isWorkDate(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// ---------------------------------------------------------------------------
// 点呼
// ---------------------------------------------------------------------------

/** 点呼の状況 */
export type RollCallState = "none" | "pre" | "done";

/** 点呼の済み具合（業務前も業務後も未実施＝none、業務前だけ＝pre、両方＝done） */
export function rollCallState(report: { pre_at?: string | null; post_at?: string | null } | null | undefined): RollCallState {
  if (!report) return "none";
  const pre = !!report.pre_at;
  const post = !!report.post_at;
  if (pre && post) return "done";
  if (pre || post) return "pre";
  return "none";
}

/** 点呼の状況の表示名 */
export const ROLL_CALL_STATE_LABELS: Record<RollCallState, string> = {
  none: "未実施",
  pre: "業務前のみ",
  done: "実施済み",
};

/**
 * アルコール検知の判定：0 なら true（検出なし）、0 より大きければ false（検出）
 * 未測定（null・空欄・数値でない）は null
 */
export function alcoholOk(value: number | string | null | undefined): boolean | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const s = normalizeDigits(value).replace(/[，,]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n <= 0 : null;
  }
  return Number.isFinite(value) ? value <= 0 : null;
}

// ---------------------------------------------------------------------------
// 日別の稼働
// ---------------------------------------------------------------------------

/** 集計に使う最小限の列（v_work_day_entry_list の 1 行でもよい） */
export interface DayEntryLike {
  id?: string | null;
  qty?: number | null;
  status?: DayEntryStatus | null;
  project_item_id?: string | null;
}

export interface DaySummary {
  /** 数量の合計（差戻しは含めない） */
  qtyTotal: number;
  /** 案件内容の件数（行数） */
  itemCount: number;
  submitted: number;
  approved: number;
  rejected: number;
}

/** その日の稼働報告のまとめ（数量合計・案件数・状態ごとの件数） */
export function summarizeDay(entries: readonly DayEntryLike[] | null | undefined): DaySummary {
  const out: DaySummary = { qtyTotal: 0, itemCount: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const e of entries ?? []) {
    out.itemCount += 1;
    const status = e.status ?? "submitted";
    if (status === "submitted") out.submitted += 1;
    else if (status === "approved") out.approved += 1;
    else out.rejected += 1;
    if (status !== "rejected") out.qtyTotal += Number(e.qty ?? 0) || 0;
  }
  return out;
}

/** 承認待ちの id（承認の一括操作に使う） */
export function pendingIds(entries: readonly DayEntryLike[] | null | undefined): string[] {
  const out: string[] = [];
  for (const e of entries ?? []) {
    if (e.status === "submitted" && typeof e.id === "string" && e.id !== "") out.push(e.id);
  }
  return out;
}

/** 承認済みの行は編集できない */
export function isEntryLocked(entry: DayEntryLike | null | undefined): boolean {
  return entry?.status === "approved";
}

/**
 * その日の報告を入力・変更できるか
 * - 未来の日付は不可
 * - 過去は EDIT_WINDOW_DAYS 日前まで
 * - 締め済みの月は不可（closedMonths は "YYYY-MM" の配列）
 */
export function canEditDate(date: string, today: string, closedMonths: readonly string[] = []): boolean {
  if (!isWorkDate(date) || !isWorkDate(today)) return false;
  const back = diffDays(date, today);
  if (!Number.isFinite(back) || back < 0 || back > EDIT_WINDOW_DAYS) return false;
  return !closedMonths.includes(monthOfDate(date));
}

/** 「今日の報告」の進み具合 */
export interface DayProgress {
  /** ① 出発前の点呼が済んでいる */
  pre: boolean;
  /** ② 稼働の報告を 1 件以上出している（差戻しは含めない） */
  work: boolean;
  /** ③ 終了後の点呼が済んでいる */
  post: boolean;
  /** 3 つとも済んでいる */
  done: boolean;
}

export function dayProgress(
  report: { pre_at?: string | null; post_at?: string | null } | null | undefined,
  entries: readonly DayEntryLike[] | null | undefined,
): DayProgress {
  const pre = !!report?.pre_at;
  const post = !!report?.post_at;
  const s = summarizeDay(entries);
  const work = s.submitted + s.approved > 0;
  return { pre, work, post, done: pre && post && work };
}
