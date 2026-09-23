import { z } from "zod";
import { MONTH_RE } from "@/lib/month";
import { parseNumberInput, parsePercentInput } from "@/lib/calc/parse";
import { ROUNDING_MODES } from "@/lib/calc/types";

function decimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = n.toString();
  if (s.includes("e-")) return 10;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** 稼動月 "YYYY-MM" */
export const monthSchema = z.string().regex(MONTH_RE, "稼動月は YYYY-MM 形式で指定してください");

/** 月初日 "YYYY-MM-01"（DB 形式） */
export const monthDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "稼動月が不正です");

export const uuidSchema = z.string().uuid("ID が不正です");

/** 金額・単価（0 以上、小数 2 桁まで。全角・カンマ可） */
export const moneySchema = z.preprocess(
  (v) => (typeof v === "string" ? parseNumberInput(v) : v),
  z
    .number({ error: "数値を入力してください" })
    .min(0, "0 以上で入力してください")
    .max(999_999_999, "金額が大きすぎます")
    .refine((n) => decimals(n) <= 2, "小数は 2 桁までです"),
);

/** 符号付き金額（調整用） */
export const signedMoneySchema = z.preprocess(
  (v) => (typeof v === "string" ? parseNumberInput(v) : v),
  z
    .number({ error: "数値を入力してください" })
    .min(-999_999_999, "金額が小さすぎます")
    .max(999_999_999, "金額が大きすぎます")
    .refine((n) => decimals(n) <= 2, "小数は 2 桁までです"),
);

/** 数量（0 以上、小数 2 桁まで） */
export const qtySchema = z.preprocess(
  (v) => (typeof v === "string" ? parseNumberInput(v) : v),
  z
    .number({ error: "数量を入力してください" })
    .min(0, "数量は 0 以上で入力してください")
    .max(999_999, "数量が大きすぎます")
    .refine((n) => decimals(n) <= 2, "小数は 2 桁までです"),
);

/** ロイヤリティ率：入力はパーセント（"10", "12.5"）、値は率（0.1）。0〜100% */
export const percentToRateSchema = z.preprocess(
  (v) => (typeof v === "string" ? parsePercentInput(v) : typeof v === "number" ? Math.round(v * 100) / 10_000 : v),
  z.number({ error: "率を入力してください" }).min(0, "0% 以上で入力してください").max(1, "100% 以下で入力してください"),
);

/** 率そのもの（0〜1） */
export const rateSchema = z.number().min(0).max(1);

export const roundingModeSchema = z.enum(ROUNDING_MODES);
export const unitSchema = z.enum(["day", "piece"]);
export const roleSchema = z.enum(["owner", "admin", "viewer", "driver"]);

export const nameSchema = z.string().trim().min(1, "名前を入力してください").max(100, "100 文字以内で入力してください");
export const memoSchema = z.string().trim().max(2000, "2000 文字以内で入力してください").default("");
export const emailSchema = z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません");

/** FormData から文字列を取り出す */
export function fd(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
export function fdBool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "on" || v === "true" || v === "1";
}

/* ------------------------------------------------------------------ *
 * 日付と任意の ID（0025：expenses / hr / finance に同じものが 3 つあったのでここへまとめた）
 * ------------------------------------------------------------------ */

/** "YYYY-MM-DD" の形（存在する日付かどうかは isDateString が見る） */
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 形が正しく、実在する日付か（2 月 30 日・うるう年でない 2 月 29 日は false） */
export function isDateString(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 空欄・空白だけ・null は null（未設定）にそろえる */
export const emptyToNull = (v: unknown) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v);

/** 任意の日付（空欄は null） */
export const optionalDateSchema = z.preprocess(
  emptyToNull,
  z.string().refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください").nullable(),
);

/** 任意の ID（空欄・null は null＝指定なし／新規） */
export const optionalIdSchema = z.preprocess(emptyToNull, uuidSchema.nullable());
