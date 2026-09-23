import "server-only";
import { ActionError } from "@/lib/actions/result";

/**
 * メールの送信（サーバー専用。0028）。送信サービスは Resend（https://resend.com）。
 *
 * - `RESEND_API_KEY` と `MAIL_FROM`（例：`株式会社ROOTIVE <billing@example.jp>`）の両方があるときだけ使える。
 *   どちらかが無ければ画面にもメールの操作を出さない（isMailEnabled）
 * - キーはサーバーだけで読む（クライアントへ渡すのは「使えるかどうか」の真偽だけ）
 * - E2E では `RESEND_API_BASE` でテストサーバーのモックへ向ける（本番では設定しない）
 */

const TIMEOUT_MS = 20_000;

export function isMailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

function apiBase(): string {
  return (process.env.RESEND_API_BASE || "https://api.resend.com").replace(/\/+$/, "");
}

export interface MailAttachment {
  filename: string;
  content: Uint8Array;
}

export interface SendMailInput {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

/** 送信サービスのエラーを日本語にする */
export function mailErrorMessage(status: number, body: string): string {
  let message = body;
  try {
    const json = JSON.parse(body) as { message?: string };
    if (json?.message) message = json.message;
  } catch {
    // JSON でなければそのまま
  }
  if (status === 401 || status === 403) return "メールの送信サービスの鍵（RESEND_API_KEY）が正しくありません。";
  if (status === 422) return `宛先か差出人の形が正しくありません（${message}）。取引先のメールアドレスと MAIL_FROM を確かめてください。`;
  if (status === 429) return "送信が多すぎるため、しばらく待ってから送ってください。";
  return `メールを送れませんでした（${status}${message ? `: ${message}` : ""}）。`;
}

export async function sendMail(input: SendMailInput): Promise<{ id: string }> {
  if (!isMailEnabled()) throw new ActionError("メールの送信が設定されていません（RESEND_API_KEY と MAIL_FROM）。");
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        attachments: (input.attachments ?? []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new ActionError("メールの送信サービスから応答がありませんでした（時間切れ）。");
    throw new ActionError("メールの送信サービスに接続できませんでした。");
  }
  const raw = await res.text();
  if (!res.ok) throw new ActionError(mailErrorMessage(res.status, raw));
  try {
    const json = JSON.parse(raw) as { id?: string };
    return { id: String(json.id ?? "") };
  } catch {
    return { id: "" };
  }
}
