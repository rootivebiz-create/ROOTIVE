/**
 * 取引条件のドライバー用リンク（純関数）。署名は signLink("terms", 記録の id, link_nonce, 期限)。
 * 明細のリンクとは用途が違うので、同じ id でも署名が通らない。
 */
import { signLink } from "~/server/tokens";

/** リンクの期限：今日（日本時間）から 180 日後の日の終わり。同じ日に何度作っても同じリンクになる */
export const TERMS_LINK_DAYS = 180;
const DAY_SEC = 86_400;
const JST_SEC = 9 * 3600;

export function termsLinkExpiresAt(now: Date): number {
  const jstDay = Math.floor((Math.floor(now.getTime() / 1000) + JST_SEC) / DAY_SEC);
  return (jstDay + TERMS_LINK_DAYS + 1) * DAY_SEC - JST_SEC - 1;
}

/** 会社の画面でだけ作るリンクの値（見るだけの人には出さない） */
export function termsLinkToken(rec: { id: string; linkNonce: string }, now = new Date()): { token: string; expiresAt: number } {
  const expiresAt = termsLinkExpiresAt(now);
  return { token: signLink("terms", rec.id, rec.linkNonce, expiresAt), expiresAt };
}

/** LINE・SMS・メールに入れる文 */
export function termsShareMessage(name: string, companyName: string, url: string): string {
  return `${name}さん　${companyName}です。お仕事の取引条件（仕事の内容・報酬・支払日・差し引くもの など）をお送りします。内容をご覧になり、ページの下の「受け取りました」を押してください。分からないところは会社にお尋ねください。${url}`;
}

export function termsShareSubject(companyName: string): string {
  return `取引条件の明示書（${companyName}）`;
}

/** 今日（日本時間）の YYYY-MM-DD */
export function todayJst(now: Date = new Date()): string {
  const t = new Date(now.getTime() + JST_SEC * 1000);
  return t.toISOString().slice(0, 10);
}

/** 2026年10月25日 9:05（日本時間） */
export function jpDateTimeJst(date: Date): string {
  const t = new Date(date.getTime() + JST_SEC * 1000);
  return `${t.getUTCFullYear()}年${t.getUTCMonth() + 1}月${t.getUTCDate()}日 ${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}
