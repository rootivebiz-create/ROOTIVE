import { z } from "zod";
import { memoSchema, moneySchema, monthSchema, percentToRateSchema, qtySchema, roundingModeSchema, uuidSchema } from "./common";

/**
 * 稼働行の入力（フォーム値は文字列で受け取り、zod で正規化する）
 * royalty_percent はパーセント表記（"10", "12.5"）で受け取り、率（0.1）へ変換して royalty_rate として保存する。
 */
export const entryInputSchema = z.object({
  month: monthSchema,
  driver_id: uuidSchema,
  project_item_id: uuidSchema,
  qty: qtySchema,
  bill_rate: moneySchema,
  pay_rate: moneySchema,
  royalty_percent: percentToRateSchema,
  rounding_mode: roundingModeSchema,
  memo: memoSchema,
});

/** クライアントから渡す形（文字列のまま） */
export type EntryInput = z.input<typeof entryInputSchema>;
/** 検証後の値 */
export type EntryValues = z.output<typeof entryInputSchema>;

/** 一括入力の数量：空欄は 0（＝削除）として扱う */
export const bulkQtySchema = z.preprocess((v) => (v == null || (typeof v === "string" && v.trim() === "") ? 0 : v), qtySchema);

export const bulkRowSchema = z.object({
  driver_id: uuidSchema,
  qty: bulkQtySchema,
});

export const bulkSetEntriesSchema = z.object({
  month: monthSchema,
  project_item_id: uuidSchema,
  rows: z.array(bulkRowSchema).max(1000, "行数が多すぎます"),
});

export type BulkRowInput = z.input<typeof bulkRowSchema>;
export type BulkSetEntriesInput = z.input<typeof bulkSetEntriesSchema>;
export type BulkSetEntriesValues = z.output<typeof bulkSetEntriesSchema>;

/** bulk_set_entries RPC の戻り値 */
export interface BulkSetEntriesResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * まとめて数量だけ入れる（声で入力・その場入力）
 * 単価・率・端数処理は DB 側（entry_defaults）が現在のマスタから決める。
 * 既存の行があれば数量だけを更新し、単価のスナップショットは変えない。
 */
export const quickRowSchema = z.object({
  driver_id: uuidSchema,
  project_item_id: uuidSchema,
  qty: qtySchema,
});

export const quickSetEntriesSchema = z.object({
  month: monthSchema,
  rows: z.array(quickRowSchema).min(1, "保存する行がありません").max(200, "行数が多すぎます"),
});

export type QuickRowInput = z.input<typeof quickRowSchema>;
export type QuickSetEntriesInput = z.input<typeof quickSetEntriesSchema>;
