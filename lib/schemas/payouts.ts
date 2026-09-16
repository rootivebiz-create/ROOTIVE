import { z } from "zod";
import { memoSchema, moneySchema, monthSchema, signedMoneySchema, uuidSchema } from "@/lib/schemas/common";

/** 調整（控除・加算）1 行。amount は符号付き（控除はマイナス） */
export const adjustmentInputSchema = z.object({
  id: uuidSchema.optional(),
  label: z.string().trim().min(1, "項目名を入力してください").max(100, "項目名は 100 文字以内で入力してください"),
  amount: signedMoneySchema,
  countAsProfit: z.boolean().default(true),
  recurringId: uuidSchema.nullable().optional(),
});

/** 管理費・メモ・調整の一括保存 */
export const saveDriverMonthSchema = z.object({
  month: monthSchema,
  driverId: uuidSchema,
  mgmtFee: moneySchema,
  memo: memoSchema,
  adjustments: z.array(adjustmentInputSchema).max(50, "調整は 50 件までです"),
});

export type SaveDriverMonthValues = z.output<typeof saveDriverMonthSchema>;

/** クライアントから渡す形（数値は文字列のままでよい。サーバー側で正規化する） */
export interface SaveDriverMonthInput {
  month: string;
  driverId: string;
  mgmtFee: string | number;
  memo: string;
  adjustments: {
    id?: string;
    label: string;
    amount: string | number;
    countAsProfit: boolean;
    recurringId?: string | null;
  }[];
}

export const resetMgmtFeeSchema = z.object({
  month: monthSchema,
  driverId: uuidSchema,
});
