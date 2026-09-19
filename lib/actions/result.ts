import type { PostgrestError, PostgrestMaybeSingleResponse, PostgrestResponse, PostgrestSingleResponse } from "@supabase/supabase-js";
import { ZodError } from "zod";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export class ActionError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ActionError";
  }
}

const HINT_MESSAGES: Record<string, string> = {
  MONTH_CLOSED: "締め済みの月は変更できません。締めを解除してから操作してください。",
  FORBIDDEN: "この操作を行う権限がありません。",
  OWNER_ONLY: "この操作はオーナーのみ可能です。",
  SELF_CHANGE: "自分自身のロール変更・無効化はできません。",
  ALREADY_CLOSED: "この月は既に締め済みです。",
  INVITATION_REQUIRED: "招待が必要です。オーナーに招待を依頼してください。",
  ID_CONFLICT: "他社のデータと ID が衝突するため取り込めません。",
  NAME_CONFLICT: "同じ名前のマスタが別の ID で登録されています。",
  NAME_MISMATCH: "会社名が一致しません。",
  NOT_EMPTY: "既にデータがあるため初期データは投入できません。",
  ALREADY_APPROVED: "承認済みの報告は変更できません。担当者に連絡してください。",
  EMPTY_BODY: "メッセージを入力してください。",
  NOT_FOUND: "対象が見つかりません。",
};

function isPostgrestError(e: unknown): e is PostgrestError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

/** DB / Supabase / zod のエラーを日本語のメッセージへ変換する */
export function translateError(e: unknown): string {
  if (e instanceof ActionError) return e.message;
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return first ? `${first.path.join(".") || "入力"}: ${first.message}` : "入力内容に誤りがあります。";
  }
  if (isPostgrestError(e)) {
    const hint = (e.hint ?? "").trim();
    if (hint && HINT_MESSAGES[hint]) return HINT_MESSAGES[hint];
    switch (e.code) {
      case "23505":
        return "同じ名前（または同じ組み合わせ）が既に登録されています。";
      case "23503":
        return "他のデータから参照されているため削除できません。停止中に変更してください。";
      case "23514":
        return `入力値が許容範囲外です（${e.message}）。`;
      case "42501":
        return "この操作を行う権限がありません。";
      case "PGRST116":
        return "対象のデータが見つかりません。";
      case "P0001":
        return e.message; // DB 側で日本語メッセージを付けている
      default:
        if (/row-level security/i.test(e.message)) return "この操作を行う権限がありません（RLS）。";
        if (/締め済み/.test(e.message)) return e.message;
        return `データベースエラー: ${e.message}`;
    }
  }
  if (e instanceof Error) {
    if (/NEXT_REDIRECT/.test(e.message)) throw e;
    return e.message || "エラーが発生しました。";
  }
  return "エラーが発生しました。";
}

/** Server Action の共通ラッパー：例外を ActionResult に変換する */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (e) {
    if (e instanceof Error && (e.message === "NEXT_REDIRECT" || (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT"))) throw e;
    if (e instanceof ActionError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of e.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { ok: false, error: translateError(e), fieldErrors };
    }
    return { ok: false, error: translateError(e) };
  }
}

/** supabase の { data, error } を検査して data を返す（.single() / .maybeSingle() / 一覧のいずれにも使える） */
export function unwrap<T>(res: PostgrestSingleResponse<T> | PostgrestMaybeSingleResponse<T> | PostgrestResponse<T>, notFoundMessage?: string): T;
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }, notFoundMessage?: string): T;
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }, notFoundMessage = "データが見つかりません。"): T {
  if (res.error) throw res.error;
  if (res.data == null) throw new ActionError(notFoundMessage);
  return res.data;
}

export function ensureNoError(res: { error: PostgrestError | null }): void {
  if (res.error) throw res.error;
}
