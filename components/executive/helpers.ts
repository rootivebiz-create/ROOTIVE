/**
 * 代表（Executive）の画面で使う小さな純関数（表示の整えだけ）。
 *
 * 判定そのもの（滞留・期限切れ・達成率など）は DB のビューが持っている。
 * ここでは「ビューが出した値をどう見せるか」だけを決める。
 */
import { APPROVAL_KIND_LABELS, EXPORT_KIND_LABELS, type ApprovalKind } from "@/lib/db/types";
import { daysBetweenDates } from "@/lib/finance/date";
import { formatDateJa } from "@/lib/month";
import { yen } from "@/lib/format";

/** 日付（null は「—」） */
export function dateText(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return "—";
  return formatDateJa(date.slice(0, 10));
}

/** 今日からその日までの日数（過ぎていればマイナス）。日付が無ければ null */
export function daysUntil(today: string, date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  return daysBetweenDates(today, date.slice(0, 10));
}

/** 期限の状態（expired＝過ぎた、soon＝もうすぐ、ok＝まだ先、none＝日付なし） */
export type ExpiryTone = "expired" | "soon" | "ok" | "none";

export function expiryTone(today: string, date: string | null | undefined, soonDays: number): ExpiryTone {
  const left = daysUntil(today, date);
  if (left == null) return "none";
  if (left < 0) return "expired";
  return left <= soonDays ? "soon" : "ok";
}

/** 期限の状態を一言で（「あと 12 日」「8 日過ぎています」） */
export function expiryText(today: string, date: string | null | undefined): string {
  const left = daysUntil(today, date);
  if (left == null) return "期限の記載なし";
  if (left < 0) return `${-left} 日過ぎています`;
  if (left === 0) return "今日が期限です";
  return `あと ${left} 日`;
}

export const EXPIRY_BADGE: Record<Exclude<ExpiryTone, "none">, "destructive" | "warning" | "secondary"> = {
  expired: "destructive",
  soon: "warning",
  ok: "secondary",
};

/** 決裁の急ぎぐあい（v_approval_list.urgency）の見せ方 */
export const URGENCY_BADGE: Record<string, "destructive" | "warning" | "default" | "secondary"> = {
  overdue: "destructive",
  stale: "warning",
  waiting: "default",
  done: "secondary",
};

/** 決裁の状態の見せ方 */
export const APPROVAL_STATUS_BADGE: Record<string, "default" | "success" | "destructive" | "secondary"> = {
  pending: "default",
  approved: "success",
  rejected: "destructive",
  withdrawn: "secondary",
};

/** 意思決定ログの状態の見せ方 */
export const DECISION_STATUS_BADGE: Record<string, "default" | "success" | "secondary"> = {
  open: "default",
  reviewed: "success",
  dropped: "secondary",
};

/** 決裁の種別（null は「その他」） */
export function kindLabel(kind: ApprovalKind | null | undefined): string {
  return kind ? (APPROVAL_KIND_LABELS[kind] ?? "その他") : "その他";
}

/** 委任の対象の種別（空なら「すべての種別」） */
export function delegationKindsText(kinds: ApprovalKind[] | null | undefined): string {
  if (!kinds || kinds.length === 0) return "すべての種別";
  return kinds.map((k) => kindLabel(k)).join("・");
}

/** 委任の帯の文（「◯◯さんが ◯月◯日まで、◯ 円まで代理で決裁できます」） */
export function delegationBannerText(d: { to_name: string | null; to_on: string | null; max_amount: number | null }): string {
  const name = d.to_name || "管理者";
  const until = dateText(d.to_on);
  const limit = d.max_amount == null ? "金額の上限なしで" : `${yen(d.max_amount)} まで`;
  return `${name} さんが ${until}まで、${limit}代理で決裁できます`;
}

/** 株主の持株比率（総数が 0 なら null） */
export function shareRatio(shares: number | null | undefined, total: number): number | null {
  if (!total) return null;
  return Number(shares ?? 0) / total;
}

/** 達成率の色（100% 以上は緑、80% 未満は赤） */
export function achievementTone(rate: number | null | undefined): "success" | "warning" | "destructive" | "muted" {
  if (rate == null) return "muted";
  if (rate >= 1) return "success";
  if (rate >= 0.8) return "warning";
  return "destructive";
}

export const ACHIEVEMENT_TEXT: Record<"success" | "warning" | "destructive" | "muted", string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

/** 意思決定の選択肢（decisions.options は jsonb） */
export function toOptionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")).filter((v) => v !== "");
}

/** ユーザーエージェントを「どの端末から入ったか」の一言に（記録はそのまま残る） */
export function deviceText(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (ua === "") return "—";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "その他の端末";
}

/** 出力（持ち出し）の種別の表示名（表に無いものはそのまま出す） */
export function exportKindLabel(kind: string | null | undefined): string {
  const k = kind ?? "";
  return EXPORT_KIND_LABELS[k] ?? (k || "その他");
}
