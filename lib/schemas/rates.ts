import { z } from "zod";
import { monthSchema, uuidSchema } from "./common";
import { optionalMoneySchema } from "./drivers";

/**
 * ドライバー別単価（単価表画面）の入力
 * 受注・支払の両方が空欄 → 標準に戻す（driver_pay_overrides の行を削除）
 */
export interface RateOverrideRowInput {
  driver_id: string;
  project_item_id: string;
  /** 個別の受注単価（空欄＝案件内容の標準） */
  bill_rate: string;
  /** 個別の支払単価（空欄＝案件内容の標準） */
  pay_rate: string;
}

export const rateOverrideRowSchema = z.object({
  driver_id: uuidSchema,
  project_item_id: uuidSchema,
  bill_rate: optionalMoneySchema,
  pay_rate: optionalMoneySchema,
});

export const saveRateOverridesSchema = z.object({
  rows: z.array(rateOverrideRowSchema).min(1, "変更がありません").max(1000, "一度に保存できる件数を超えています"),
});

export type RateOverrideRowParsed = z.output<typeof rateOverrideRowSchema>;

/** 単価変更を未締め月の稼働へ反映する対象の絞り込み（すべて省略＝その月の全行） */
export interface ApplyMasterRatesInput {
  month: string;
  driver_id?: string | null;
  project_item_id?: string | null;
  entry_ids?: string[] | null;
}

export const applyMasterRatesSchema = z.object({
  month: monthSchema,
  driver_id: uuidSchema.nullable().optional(),
  project_item_id: uuidSchema.nullable().optional(),
  entry_ids: z.array(uuidSchema).max(2000, "対象が多すぎます").nullable().optional(),
});
