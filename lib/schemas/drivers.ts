import { z } from "zod";
import { memoSchema, moneySchema, nameSchema, percentToRateSchema, roundingModeSchema, signedMoneySchema, uuidSchema } from "./common";
import { parseNumberInput } from "@/lib/calc/parse";
import { TAX_MODES, type RoundingMode, type TaxMode } from "@/lib/calc/types";

/**
 * ドライバー設定フォームの入力（クライアント → Server Action）。
 * 数値はすべて文字列で受け取り、zod で正規化する（全角・カンマ可）。
 */
export interface DriverFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  kana: string;
  is_active: boolean;
  /** パーセント表記（"10", "12.5"）。null = 会社設定に従う */
  royalty_rate: string | null;
  /** 月額（円） */
  mgmt_fee: string;
  /** "" = 会社設定に従う */
  rounding_mode: RoundingMode | "";
  phone: string;
  email: string;
  bank_info: string;
  memo: string;
  /** 課税区分（taxable = 消費税を上乗せ／exempt = 上乗せしない） */
  tax_mode: TaxMode;
  /** ドライバーの適格請求書登録番号（任意。T ＋ 13 桁） */
  invoice_reg_no: string;
  /** 振込予定日：会社設定に従うなら null。個別なら "0"〜"3"（月）と "0"（末日）〜"31"（日） */
  payout_month_offset: string | null;
  payout_day: string | null;
  /** 案件内容ごとのドライバー別単価。受注・支払の両方が空欄なら標準（override 行を削除） */
  overrides: DriverOverrideFormInput[];
  /** 固定控除。id が null なら新規。送られてこなかった既存 id は削除 */
  recurring: DriverRecurringFormInput[];
}

export interface DriverOverrideFormInput {
  project_item_id: string;
  /** 個別の受注単価（空欄＝案件内容の標準） */
  bill_rate: string;
  /** 個別の支払単価（空欄＝案件内容の標準） */
  pay_rate: string;
}

export interface DriverRecurringFormInput {
  id: string | null;
  label: string;
  /** 符号付き。控除はマイナス */
  amount: string;
  count_as_profit: boolean;
  is_active: boolean;
}

/** 空欄は null（標準）、それ以外は金額として検証 */
export const optionalMoneySchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
  moneySchema.nullable(),
);

/** "" / null は会社設定に従う（null） */
export const optionalRoundingModeSchema = z.preprocess((v) => (v === "" || v == null ? null : v), roundingModeSchema.nullable());

export const driverOverrideSchema = z.object({
  project_item_id: uuidSchema,
  bill_rate: optionalMoneySchema,
  pay_rate: optionalMoneySchema,
});

export const driverRecurringSchema = z.object({
  id: uuidSchema.nullable(),
  label: z.string().trim().min(1, "項目名を入力してください").max(100, "100 文字以内で入力してください"),
  amount: signedMoneySchema,
  count_as_profit: z.boolean(),
  is_active: z.boolean(),
});

/** null／空欄は「会社設定に従う」、それ以外は整数として検証 */
const optionalIntSchema = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? parseNumberInput(v) : v),
    z
      .number({ error: `${label}を選択してください` })
      .int(`${label}は整数で指定してください`)
      .min(min, `${label}は ${min} 以上で指定してください`)
      .max(max, `${label}は ${max} 以下で指定してください`)
      .nullable(),
  );

export const driverInputSchema = z.object({
  id: uuidSchema.nullable(),
  name: nameSchema,
  kana: z.string().trim().max(100, "100 文字以内で入力してください"),
  is_active: z.boolean(),
  royalty_rate: percentToRateSchema.nullable(),
  mgmt_fee: moneySchema,
  rounding_mode: optionalRoundingModeSchema,
  phone: z.string().trim().max(50, "50 文字以内で入力してください"),
  email: z
    .string()
    .trim()
    .max(200, "200 文字以内で入力してください")
    .refine((s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "メールアドレスの形式が正しくありません"),
  bank_info: z.string().trim().max(500, "500 文字以内で入力してください"),
  memo: memoSchema,
  tax_mode: z.enum(TAX_MODES, { error: "課税区分を選択してください" }),
  invoice_reg_no: z
    .string()
    .trim()
    .max(30, "30 文字以内で入力してください")
    .refine((s) => s === "" || /^T?\d{13}$/.test(s.replace(/[-\s]/g, "")), "適格請求書登録番号は T ＋ 13 桁の数字で入力してください"),
  payout_month_offset: optionalIntSchema(0, 3, "振込予定日（月）"),
  payout_day: optionalIntSchema(0, 31, "振込予定日（日）"),
  overrides: z.array(driverOverrideSchema).max(500, "個別単価が多すぎます"),
  recurring: z.array(driverRecurringSchema).max(50, "固定控除が多すぎます"),
});

export type DriverInputParsed = z.output<typeof driverInputSchema>;

export const reorderDirectionSchema = z.enum(["up", "down"]);
export const reorderInputSchema = z.object({
  id: uuidSchema,
  direction: reorderDirectionSchema,
});
export type ReorderInput = z.input<typeof reorderInputSchema>;
