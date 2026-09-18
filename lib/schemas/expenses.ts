import { z } from "zod";
import { memoSchema, monthSchema, signedMoneySchema, uuidSchema } from "./common";
import { MONTH_RE } from "@/lib/month";
import { TAX_MODES, type TaxMode } from "@/lib/calc/types";
import { EXPENSE_KINDS, type ExpenseKind } from "@/lib/db/types";

/**
 * 経費（会社の固定費・変動費）の入力スキーマ。
 * 金額・日付・月はクライアントから文字列で受け取り、zod で正規化する（全角・カンマ可、空欄は null）。
 * 金額はすべて税抜。tax_mode は消費税の集計用（taxable = 課税／exempt = 対象外）。
 */

/** 経費の課税区分の表示（明細・CSV 用の短い表記） */
export const EXPENSE_TAX_MODE_LABELS: Record<TaxMode, string> = {
  taxable: "課税",
  exempt: "対象外",
};

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** "YYYY-MM-DD" として実在する日付か */
export function isDateString(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 空欄（"" / 空白のみ / null / undefined）は null にする */
const emptyToNull = (v: unknown) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v);

/** 任意の ID（空欄は null＝指定なし） */
export const optionalIdSchema = z.preprocess(emptyToNull, uuidSchema.nullable());

/** 任意の日付（空欄は null） */
export const optionalDateSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください")
    .nullable(),
);

/** 任意の稼動月（空欄は null＝制限なし） */
export const optionalMonthSchema = z.preprocess(emptyToNull, z.string().regex(MONTH_RE, "月は YYYY-MM 形式で指定してください").nullable());

export const expenseLabelSchema = z.string().trim().min(1, "内容を入力してください").max(100, "100 文字以内で入力してください");
export const categoryNameSchema = z.string().trim().min(1, "カテゴリ名を入力してください").max(50, "50 文字以内で入力してください");
export const vendorSchema = z.string().trim().max(100, "100 文字以内で入力してください").default("");
export const taxModeSchema = z.enum(TAX_MODES, { error: "課税区分を選択してください" });
export const expenseKindSchema = z.enum(EXPENSE_KINDS, { error: "区分を選択してください" });
export const categoryIdSchema = z.string().uuid("カテゴリを選択してください");

// ---------------------------------------------------------------------------
// 経費（1 件）
// ---------------------------------------------------------------------------

/** 経費ダイアログの入力（クライアント → Server Action） */
export interface ExpenseFormInput {
  /** null = 新規 */
  id: string | null;
  /** 稼動月 "YYYY-MM" */
  month: string;
  category_id: string;
  label: string;
  /** 税抜の金額。マイナス可（返金） */
  amount: string;
  tax_mode: TaxMode;
  /** "" = 指定なし */
  incurred_on: string;
  /** "" = 指定なし */
  driver_id: string;
  /** "" = 指定なし */
  project_id: string;
  vendor: string;
  memo: string;
}

export const expenseInputSchema = z.object({
  id: optionalIdSchema,
  month: monthSchema,
  category_id: categoryIdSchema,
  label: expenseLabelSchema,
  amount: signedMoneySchema,
  tax_mode: taxModeSchema,
  incurred_on: optionalDateSchema,
  driver_id: optionalIdSchema,
  project_id: optionalIdSchema,
  vendor: vendorSchema,
  memo: memoSchema,
});

export type ExpenseValues = z.output<typeof expenseInputSchema>;

/** 毎月かかる経費の計上（RPC apply_recurring_expenses） */
export const applyRecurringExpensesSchema = z.object({ month: monthSchema });

// ---------------------------------------------------------------------------
// 経費カテゴリ（設定画面：フォーム全体の一括保存）
// ---------------------------------------------------------------------------

export interface ExpenseCategoryRowInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  kind: ExpenseKind;
  memo: string;
  is_active: boolean;
}

export const expenseCategoryRowSchema = z.object({
  id: optionalIdSchema,
  name: categoryNameSchema,
  kind: expenseKindSchema,
  memo: memoSchema,
  is_active: z.boolean(),
});

export const saveExpenseCategoriesSchema = z
  .object({ rows: z.array(expenseCategoryRowSchema).max(100, "カテゴリが多すぎます") })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rows.forEach((r, i) => {
      if (seen.has(r.name)) ctx.addIssue({ code: "custom", message: "同じ名前のカテゴリがあります", path: ["rows", i, "name"] });
      seen.add(r.name);
    });
  });

// ---------------------------------------------------------------------------
// 毎月かかる経費（設定画面：フォーム全体の一括保存）
// ---------------------------------------------------------------------------

export interface RecurringExpenseRowInput {
  /** null = 新規 */
  id: string | null;
  category_id: string;
  label: string;
  /** 税抜の金額。マイナス可 */
  amount: string;
  tax_mode: TaxMode;
  /** "" = 指定なし */
  driver_id: string;
  /** "" = 指定なし */
  project_id: string;
  vendor: string;
  /** "" = 制限なし。"YYYY-MM" */
  start_month: string;
  /** "" = 制限なし。"YYYY-MM" */
  end_month: string;
  is_active: boolean;
}

export const recurringExpenseRowSchema = z
  .object({
    id: optionalIdSchema,
    category_id: categoryIdSchema,
    label: expenseLabelSchema,
    amount: signedMoneySchema,
    tax_mode: taxModeSchema,
    driver_id: optionalIdSchema,
    project_id: optionalIdSchema,
    vendor: vendorSchema,
    start_month: optionalMonthSchema,
    end_month: optionalMonthSchema,
    is_active: z.boolean(),
  })
  .refine((r) => r.start_month == null || r.end_month == null || r.start_month <= r.end_month, {
    message: "終了月は開始月と同じか後の月にしてください",
    path: ["end_month"],
  });

export const saveRecurringExpensesSchema = z.object({
  rows: z.array(recurringExpenseRowSchema).max(200, "毎月かかる経費が多すぎます"),
});
