import { z } from "zod";

/**
 * 通知の設定とプッシュ購読（サーバー・クライアント共用）
 */

export const notifyChatModeSchema = z.enum(["all", "mention", "off"]);

export const notifyPrefsSchema = z.object({
  notify_chat: notifyChatModeSchema,
  notify_line: z.boolean(),
});

/** ブラウザの PushSubscription から取り出した値 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url("送信先が正しくありません").max(2000, "送信先が長すぎます"),
  p256dh: z.string().min(1, "鍵がありません").max(500),
  auth: z.string().min(1, "鍵がありません").max(500),
  user_agent: z.string().max(300).default(""),
  label: z.string().max(60).default(""),
});

export type NotifyPrefsInput = z.input<typeof notifyPrefsSchema>;
export type PushSubscriptionInput = z.input<typeof pushSubscriptionSchema>;
