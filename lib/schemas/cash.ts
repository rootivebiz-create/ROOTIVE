import { z } from "zod";
import { memoSchema, signedMoneySchema, uuidSchema } from "./common";
import { isDateString } from "./expenses";

/**
 * 資金繰りの入力スキーマ（サーバー・クライアント共用）
 * 現金残高は手入力の実残高なので、マイナス（当座借越など）も許容する（signedMoneySchema）。
 * 金額は全角・カンマ・¥ 付きでも受け付ける（parseNumberInput）。
 */

/** 日付 "YYYY-MM-DD"（実在する日付のみ） */
export const cashDateSchema = z.string().refine(isDateString, "日付は YYYY-MM-DD 形式で入力してください");

/** 残高の登録（クライアント → Server Action。金額は文字列のままでよい） */
export interface SaveCashSnapshotInput {
  /** 残高の基準日 "YYYY-MM-DD" */
  as_of: string;
  /** 現金残高（マイナス可） */
  balance: string | number;
  memo: string;
}

export const saveCashSnapshotSchema = z.object({
  as_of: cashDateSchema,
  balance: signedMoneySchema,
  memo: memoSchema,
});

export type SaveCashSnapshotValues = z.output<typeof saveCashSnapshotSchema>;

/** 残高の削除 */
export const deleteCashSnapshotSchema = z.object({ id: uuidSchema });

/** 期間（?from= / ?to=）。to は from 以降 */
export const cashRangeSchema = z
  .object({ from: cashDateSchema, to: cashDateSchema })
  .refine((v) => v.from <= v.to, { message: "終了日は開始日と同じか後の日にしてください", path: ["to"] });

export type CashRangeValues = z.output<typeof cashRangeSchema>;
