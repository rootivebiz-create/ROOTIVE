/** デモの入力の読み方と表示の小さな書式（純関数）。金額は lib/payroll/money の yen / pct、日付と月は lib/format の jpDate / jpMonth を使う */
import { parseAmount } from "@/lib/payroll/money";
import { monthEnd } from "@/lib/payroll/tax";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM か */
export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

/** 実在する日付の YYYY-MM-DD か */
export function isDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * 月の入力（「2026-10」「2026/10」「2026年10月」「202610」、全角も可）→ YYYY-MM。読めなければ null。
 * 月の欄（type=month）が使えないブラウザ（Firefox・Mac の Safari）では文字の欄になるため、ゆるく読む。
 */
export function normalizeMonth(text: string): string | null {
  const s = text.normalize("NFKC").replace(/\s+/g, "");
  const m = /^(\d{4})(?:[-/.年](\d{1,2})月?|(\d{2}))$/.exec(s);
  if (!m) return null;
  const month = `${m[1]}-${(m[2] ?? m[3]).padStart(2, "0")}`;
  return isMonth(month) ? month : null;
}

/**
 * 数値の欄で打っている途中の文字を読む。空欄は emptyAs、最後の「.」は打ちかけとして無視する（「10.」→ 10）。
 * 読めなければ null。
 */
export function readNumberDraft(text: string, parse: (text: string) => number | null, emptyAs = 0): number | null {
  const t = text.trim().replace(/[.．]$/, "");
  return t === "" ? emptyAs : parse(t);
}

/** 2026-10 → 2026年10月1日〜10月31日 */
export function periodText(month: string): string {
  const m = MONTH_RE.exec(month);
  if (!m) return month;
  const last = Number(monthEnd(month).slice(8));
  return `${Number(m[1])}年${Number(m[2])}月1日〜${Number(m[2])}月${last}日`;
}

const qtyFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });

/** 数量（カンマ区切り・小数 2 桁まで） */
export function qtyText(qty: number): string {
  return qtyFormat.format(qty);
}

/** 単価（小数のある単価もそのまま出す）。¥152.5 */
export function unitPrice(rate: number): string {
  return `${rate < 0 ? "-" : ""}¥${qtyFormat.format(Math.abs(rate))}`;
}

/** 振込データの振込日（MMDD）。日付でなければ null */
export function toMMDD(date: string): string | null {
  return isDate(date) ? date.slice(5, 7) + date.slice(8, 10) : null;
}

/** 振込データのファイル名（furikomi_YYYYMM.txt） */
export function zenginFileName(month: string): string {
  return `furikomi_${month.replace(/\D/g, "")}.txt`;
}

/** 率（0.105）→ 入力欄の % の文字（10.5） */
export function rateToPercentText(rate: number): string {
  return String(Math.round(rate * 1e6) / 1e4);
}

/** 入力欄の %（「10.5」「１０％」）→ 率（0.105）。0〜100 の数でなければ null */
export function percentTextToRate(text: string): number | null {
  const v = parseAmount(text.replace(/[%％]/g, ""));
  if (v === null || v < 0 || v > 100) return null;
  return Math.round(v * 1e4) / 1e6;
}

/** 0 以上の数（数量・単価）。数でなければ null */
export function parseNonNegative(text: string): number | null {
  const v = parseAmount(text);
  return v === null || v < 0 ? null : v;
}

/** 0 以上の整数の円（管理費・調整の金額）。整数でなければ null */
export function parseYen(text: string): number | null {
  const v = parseAmount(text);
  return v === null || v < 0 || !Number.isInteger(v) ? null : v;
}

/** 登録番号（T＋13 桁）の形か */
export function isRegistrationNo(value: string): boolean {
  return /^T\d{13}$/.test(value.normalize("NFKC").trim().toUpperCase());
}
