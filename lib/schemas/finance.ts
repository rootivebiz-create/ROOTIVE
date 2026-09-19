import { z } from "zod";
import { memoSchema, moneySchema, monthSchema, nameSchema, percentToRateSchema, uuidSchema } from "./common";
import { isDateString } from "./expenses";
import { normalizeNumericString, parseNumberInput } from "@/lib/calc/parse";
import { FINANCE_MAX_YEAR, FINANCE_MIN_YEAR } from "@/lib/finance/date";
import type { LoanStatus, TaxTaskStatus } from "@/lib/db/types";

/**
 * 財務（年間予算・借入金・税務カレンダー）の入力スキーマ（サーバー・クライアント共用）
 *
 * - 金額・率・人数はクライアントから文字列で受け取り、zod で正規化する（全角・カンマ可）
 * - 年利は画面では % で入力し、DB には率（0.018 = 1.8%）で入れる（percentToRateSchema）
 * - 日付は "YYYY-MM-DD"、稼動月は "YYYY-MM"
 */

/** 空欄（"" / 空白のみ / null / undefined）は null にする */
const emptyToNull = (v: unknown) => (v == null || (typeof v === "string" && normalizeNumericString(v) === "") ? null : v);

/** 空欄は 0 として扱う（目標・返済額の「未設定」） */
const emptyToZero = (v: unknown) => (v == null || (typeof v === "string" && normalizeNumericString(v) === "") ? 0 : v);

/** 必須の日付 "YYYY-MM-DD" */
export const dateSchema = z.string().trim().refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください");

/** 任意の日付（空欄は null） */
export const optionalDateSchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
  z.string().refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください").nullable(),
);

/** 任意の ID（空欄・null は null＝新規） */
export const optionalIdSchema = z.preprocess((v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v), uuidSchema.nullable());

/** 目標・予算の金額（空欄は 0） */
export const targetMoneySchema = z.preprocess(emptyToZero, moneySchema);

/** 任意の金額（空欄は null＝未入力） */
export const optionalMoneySchema = z.preprocess(emptyToNull, moneySchema.nullable());

/** 人数（0〜9999 の整数。空欄は 0） */
export const headcountSchema = z.preprocess(
  (v) => {
    const z0 = emptyToZero(v);
    return typeof z0 === "string" ? parseNumberInput(z0) : z0;
  },
  z.number({ error: "人数を入力してください" }).int("人数は整数で入力してください").min(0, "0 以上で入力してください").max(9999, "人数が大きすぎます"),
);

/** 西暦 4 桁（2000〜2100） */
export const yearSchema = z.preprocess(
  (v) => (typeof v === "string" ? parseNumberInput(v) : v),
  z
    .number({ error: "年を指定してください" })
    .int("年は整数で指定してください")
    .min(FINANCE_MIN_YEAR, `${FINANCE_MIN_YEAR} 年以降で指定してください`)
    .max(FINANCE_MAX_YEAR, `${FINANCE_MAX_YEAR} 年以前で指定してください`),
);

// ---------------------------------------------------------------------------
// 画面のタブ（?tab=）
// ---------------------------------------------------------------------------

