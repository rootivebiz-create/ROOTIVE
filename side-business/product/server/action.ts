import "server-only";
import { ZodError } from "zod";
import { AuthError } from "~/server/auth";
import { friendlyDbError, pgErrorMessage } from "~/server/db-errors";

/** Server Action の返し値。画面はこれだけを見ればよい */
export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Server Action を包む：権限の失敗・入力の誤り・DB のエラーを、画面に出せる日本語にする。
 * 呼び出す側は、最初に必ず requireUser() で役割を確かめること。
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, message, data };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof ZodError) return zodResult(error);
    if (error instanceof UserError) return { ok: false, error: error.message };
    // Next.js の redirect などはそのまま投げ直す
    if (error && typeof error === "object" && "digest" in error) throw error;
    logActionError(error);
    return { ok: false, error: friendlyDbError(error) };
  }
}

/**
 * 入力の誤り（zod）を画面の形に。入力欄ごとの誤りは fieldErrors に、
 * 入力欄の決まらない誤り（1 つの値だけを確かめたとき・全体の決まり）は、その文をそのまま error にする
 */
export function zodResult(error: ZodError): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  let general: string | null = null;
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key) {
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    } else if (!general && /[\u3040-\u30ff\u4e00-\u9fff]/.test(issue.message)) {
      // 日本語で書いた文だけを出す（zod の既定の英語の文は出さない）
      general = issue.message;
    }
  }
  const hasFields = Object.keys(fieldErrors).length > 0;
  return { ok: false, error: general ?? "入力を確かめてください", ...(hasFields ? { fieldErrors } : {}) };
}

/**
 * 思わぬエラーの記録（Vercel の Logs に 1 行の JSON で出る。Log Drain をつなげば、外の置き場所でも探せる）。
 * 探すときは "action failed" で。入力の値は出さない（DB のエラーの文と、どこで起きたかだけ）
 */
export function logActionError(error: unknown) {
  const e = error instanceof Error ? error : null;
  const code = (error as { code?: unknown } | null)?.code ?? (e?.cause as { code?: unknown } | undefined)?.code;
  console.error(
    JSON.stringify({
      level: "error",
      event: "action failed",
      at: new Date().toISOString(),
      name: e?.name ?? typeof error,
      message: pgErrorMessage(error).slice(0, 500),
      code: typeof code === "string" ? code : undefined,
      stack: e?.stack?.split("\n").slice(1, 6).map((l) => l.trim()),
    }),
  );
}

/** 画面にそのまま出してよい、利用者向けのエラー */
export class UserError extends Error {}
