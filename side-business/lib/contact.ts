/**
 * 相談フォーム（/contact）の入力の形・確かめ方・通知の文面。サーバー（app/api/contact）と画面（components/contact-form）で共用する。
 * ここには純関数だけを置く（環境変数は引数で受け取り、送信はしない）。
 */
import { z } from "zod";
import { SITE } from "@/site.config";

export const DRIVER_OPTIONS = ["〜5人", "6〜15人", "16〜30人", "31〜50人", "51人〜"] as const;
export const TOPIC_OPTIONS = ["支払明細", "利益の見える化", "振込データ", "点呼・業務記録", "請求書", "その他"] as const;

export type DriverOption = (typeof DRIVER_OPTIONS)[number];
export type TopicOption = (typeof TOPIC_OPTIONS)[number];

export const LIMITS = {
  company: 100,
  name: 50,
  email: 254,
  phone: 20,
  message: 2000,
} as const;

/** 画面とサーバーで同じ言葉を出すための文言 */
export const CONTACT_TEXT = {
  success: "受け付けました。2営業日以内にメールでご連絡します。",
  invalid: "入力を確かめてください。赤い字のところを直すと送れます。",
  badRequest: "送信の形が正しくありません。ページを読み込み直して、もう一度お試しください。",
  tooLarge: "内容が長すぎます。ご相談の内容を短くして、もう一度お試しください。",
  rateLimited: "続けて送信されたため、受け付けを少し止めています。10分ほどおいてから、もう一度お試しください。",
  failed: "送信できませんでした。時間をおいて、もう一度お試しください。",
  network: "送信できませんでした。電波の良いところで、もう一度お試しください。",
} as const;

/** 送り先がまだ設定されていないとき（503）の文言 */
export function notReadyMessage(hasEmail: boolean): string {
  return hasEmail
    ? "ただいまフォームの準備中です。お手数ですが、メールでご連絡ください。"
    : "ただいまフォームの準備中です。時間をおいて、もう一度お試しください。";
}

// ---------------------------------------------------------------------------
// 入力の形
// ---------------------------------------------------------------------------

/** 1 行の欄：改行・タブを空白にして前後の空白を取る */
const oneLine = (v: string) => v.replace(/[\r\n\t\f\v\u2028\u2029]+/g, " ").trim();

/** 全角の数字・ハイフンを半角にして、空白を取る */
export function normalizePhone(v: string): string {
  return v
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―−－ー]/g, "-")
    .replace(/\s+/g, "");
}

const digitCount = (v: string) => v.replace(/\D/g, "").length;

export const inquirySchema = z.object({
  company: z
    .string({ error: "会社名を入れてください" })
    .overwrite(oneLine)
    .min(1, { error: "会社名を入れてください" })
    .max(LIMITS.company, { error: `会社名は${LIMITS.company}文字までにしてください` }),
  name: z
    .string({ error: "お名前を入れてください" })
    .overwrite(oneLine)
    .min(1, { error: "お名前を入れてください" })
    .max(LIMITS.name, { error: `お名前は${LIMITS.name}文字までにしてください` }),
  email: z
    .string({ error: "メールアドレスを入れてください" })
    .overwrite(oneLine)
    .min(1, { error: "メールアドレスを入れてください" })
    .max(LIMITS.email, { error: "メールアドレスが長すぎます" })
    .pipe(z.email({ error: "メールアドレスの形が正しくありません（例：taro@example.com）" })),
  phone: z
    .string({ error: "電話番号は数字とハイフンで入れてください" })
    .overwrite(normalizePhone)
    .max(LIMITS.phone, { error: "電話番号が長すぎます" })
    .regex(/^[0-9-]*$/, { error: "電話番号は数字とハイフンで入れてください（例：03-1234-5678）" })
    .refine((v) => v === "" || (digitCount(v) >= 10 && digitCount(v) <= 11), {
      error: "電話番号の桁が合いません（例：03-1234-5678、090-1234-5678）",
    })
    .default(""),
  drivers: z.enum(DRIVER_OPTIONS, { error: "ドライバーの人数を選んでください" }),
  topics: z
    .array(z.enum(TOPIC_OPTIONS, { error: "相談したいことは一覧から選んでください" }), {
      error: "相談したいことは一覧から選んでください",
    })
    .max(TOPIC_OPTIONS.length, { error: "相談したいことは一覧から選んでください" })
    // 重なりを消して、一覧の順にそろえる
    .overwrite((list) => TOPIC_OPTIONS.filter((t) => list.includes(t)))
    .default([]),
  message: z
    .string({ error: "ご相談の内容は文字で入れてください" })
    .overwrite((v) => v.replace(/\r\n?/g, "\n").trim())
    .max(LIMITS.message, { error: `ご相談の内容は${LIMITS.message}文字までにしてください` })
    .default(""),
  agree: z.literal(true, { error: "プライバシーポリシーへの同意が必要です" }),
  /** おとりの欄（人には見えない）。入っていたら機械の送信とみなす */
  website: z.string().max(0, { error: "この欄は空のままにしてください" }).optional(),
});

export type Inquiry = z.output<typeof inquirySchema>;
export type InquiryField = keyof Inquiry;
export type FieldErrors = Partial<Record<InquiryField, string>>;

export type ValidateResult = { ok: true; data: Inquiry } | { ok: false; errors: FieldErrors };

