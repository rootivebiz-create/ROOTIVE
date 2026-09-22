/**
 * プッシュ通知の鍵（VAPID）。
 *
 * 3 つの環境変数がそろっているときだけ機能を出す（未設定なら画面にも出さない）。
 * 公開鍵はブラウザが購読するときに必要なので NEXT_PUBLIC_。秘密鍵はサーバー専用。
 */
export const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** ブラウザ側から見て、この環境でプッシュ通知を使えるか（公開鍵があるか） */
export function isPushConfigured(): boolean {
  return vapidPublicKey.length > 0;
}

/** サーバー側で送信できるか（秘密鍵まで含めて確認する） */
export function canSendPush(): boolean {
  return Boolean(vapidPublicKey && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** VAPID の連絡先（送信先のプッシュサービスに伝える。既定はアプリの URL） */
export function vapidSubject(): string {
  const raw = (process.env.VAPID_SUBJECT ?? "").trim();
  if (raw.startsWith("mailto:") || raw.startsWith("https://")) return raw;
  if (raw.includes("@")) return `mailto:${raw}`;
  return "mailto:rootive.biz@gmail.com";
}
