import { z } from "zod";
import { moneySchema, percentToRateSchema, qtySchema, roundingModeSchema } from "./common";
import { parseNumberInput, rateToPercent } from "@/lib/calc/parse";
import { QUOTE_MAX_DRIVERS } from "@/lib/calc/quote";
import type { QuoteInput } from "@/lib/calc/quote";
import type { RoundingMode } from "@/lib/calc/types";

/**
 * 受注単価の見極め（/projects?tab=quote）の入力。
 * 画面だけで完結する試算のため保存はしないが、入力の検証・正規化は他の画面と同じ zod で行う。
 * 空欄は 0 として扱う（途中まで入力した状態でも試算を出したいため）。
 */

const emptyToZero = (v: unknown) => (typeof v === "string" && v.trim() === "" ? 0 : v);

/** 金額・単価（空欄は 0） */
export const quoteMoneySchema = z.preprocess(emptyToZero, moneySchema);

/** 月の数量（空欄は 0） */
export const quoteQtySchema = z.preprocess(emptyToZero, qtySchema);

/** 率（パーセント入力。空欄は 0） */
export const quoteRateSchema = z.preprocess(emptyToZero, percentToRateSchema);

/** 必要なドライバー数（0〜999 の整数。空欄は 0） */
export const quoteDriverCountSchema = z.preprocess(
  (v) => {
    const zero = emptyToZero(v);
    return typeof zero === "string" ? parseNumberInput(zero) : zero;
  },
  z
    .number({ error: "人数を入力してください" })
    .int("人数は整数で入力してください")
    .min(0, "0 人以上で入力してください")
    .max(QUOTE_MAX_DRIVERS, `${QUOTE_MAX_DRIVERS} 人以下で入力してください`),
);

export const quoteFormSchema = z.object({
  bill_rate: quoteMoneySchema,
  pay_rate: quoteMoneySchema,
  qty: quoteQtySchema,
  royalty_rate: quoteRateSchema,
  mgmt_fee: quoteMoneySchema,
  driver_count: quoteDriverCountSchema,
  vehicle_cost: quoteMoneySchema,
  other_cost: quoteMoneySchema,
  target_margin: quoteRateSchema,
  rounding_mode: roundingModeSchema,
});

export type QuoteFormParsed = z.output<typeof quoteFormSchema>;

/** 画面のフォームの値（すべて文字列。全角・カンマも入力できる） */
export interface QuoteFormInput {
  bill_rate: string;
  pay_rate: string;
  qty: string;
  royalty_rate: string;
  mgmt_fee: string;
  driver_count: string;
  vehicle_cost: string;
  other_cost: string;
  target_margin: string;
  rounding_mode: RoundingMode;
}

export type QuoteFormField = keyof QuoteFormInput;
/** 数値で入力する項目（端数処理だけはプルダウン） */
export type QuoteNumericField = Exclude<QuoteFormField, "rounding_mode">;
export type QuoteFormErrors = Partial<Record<QuoteFormField, string>>;

const NUMERIC_SCHEMAS: Record<QuoteNumericField, z.ZodType<number>> = {
  bill_rate: quoteMoneySchema,
  pay_rate: quoteMoneySchema,
  qty: quoteQtySchema,
  royalty_rate: quoteRateSchema,
  mgmt_fee: quoteMoneySchema,
  driver_count: quoteDriverCountSchema,
  vehicle_cost: quoteMoneySchema,
  other_cost: quoteMoneySchema,
  target_margin: quoteRateSchema,
};

const NUMERIC_FIELDS = Object.keys(NUMERIC_SCHEMAS) as QuoteNumericField[];

export interface QuoteParseResult {
  /** すべての項目が正しいか */
  ok: boolean;
  /** 項目ごとの日本語エラー（空ならすべて正しい） */
  errors: QuoteFormErrors;
  /** 計算に使う条件（不正な項目は 0 として扱うので、入力の途中でも試算できる） */
  input: QuoteInput;
  /** 目標利益率（0.15 = 15%）。判定と逆算に使う */
  targetMargin: number;
}

/** フォームの値を検証して計算用の条件にする。項目ごとに日本語のエラーを返す */
export function parseQuoteForm(form: QuoteFormInput): QuoteParseResult {
  const errors: QuoteFormErrors = {};
  const values = {} as Record<QuoteNumericField, number>;
  for (const field of NUMERIC_FIELDS) {
    const parsed = NUMERIC_SCHEMAS[field].safeParse(form[field]);
    if (parsed.success) {
      values[field] = parsed.data;
    } else {
      values[field] = 0;
      errors[field] = parsed.error.issues[0]?.message ?? "入力を確認してください";
    }
  }
  const mode = roundingModeSchema.safeParse(form.rounding_mode);
  if (!mode.success) errors.rounding_mode = "端数処理を選んでください";
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    input: {
      billRate: values.bill_rate,
      payRate: values.pay_rate,
      qty: values.qty,
      royaltyRate: values.royalty_rate,
      mgmtFee: values.mgmt_fee,
      driverCount: values.driver_count,
      vehicleCost: values.vehicle_cost,
      otherCost: values.other_cost,
      roundingMode: mode.success ? mode.data : "none",
    },
    targetMargin: values.target_margin,
  };
}

/** 会社設定の既定（ロイヤリティ率・管理費・端数処理）からフォームの初期値を作る */
export function defaultQuoteForm(defaults: {
  royaltyRate: number;
  mgmtFee: number;
  roundingMode: RoundingMode;
  targetMargin?: number | null;
}): QuoteFormInput {
  return {
    bill_rate: "",
    pay_rate: "",
    qty: "",
    royalty_rate: String(rateToPercent(defaults.royaltyRate)),
    mgmt_fee: String(defaults.mgmtFee),
    driver_count: "1",
    vehicle_cost: "",
    other_cost: "",
    target_margin: defaults.targetMargin != null ? String(rateToPercent(defaults.targetMargin)) : "",
    rounding_mode: defaults.roundingMode,
  };
}

// ---------------------------------------------------------------------------
// 画面のタブ（/projects?tab=）
// ---------------------------------------------------------------------------

export const PROJECT_TABS = ["pl", "quote"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export const projectTabSchema = z.enum(PROJECT_TABS);

/** URL の ?tab= からタブを取り出す（不正・未指定なら "pl" ＝ 案件別採算） */
export function projectTabFromParam(param: string | string[] | undefined): ProjectTab {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = projectTabSchema.safeParse(v);
  return parsed.success ? parsed.data : "pl";
}
