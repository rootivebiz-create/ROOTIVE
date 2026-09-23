/**
 * 入力のゆれを直す小さな部品（純関数）。全角の数字・空白・ハイフン・ひらがなを吸収する。
 * ドライバーの名簿・会社の基本・案件の入力で共通に使う。
 */
import { toZenginKana } from "@/lib/payroll/zengin";

/** 全角 → 半角、前後の空白を外す */
export function nfkc(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim();
}

/** 空に見える値（「なし」「-」「未登録」など）か */
export function isBlankLike(value: string | null | undefined): boolean {
  const v = nfkc(value).replace(/\s/g, "");
  return v === "" || /^(なし|無し|無|未登録|未|-+|ー+|―+|×|n\/a|none)$/i.test(v);
}

/** 名前：全角半角をそろえ、空白を 1 つの半角空白にする */
export function cleanName(value: string | null | undefined): string {
  return nfkc(value).replace(/[\s　]+/g, " ");
}

/** フリガナ：ひらがなをカタカナにし、空白をそろえる */
export function cleanKana(value: string | null | undefined): string {
  return cleanName(value).replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

export type RegNoResult = { value: string | null; error: string | null };

/**
 * インボイスの登録番号の形を確かめる（T＋13 桁）。数字だけなら頭に T を付ける。
 * 形だけを見る（実在するかは、国税庁の公表サイトで確かめる）。
 */
export function normalizeRegistrationNo(raw: string | null | undefined): RegNoResult {
  if (isBlankLike(raw)) return { value: null, error: null };
  const v = nfkc(raw).toUpperCase().replace(/[\s\-‐－ー―]/g, "");
  if (/^\d{13}$/.test(v)) return { value: `T${v}`, error: null };
  if (/^T\d{13}$/.test(v)) return { value: v, error: null };
  const digits = v.replace(/^T/, "").replace(/\D/g, "").length;
  return {
    value: null,
    error: `登録番号「${nfkc(raw)}」の形が違います。T と 13 桁の数字です（例：T1234567890123）${digits ? `。いまは数字が ${digits} 桁です` : ""}`,
  };
}

export type DigitsResult = { value: string | null; error: string | null; padded: boolean };

/**
 * 銀行コード（4 桁）・支店コード（3 桁）：Excel が先頭の 0 を落とすことが多いので、足りなければ 0 を補う。
 */
export function normalizeCode(raw: string | null | undefined, length: number, label: string): DigitsResult {
  if (isBlankLike(raw)) return { value: null, error: null, padded: false };
  const v = nfkc(raw).replace(/[\s\-‐－]/g, "");
  if (!/^\d+$/.test(v)) return { value: null, error: `${label}は ${length} 桁の数字です（「${nfkc(raw)}」）`, padded: false };
  if (v.length > length) return { value: null, error: `${label}は ${length} 桁の数字です（「${v}」は ${v.length} 桁）`, padded: false };
  return { value: v.padStart(length, "0"), error: null, padded: v.length < length };
}

/** 口座番号：7 桁までの数字（ハイフン・空白は外す） */
export function normalizeAccountNumber(raw: string | null | undefined): DigitsResult {
  if (isBlankLike(raw)) return { value: null, error: null, padded: false };
  const v = nfkc(raw).replace(/[\s\-‐－]/g, "");
  if (!/^\d+$/.test(v)) return { value: null, error: `口座番号は数字で入れてください（「${nfkc(raw)}」）`, padded: false };
  if (v.length > 7) return { value: null, error: `口座番号は 7 桁までの数字です（「${v}」は ${v.length} 桁）`, padded: false };
  return { value: v, error: null, padded: false };
}

/** 預金の種類：普通・当座（空なら普通） */
export function normalizeAccountType(raw: string | null | undefined): { value: "ordinary" | "checking"; error: string | null } {
  const v = nfkc(raw).replace(/\s/g, "");
  if (!v || /^(普通|普|1|普通預金|総合|ordinary)$/i.test(v)) return { value: "ordinary", error: null };
  if (/^(当座|当|2|当座預金|checking)$/i.test(v)) return { value: "checking", error: null };
  return { value: "ordinary", error: `預金の種類「${v}」が読めません（普通・当座のどちらかです）` };
}

/** 振込データに使えるカナか（漢字などが混ざっていないか） */
export function kanaProblem(raw: string, label: string): string | null {
  const { value, invalid } = toZenginKana(raw);
  if (invalid.length) return `${label}はカナで入れてください（使えない文字：${[...new Set(invalid)].join("")}）`;
  if (!value) return `${label}が空です`;
  return null;
}

/** カナに直せるなら半角カナ、直せなければ null（銀行名・支店名。振込はコードで届く） */
export function kanaOrNull(raw: string | null | undefined): string | null {
  if (isBlankLike(raw)) return null;
  const { value, invalid } = toZenginKana(nfkc(raw));
  return value && invalid.length === 0 ? value : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): { value: string | null; error: string | null } {
  if (isBlankLike(raw)) return { value: null, error: null };
  const v = nfkc(raw).toLowerCase();
  return EMAIL.test(v) ? { value: v, error: null } : { value: null, error: `メールアドレス「${nfkc(raw)}」の形が違います` };
}

export function normalizePhone(raw: string | null | undefined): { value: string | null; error: string | null } {
  if (isBlankLike(raw)) return { value: null, error: null };
  const v = nfkc(raw).replace(/[\s()（）]/g, "").replace(/[‐－ー―]/g, "-");
  return /^\+?[\d-]{8,15}$/.test(v) ? { value: v, error: null } : { value: null, error: `電話番号「${nfkc(raw)}」の形が違います` };
}
