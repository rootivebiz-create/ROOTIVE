/**
 * 取引条件の明示書の状態（純関数）：未作成・未送付・送付済み・受け取り済み。
 * 一覧・1 人の画面・ホームなどが同じ言い方で出せるように、ここにまとめる。
 */

export type TermsStatusKey = "none" | "unsent" | "sent" | "received";

export const TERMS_STATUS: Record<TermsStatusKey, { label: string; hint: string }> = {
  none: { label: "未作成", hint: "明示書（取引条件の記録）がまだありません" },
  unsent: { label: "未送付", hint: "明示書は作りましたが、ドライバーに送った記録がありません" },
  sent: { label: "送付済み", hint: "送りました。ドライバーの「受け取りました」を待っています" },
  received: { label: "受け取り済み", hint: "ドライバーが「受け取りました」を押しました" },
};

export function termsStatusOf(latest: { sentAt: Date | null; receivedAt: Date | null } | null | undefined): TermsStatusKey {
  if (!latest) return "none";
  if (latest.receivedAt) return "received";
  if (latest.sentAt) return "sent";
  return "unsent";
}

/** 画面の色：稼働があるのに未作成は赤、未作成（まだ稼働なし）・未送付は黄、送付済みは灰、受け取り済みは緑 */
export function termsStatusTone(key: TermsStatusKey, workedRecently: boolean): "red" | "yellow" | "green" | "gray" {
  if (key === "none") return workedRecently ? "red" : "yellow";
  if (key === "unsent") return "yellow";
  if (key === "received") return "green";
  return "gray";
}