export const FINANCE_TABS = ["budget", "loans", "tax"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
export const financeTabSchema = z.enum(FINANCE_TABS);

/** URL の ?tab= からタブを取り出す（不正・未指定なら "budget"） */
export function financeTabFromParam(param: string | string[] | undefined): FinanceTab {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = financeTabSchema.safeParse(v);
  return parsed.success ? parsed.data : "budget";
}

// ---------------------------------------------------------------------------
// 年間予算（month_targets を 12 か月まとめて保存する）
// ---------------------------------------------------------------------------

/** 1 か月ぶんの目標（クライアント → Server Action） */
export interface YearTargetRowInput {
  /** "YYYY-MM" */
  month: string;
  bill_target: string | number;
  profit_target: string | number;
  expense_target: string | number;
  driver_target: string | number;
}

export interface SaveYearTargetsInput {
  year: string | number;
  rows: YearTargetRowInput[];
}

export const yearTargetRowSchema = z.object({
  month: monthSchema,
  bill_target: targetMoneySchema,
  profit_target: targetMoneySchema,
  expense_target: targetMoneySchema,
  driver_target: headcountSchema,
});

export const saveYearTargetsSchema = z
  .object({
    year: yearSchema,
    rows: z.array(yearTargetRowSchema).min(1, "保存する月がありません").max(12, "保存できるのは 12 か月ぶんまでです"),
  })
  .refine((v) => v.rows.every((r) => Number(r.month.slice(0, 4)) === v.year), {
    message: "対象年と月が一致しません",
    path: ["rows"],
  })
  .refine((v) => new Set(v.rows.map((r) => r.month)).size === v.rows.length, {
    message: "同じ月が重複しています",
    path: ["rows"],
  });

// ---------------------------------------------------------------------------
// 借入金
// ---------------------------------------------------------------------------

/** 借入の状態（DB の enum loan_status と同じ並び） */
export const LOAN_STATUS_VALUES = ["active", "paid", "planned"] as const satisfies readonly LoanStatus[];
export const loanStatusSchema = z.enum(LOAN_STATUS_VALUES, { error: "状態を選択してください" });

/** 返済回数（1〜600 か月） */
export const loanMonthsSchema = z.preprocess(
  (v) => (typeof v === "string" ? parseNumberInput(v) : v),
  z.number({ error: "回数を入力してください" }).int("回数は整数で入力してください").min(1, "回数は 1 以上で入力してください").max(600, "回数は 600 以下で入力してください"),
);

/** 返済日（0 = 月末、1〜31） */
export const paymentDaySchema = z.preprocess(
  (v) => {
    const z0 = emptyToZero(v);
    return typeof z0 === "string" ? parseNumberInput(z0) : z0;
  },
  z.number({ error: "返済日を入力してください" }).int("返済日は整数で入力してください").min(0, "返済日は 0〜31 で入力してください").max(31, "返済日は 0〜31 で入力してください"),
);

/** 借入フォームの入力（クライアント → Server Action） */
export interface LoanFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  lender: string;
  principal: string | number;
  /** % で入力する（1.8 → 0.018） */
  annual_rate: string | number;
  /** 借入日 "YYYY-MM-DD" */
  start_on: string;
  months: string | number;
  /** 0 = 月末 */
  payment_day: string | number;
  /** 0 なら元利均等で自動計算 */
  monthly_payment: string | number;
  status: LoanStatus;
  memo: string;
}

export const loanInputSchema = z.object({
  id: optionalIdSchema,
  name: nameSchema,
  lender: z.string().trim().max(100, "100 文字以内で入力してください").default(""),
  principal: moneySchema,
  annual_rate: percentToRateSchema,
  start_on: dateSchema,
  months: loanMonthsSchema,
  payment_day: paymentDaySchema,
  monthly_payment: targetMoneySchema,
  status: loanStatusSchema,
  memo: memoSchema,
});

export const deleteLoanSchema = z.object({ id: uuidSchema });

/** 返済予定の「返済済みにする」／「戻す」（paid_on が null なら未返済） */
export const setLoanPaymentPaidSchema = z.object({ id: uuidSchema, paid_on: optionalDateSchema });

// ---------------------------------------------------------------------------
// 決算・税務の期限
// ---------------------------------------------------------------------------

/** 期限の状態（DB の enum tax_task_status と同じ並び） */
export const TAX_TASK_STATUS_VALUES = ["todo", "done", "skipped"] as const satisfies readonly TaxTaskStatus[];
export const taxTaskStatusSchema = z.enum(TAX_TASK_STATUS_VALUES, { error: "状態を選択してください" });

/** 期限フォームの入力（クライアント → Server Action） */
export interface TaxTaskFormInput {
  /** null = 新規 */
  id: string | null;
  title: string;
  detail: string;
  /** "YYYY-MM-DD" */
  due_on: string;
  status: TaxTaskStatus;
  /** 納付額（"" = 未入力） */
  amount: string | number;
  memo: string;
}

export const taxTaskInputSchema = z.object({
  id: optionalIdSchema,
  title: z.string().trim().min(1, "内容を入力してください").max(200, "200 文字以内で入力してください"),
  detail: z.string().trim().max(1000, "1000 文字以内で入力してください").default(""),
  due_on: dateSchema,
  status: taxTaskStatusSchema,
  amount: optionalMoneySchema,
  memo: memoSchema,
});

export const deleteTaxTaskSchema = z.object({ id: uuidSchema });

export const setTaxTaskStatusSchema = z.object({ id: uuidSchema, status: taxTaskStatusSchema });

export const ensureTaxTasksSchema = z.object({ year: yearSchema });
