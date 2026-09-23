import "server-only";
import { ZodError } from "zod";
import { AuthError } from "~/server/auth";
import { friendlyDbError } from "~/server/db-errors";

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
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "入力を確かめてください", fieldErrors };
    }
    if (error instanceof UserError) return { ok: false, error: error.message };
    // Next.js の redirect などはそのまま投げ直す
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: friendlyDbError(error) };
  }
}

/** 画面にそのまま出してよい、利用者向けのエラー */
export class UserError extends Error {}
