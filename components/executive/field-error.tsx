import type { ZodError } from "zod";

export type FieldErrors = Record<string, string[]>;

/** zod の issues を項目ごとのエラーへ（Server Action の fieldErrors と同じ形） */
export function toFieldErrors(issues: ZodError["issues"]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** 項目の下に出すエラー 1 行 */
export function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}
