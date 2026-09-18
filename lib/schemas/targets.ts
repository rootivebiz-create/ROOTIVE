import { z } from "zod";
import { memoSchema, moneySchema, monthSchema } from "@/lib/schemas/common";
import { normalizeNumericString } from "@/lib/calc/parse";

/** 目標額：空欄は「未設定（0）」として扱う。全角・カンマ可（moneySchema） */
const targetMoneySchema = z.preprocess((v) => (typeof v === "string" && normalizeNumericString(v) === "" ? 0 : v), moneySchema);

/** 月次目標（会社 × 月の売上目標・営業利益目標） */
export const saveMonthTargetSchema = z.object({
  month: monthSchema,
  bill_target: targetMoneySchema,
  profit_target: targetMoneySchema,
  memo: memoSchema,
});

export type SaveMonthTargetValues = z.output<typeof saveMonthTargetSchema>;

/** クライアントから渡す形（数値は文字列のままでよい。サーバー側で正規化する） */
export interface SaveMonthTargetInput {
  month: string;
  bill_target: string | number;
  profit_target: string | number;
  memo: string;
}

/** 目標の削除 */
export const deleteMonthTargetSchema = z.object({ month: monthSchema });
