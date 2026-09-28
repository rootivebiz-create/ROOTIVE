import { z } from "zod";

/**
 * 1 つの入力欄についての誤り。runAction が入力欄ごとの誤り（fieldErrors）として画面へ返す。
 * （名前の重なりなど、DB を見て初めて分かる誤りに使う）
 */
export function fieldError(field: string, message: string): z.ZodError {
  return new z.ZodError([{ code: "custom", path: [field], message, input: undefined }]);
}

/** テスト・画面用：誤りの最初の文 */
export function firstIssue(error: unknown): string | null {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? null;
  if (error instanceof Error) return error.message;
  return null;
}
