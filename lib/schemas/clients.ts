import { z } from "zod";
import { memoSchema, nameSchema, uuidSchema } from "./common";
import { parseNumberInput } from "@/lib/calc/parse";
import { emailListError, normalizeEmailList } from "@/lib/mail/address";

/** 入金予定日：稼動月からのずれ（0=当月／1=翌月／2=翌々月／3=3 か月後） */
export const PAYMENT_MONTH_OFFSETS = [0, 1, 2, 3] as const;
export type PaymentMonthOffset = (typeof PAYMENT_MONTH_OFFSETS)[number];
export const PAYMENT_MONTH_OFFSET_LABELS: Record<PaymentMonthOffset, string> = {
  0: "当月",
  1: "翌月",
  2: "翌々月",
  3: "3 か月後",
};

/** 既定の敬称 */
export const DEFAULT_HONORIFIC = "御中";

/** 入金予定日のルールを短く（例: 翌月末日／翌々月 15 日） */
export function paymentRuleLabel(offset: number, day: number): string {
  const monthLabel = (PAYMENT_MONTH_OFFSET_LABELS as Record<number, string | undefined>)[offset] ?? `${offset} か月後`;
  return `${monthLabel}${day <= 0 ? "末日" : `${day}日`}`;
}

/**
 * 取引先フォームの入力（クライアント → Server Action）。
 * 数値は文字列で受け取り、zod で正規化する（全角・カンマ可）。
 */
export interface ClientFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  /** 敬称（空欄なら「御中」） */
  honorific: string;
  address: string;
  tel: string;
  /** 請求書を送るメールアドレス（任意。カンマ区切りで 5 件まで。0028） */
  email?: string;
  /** 適格請求書登録番号（任意。T ＋ 13 桁） */
  invoice_reg_no: string;
  /** 入金予定日：月（"0"〜"3"） */
  payment_month_offset: string;
  /** 入金予定日：日（"0" = 末日、"1"〜"31"） */
  payment_day: string;
  memo: string;
  is_active: boolean;
}

/** 文字列・数値を整数として検証する（全角・カンマ可） */
const intFromInput = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を選択してください` })
      .int(`${label}は整数で指定してください`)
      .min(min, `${label}は ${min} 以上で指定してください`)
      .max(max, `${label}は ${max} 以下で指定してください`),
  );

export const clientInputSchema = z.object({
  id: uuidSchema.nullable(),
  name: nameSchema,
  honorific: z
    .string()
    .trim()
    .max(10, "10 文字以内で入力してください")
    .transform((s) => (s === "" ? DEFAULT_HONORIFIC : s)),
  address: z.string().trim().max(200, "200 文字以内で入力してください"),
  tel: z.string().trim().max(50, "50 文字以内で入力してください"),
  email: z
    .string()
    .trim()
    .max(300, "300 文字以内で入力してください")
    .default("")
    .superRefine((s, ctx) => {
      const err = emailListError(s);
      if (err) ctx.addIssue({ code: "custom", message: err });
    })
    .transform(normalizeEmailList),
  invoice_reg_no: z
    .string()
    .trim()
    .max(30, "30 文字以内で入力してください")
    .refine((s) => s === "" || /^T?\d{13}$/.test(s.replace(/[-\s]/g, "")), "適格請求書登録番号は T ＋ 13 桁の数字で入力してください"),
  payment_month_offset: intFromInput(0, 3, "入金予定日（月）"),
  payment_day: intFromInput(0, 31, "入金予定日（日）"),
  memo: memoSchema,
  is_active: z.boolean(),
});

export type ClientInputParsed = z.output<typeof clientInputSchema>;
