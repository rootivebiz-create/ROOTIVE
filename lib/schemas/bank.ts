import { z } from "zod";
import { uuidSchema } from "./common";
import type { BankTxnStatus } from "@/lib/db/types";

/**
 * 銀行 CSV の取り込み・入金消込の入力スキーマ（サーバー・クライアント共用）
 * 消込そのものは DB の RPC（bank_match_invoice / bank_set_status）が行うので、
 * ここでは ID と状態の形だけを検証する。
 */

/** アップロードできる CSV の上限（2MB） */
export const MAX_BANK_CSV_BYTES = 2 * 1024 * 1024;

/** 受け付ける拡張子 */
export const BANK_CSV_EXTENSIONS = [".csv", ".txt"] as const;

/** 受け付ける拡張子か（大文字小文字は区別しない） */
export function isBankCsvFileName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return BANK_CSV_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 一覧の絞り込み（?status=）。"all" はすべて */
export const BANK_STATUS_FILTERS = ["unmatched", "matched", "ignored", "all"] as const;
export type BankStatusFilter = (typeof BANK_STATUS_FILTERS)[number];

export const bankStatusFilterSchema = z.enum(BANK_STATUS_FILTERS);

/** URL の ?status= を読む（不正・未指定は "unmatched"） */
export function bankStatusFromParam(param: string | string[] | undefined): BankStatusFilter {
  const raw = Array.isArray(param) ? param[0] : param;
  const parsed = bankStatusFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : "unmatched";
}

/** 手で設定できる状態（消込は bank_match_invoice を使うので 'matched' は含めない） */
export const BANK_SETTABLE_STATUSES = ["unmatched", "ignored"] as const satisfies readonly BankTxnStatus[];

export const bankSettableStatusSchema = z.enum(BANK_SETTABLE_STATUSES, { error: "状態が不正です" });

/** 請求書への消し込み */
export const matchBankTxnSchema = z.object({
  txn_id: uuidSchema,
  invoice_id: uuidSchema,
});
export type MatchBankTxnValues = z.output<typeof matchBankTxnSchema>;

/** 消込を外す・対象外にする */
export const setBankTxnStatusSchema = z.object({
  txn_id: uuidSchema,
  status: bankSettableStatusSchema,
});
export type SetBankTxnStatusValues = z.output<typeof setBankTxnStatusSchema>;

/** 取り込み履歴の削除 */
export const deleteBankImportSchema = z.object({ id: uuidSchema });

/** アップロードされたファイルの検証（ファイル名・サイズ）。エラーメッセージは日本語 */
export const bankCsvFileSchema = z.object({
  name: z.string().trim().min(1, "ファイル名が空です").refine(isBankCsvFileName, "CSV ファイル（.csv / .txt）を選んでください"),
  size: z
    .number()
    .positive("ファイルが空です")
    .max(MAX_BANK_CSV_BYTES, `CSV は ${MAX_BANK_CSV_BYTES / 1024 / 1024}MB 以下にしてください`),
});
