/**
 * 相談フォーム（/contact）の入力の形・確かめ方・通知の文面。サーバー（app/api/contact）と画面（components/contact-form）で共用する。
 * ここには純関数だけを置く（環境変数は引数で受け取り、送信はしない）。
 */
import { z } from "zod";
import { SITE } from "@/site.config";

export const DRIVER_OPTIONS = ["〜5人", "6〜15人", "16〜30人", "31〜50人", "51人〜"] as const;
export const TOPIC_OPTIONS = ["支払明細", "利益の見える化", "振込データ", "点呼・業務記録", "請求書", "その他"] as const;

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

// ---------------------------------------------------------------------------
// 流入元（どこから来たか。FAX・メール・紹介などの効果を数えるため）
// ---------------------------------------------------------------------------

/** 流入元の 1 項目の長さの上限 */
export const SOURCE_MAX = 100;

/** 1 行にして、制御文字を消す */
const sourceText = (v: string) => oneLine(v).replace(/[\u0000-\u001f\u007f]/g, "");

const sourceField = z
  .string()
  .overwrite(sourceText)
  .max(SOURCE_MAX)
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * 流入元。画面から見えない情報なので、形がおかしくても申し込み自体は止めない（丸ごと捨てる）。
 *   utm_source / utm_medium / utm_campaign：最初に開いた URL の値
 *   referrer：前にいたサイトのホスト名だけ（パスや検索語は持たない）
 *   landing：最初に開いたページのパス（FAX の A/B は QR の行き先のページで分かれる）
 */
export const leadSourceSchema = z
  .object({
    utm_source: sourceField,
    utm_medium: sourceField,
    utm_campaign: sourceField,
    referrer: sourceField,
    landing: sourceField,
  })
  .transform((s) => {
    const entries = Object.entries(s).filter(([, v]) => v !== undefined);
    return entries.length > 0 ? (Object.fromEntries(entries) as Partial<Record<keyof typeof s, string>>) : undefined;
  });

export type LeadSource = NonNullable<z.output<typeof leadSourceSchema>>;

/** 端末に覚えておくときのキー（sessionStorage。タブを閉じると消える） */
export const SOURCE_STORAGE_KEY = "shimebi-lab:source";

/** 最初に開いたページの URL と前のページから、流入元を作る（自分のサイトの中の移動は参照元にしない） */
export function sourceFromLocation(loc: {
  search: string;
  pathname: string;
  host: string;
  referrer: string;
}): LeadSource | undefined {
  const params = new URLSearchParams(loc.search);
  let referrer: string | undefined;
  if (loc.referrer) {
    try {
      const host = new URL(loc.referrer).host.toLowerCase();
      if (host && host !== loc.host.toLowerCase()) referrer = host;
    } catch {
      referrer = undefined;
    }
  }
  const cut = (v: string | null | undefined) => (v ? sourceText(v).slice(0, SOURCE_MAX) : undefined);
  const parsed = leadSourceSchema.safeParse({
    utm_source: cut(params.get("utm_source")),
    utm_medium: cut(params.get("utm_medium")),
    utm_campaign: cut(params.get("utm_campaign")),
    referrer: cut(referrer),
    landing: cut(loc.pathname),
  });
  return parsed.success ? parsed.data : undefined;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** 覚えている流入元を読む（読めない・形が違うときは undefined） */
export function readStoredSource(storage: StorageLike | null | undefined): LeadSource | undefined {
  try {
    const raw = storage?.getItem(SOURCE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = leadSourceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 最初に開いたときだけ流入元を覚える（あとのページで上書きしない）。
 * 流入元が何も無い（直接来た）ときも、最初のページだけは覚えて、そのあとの移動で上書きされないようにする。
 */
export function captureSource(
  storage: StorageLike | null | undefined,
  loc: Parameters<typeof sourceFromLocation>[0],
): LeadSource | undefined {
  try {
    if (!storage) return sourceFromLocation(loc);
    const stored = storage.getItem(SOURCE_STORAGE_KEY);
    if (stored) return readStoredSource(storage);
    const source = sourceFromLocation(loc);
    storage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(source ?? {}));
    return source;
  } catch {
    return undefined;
  }
}

/** 通知に載せる 1 行（例：utm_source=fax, landing=/tools/invoice-cost） */
export function formatSource(source: LeadSource | undefined): string {
  if (!source) return "（記録なし：直接の入力・ブックマークなど）";
  const labels: [keyof LeadSource, string][] = [
    ["utm_source", "utm_source"],
    ["utm_medium", "utm_medium"],
    ["utm_campaign", "utm_campaign"],
    ["referrer", "参照元"],
    ["landing", "最初のページ"],
  ];
  const parts = labels.filter(([k]) => source[k]).map(([k, label]) => `${label}=${source[k]}`);
  return parts.length > 0 ? parts.join(", ") : "（記録なし：直接の入力・ブックマークなど）";
}

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
  drivers: z.enum(DRIVER_OPTIONS, { error: "業務委託の方の人数を選んでください" }),
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
  /** おとりの欄（人には見えない）。入っていたら機械の送信とみなす（空白だけ・null は isHoneypotFilled と同じく空とみなす） */
  website: z
    .string()
    .overwrite((v) => v.trim())
    .max(0, { error: "この欄は空のままにしてください" })
    .nullish(),
  /** 流入元（任意）。形がおかしければ捨てる（申し込みは止めない） */
  source: leadSourceSchema.optional().catch(undefined),
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
    `業務委託の方の人数：${inquiry.drivers}`,
    `相談したいこと：${inquiry.topics.length > 0 ? inquiry.topics.join("、") : "（選択なし）"}`,
    // 長い本文で Webhook の上限に切られても残るよう、本文より前に置く
    `流入元：${formatSource(inquiry.source)}`,
    "",
    "■ ご相談の内容",
    inquiry.message || "（なし）",
  ].join("\n");
}

/**
 * 長さ（JavaScript の length＝入力欄の maxLength・zod の max と同じ数え方）が max 以下になるように切り詰める。
 * 絵文字（2 つ分で 1 文字のもの）は途中で割らない。この数え方なら「文字の数」で数える相手の上限にも必ず収まる。
 */
export function truncateChars(text: string, max: number, suffix = "…"): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - suffix.length);
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > room) break;
    out += ch;
  }
  return out + suffix;
}

/** Discord の content の上限（文字。数え方が違っても超えないよう、length で数えて切る） */
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
    `業務委託の方の人数：${inquiry.drivers}`,
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
