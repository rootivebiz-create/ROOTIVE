import { z } from "zod";
import { memoSchema, moneySchema, nameSchema, percentToRateSchema, unitSchema, uuidSchema } from "./common";
import type { Unit } from "@/lib/calc/types";

/**
 * 案件・単価フォームの入力（クライアント → Server Action）。
 * 単価は文字列で受け取り、zod で正規化する。
 */
export interface ProjectFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  /** 取引先（clients.id）。"" / null = 未設定。projects.client_name は DB トリガーが同期する */
  client_id: string | null;
  is_active: boolean;
  memo: string;
  /** 目標利益率（パーセント表記の文字列。"" / null = 判定しない） */
  target_margin: string | null;
  /** 内容の行。id が null なら新規。送られてこなかった既存 id は削除 */
  items: ProjectItemFormInput[];
}

export interface ProjectItemFormInput {
  id: string | null;
  /** 空欄なら「標準」 */
  name: string;
  unit: Unit;
  bill_rate: string;
  pay_rate: string;
  is_active: boolean;
}

export const DEFAULT_ITEM_NAME = "標準";

export const projectItemSchema = z.object({
  id: uuidSchema.nullable(),
  name: z
    .string()
    .trim()
    .max(100, "100 文字以内で入力してください")
    .transform((s) => (s === "" ? DEFAULT_ITEM_NAME : s)),
  unit: unitSchema,
  bill_rate: moneySchema,
  pay_rate: moneySchema,
  is_active: z.boolean(),
});

export const projectInputSchema = z
  .object({
    id: uuidSchema.nullable(),
    name: nameSchema,
    client_id: z.preprocess((v) => (v === "" || v == null ? null : v), uuidSchema.nullable()),
    is_active: z.boolean(),
    memo: memoSchema,
    // 目標利益率：空欄・未入力は null（判定しない）。入力はパーセント、値は率（0.2 = 20%）
    target_margin: z.preprocess((v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v), percentToRateSchema.nullable()),
    items: z.array(projectItemSchema).min(1, "内容を 1 件以上登録してください").max(100, "内容が多すぎます"),
  })
  .superRefine((val, ctx) => {
    const seen = new Map<string, number>();
    val.items.forEach((item, i) => {
      const prev = seen.get(item.name);
      if (prev != null) {
        ctx.addIssue({ code: "custom", message: `内容名「${item.name}」が重複しています`, path: ["items", i, "name"] });
      } else {
        seen.set(item.name, i);
      }
    });
  });

export type ProjectInputParsed = z.output<typeof projectInputSchema>;
