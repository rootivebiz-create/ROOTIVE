/**
 * 相談フォームの受け付け（POST JSON）。
 *   400 入力の誤り（欄ごとの日本語） / 413 大きすぎる / 415 JSON でない / 429 続けて送られた / 503 送り先が未設定 / 502 すべての送り先に届かなかった
 * Content-Type を application/json に限るので、ほかのサイトのページからブラウザで直接送らせることはできない（事前の確認で止まる）。
 * おとりの欄が埋まっていたら、送ったふり（200）だけして何もしない。
 * 送り先は環境変数（RESEND_API_KEY + CONTACT_TO_EMAIL、CONTACT_WEBHOOK_URL）。ログには誤りだけを書き、入力の中身は書かない。
 */
import { NextResponse } from "next/server";
import {
  CONTACT_TEXT,
  clientIp,
  createRateLimiter,
  formatInquiry,
  hasDelivery,
  inquirySubject,
  isHoneypotFilled,
  notReadyMessage,
  readDeliveryConfig,
  validateInquiry,
  webhookPayload,
  type DeliveryConfig,
  type Inquiry,
} from "@/lib/contact";
import { CONTACT } from "@/site.config";

/** 1 つの IP から 10 分に 5 回まで（サーバーのメモリの中だけで数える目安） */
const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
const MAX_BODY_CHARS = 32_000;
/** 本文のバイト数の上限（UTF-8 の日本語は 1 文字 3 バイト。Content-Length が無くても、読みながらここで止める） */
const MAX_BODY_BYTES = MAX_BODY_CHARS * 4;
const SEND_TIMEOUT_MS = 10_000;

function json(status: number, body: Record<string, unknown>, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** ログに出す誤り（名前と文言だけ。応答の本文は読まず、文言に鍵や Webhook の URL が混ざっていたら伏せる） */
function describeError(err: unknown, secrets: string[]): string {
  let text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const s of secrets) if (s) text = text.split(s).join("[redacted]");
  return text.slice(0, 300);
}

function isJsonContentType(value: string | null): boolean {
  return (value ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}

/** 本文を上限まで読む。超えたら "too-large"、読めない・UTF-8 でなければ null */
async function readBody(req: Request, maxBytes: number): Promise<string | "too-large" | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too-large";
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function ensureOk(res: Response, label: string) {
  // 本文は読まずに捨てる（接続を返すため）
  await res.body?.cancel().catch(() => undefined);
  if (!res.ok) throw new Error(`${label} responded with HTTP ${res.status}`);
}

async function sendEmail(config: NonNullable<DeliveryConfig["resend"]>, inquiry: Inquiry, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.from,
      to: config.to,
      subject: inquirySubject(inquiry),
      text,
      reply_to: inquiry.email,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });
  await ensureOk(res, "Resend");
}

async function sendWebhook(url: string, text: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload(text)),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });
  await ensureOk(res, "Webhook");
}

export async function POST(req: Request) {
  if (!isJsonContentType(req.headers.get("content-type"))) return json(415, { error: CONTACT_TEXT.badRequest });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: CONTACT_TEXT.tooLarge });

  const raw = await readBody(req, MAX_BODY_BYTES);
  if (raw === "too-large" || (raw !== null && raw.length > MAX_BODY_CHARS)) return json(413, { error: CONTACT_TEXT.tooLarge });
  if (raw === null) return json(400, { error: CONTACT_TEXT.badRequest });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: CONTACT_TEXT.badRequest });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json(400, { error: CONTACT_TEXT.badRequest });
  }

  // おとりの欄が埋まっている＝機械の送信。受け付けたふりだけする
  if (isHoneypotFilled(body)) return json(200, { ok: true });

  const checked = validateInquiry(body);
  if (!checked.ok) return json(400, { error: CONTACT_TEXT.invalid, fieldErrors: checked.errors });

  const config = readDeliveryConfig(process.env);
  if (!hasDelivery(config)) return json(503, { error: notReadyMessage(CONTACT.email !== null) });

  const limited = limiter.take(clientIp(req.headers), Date.now());
  if (!limited.ok) {
    return json(429, { error: CONTACT_TEXT.rateLimited }, { "Retry-After": String(limited.retryAfterSec) });
  }

  const inquiry = checked.data;
  const text = formatInquiry(inquiry, new Date());
  const deliveries: { label: string; run: Promise<void> }[] = [];
  if (config.resend) deliveries.push({ label: "email", run: sendEmail(config.resend, inquiry, text) });
  if (config.webhookUrl) deliveries.push({ label: "webhook", run: sendWebhook(config.webhookUrl, text) });

  const results = await Promise.allSettled(deliveries.map((d) => d.run));
  const secrets = [config.resend?.apiKey ?? "", config.webhookUrl ?? ""];
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[contact] ${deliveries[i].label} delivery failed: ${describeError(r.reason, secrets)}`);
  });
  if (results.some((r) => r.status === "fulfilled")) return json(200, { ok: true });
  return json(502, { error: CONTACT_TEXT.failed });
}