/** 入力を確かめる。欄ごとに最初の誤りだけを日本語で返す */
export function validateInquiry(input: unknown): ValidateResult {
  const parsed = inquirySchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || !(key in inquirySchema.shape)) continue;
    const field = key as InquiryField;
    if (!errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

/** おとりの欄に何か入っているか（入っていれば、送ったふりだけして何もしない） */
export function isHoneypotFilled(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const v = (input as Record<string, unknown>).website;
  if (v === undefined || v === null) return false;
  return String(v).trim() !== "";
}

// ---------------------------------------------------------------------------
// 通知の文面
// ---------------------------------------------------------------------------

const WEEKDAYS = "日月火水木金土";
const pad2 = (n: number) => String(n).padStart(2, "0");

/** 日本時間の「2026年9月23日（水）14:05」 */
export function formatJst(date: Date): string {
  const t = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}年${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${WEEKDAYS[t.getUTCDay()]}）${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 通知メールの件名 */
export function inquirySubject(inquiry: Inquiry): string {
  return `【相談の申し込み】${inquiry.company}（${inquiry.name} 様）`;
}

/** 通知の本文（メール・チャット共通の書式なしの文章） */
export function formatInquiry(inquiry: Inquiry, receivedAt: Date): string {
  return [
    `${SITE.name}の相談フォームから申し込みがありました。`,
    "",
    `受付日時：${formatJst(receivedAt)}（日本時間）`,
    `会社名：${inquiry.company}`,
    `お名前：${inquiry.name}`,
    `メール：${inquiry.email}`,
    `電話：${inquiry.phone || "（なし）"}`,
    `ドライバーの人数：${inquiry.drivers}`,
    `相談したいこと：${inquiry.topics.length > 0 ? inquiry.topics.join("、") : "（選択なし）"}`,
    "",
    "■ ご相談の内容",
    inquiry.message || "（なし）",
  ].join("\n");
}

/** 文字（絵文字を割らない）で数えて切り詰める */
export function truncateChars(text: string, max: number, suffix = "…"): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const keep = Math.max(0, max - Array.from(suffix).length);
  return chars.slice(0, keep).join("") + suffix;
}

/** Discord の content の上限（文字） */
export const DISCORD_CONTENT_MAX = 2000;

/** Slack の text で特別な意味を持つ &, <, > を無害にする（<!channel> などで全員に通知させない） */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Webhook（Discord・Slack どちらでも届く形）に送る JSON。
 * Discord は content（2000 文字まで）、Slack は text を読む。@everyone などのメンションは効かないようにする。
 */
export function webhookPayload(text: string): {
  content: string;
  text: string;
  allowed_mentions: { parse: string[] };
} {
  return {
    content: truncateChars(text, DISCORD_CONTENT_MAX, "…（長いため途中までです）"),
    text: escapeSlack(text),
    allowed_mentions: { parse: [] },
  };
}

/** フォームが使えないときの「メールで送る」リンク（入力した内容を下書きに入れる。長い本文は切り詰める） */
export function mailtoHref(to: string, inquiry: Inquiry): string {
  const body = [
    `会社名：${inquiry.company}`,
    `お名前：${inquiry.name}`,
    `電話：${inquiry.phone || "（なし）"}`,
    `ドライバーの人数：${inquiry.drivers}`,
    `相談したいこと：${inquiry.topics.length > 0 ? inquiry.topics.join("、") : "（選択なし）"}`,
    "",
    "ご相談の内容：",
    inquiry.message ? truncateChars(inquiry.message, 300) : "",
  ].join("\n");
  return `mailto:${to}?subject=${encodeURIComponent(inquirySubject(inquiry))}&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------
// 送り先の設定
// ---------------------------------------------------------------------------

export const DEFAULT_FROM_EMAIL = "onboarding@resend.dev";

export type DeliveryConfig = {
  resend: { apiKey: string; to: string[]; from: string } | null;
  webhookUrl: string | null;
};

type Env = Record<string, string | undefined>;

/**
 * 環境変数から送り先を読む。
 *   RESEND_API_KEY + CONTACT_TO_EMAIL（カンマ区切りで複数可）(+ CONTACT_FROM_EMAIL) → メール
 *   CONTACT_WEBHOOK_URL → Discord / Slack の Webhook
 */
export function readDeliveryConfig(env: Env): DeliveryConfig {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const to = (env.CONTACT_TO_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = env.CONTACT_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
  const resend = apiKey && to.length > 0 ? { apiKey, to, from } : null;

  let webhookUrl: string | null = null;
  const rawHook = env.CONTACT_WEBHOOK_URL?.trim();
  if (rawHook) {
    try {
      const u = new URL(rawHook);
      if (u.protocol === "https:" || u.protocol === "http:") webhookUrl = u.toString();
    } catch {
      webhookUrl = null;
    }
  }
  return { resend, webhookUrl };
}

export function hasDelivery(config: DeliveryConfig): boolean {
  return config.resend !== null || config.webhookUrl !== null;
}

// ---------------------------------------------------------------------------
// 送信の回数の制限（メモリの中だけ。サーバーが複数あれば別々に数える＝目安）
// ---------------------------------------------------------------------------

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 5000,
}: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}) {
  const hits = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, times] of hits) {
      if (times.every((t) => t <= now - windowMs)) hits.delete(key);
    }
    // それでも多すぎるときは古いものから捨てる
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  }

  return {
    /** 1 回ぶん数える。上限を超えていれば数えずに断る */
    take(key: string, now: number): RateLimitResult {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) prune(now);
      return { ok: true };
    },
    /** テスト用：覚えている相手の数 */
    size: () => hits.size,
  };
}

/** 送信元の IP（Vercel では x-forwarded-for の先頭が本人） */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}
