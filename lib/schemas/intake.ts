import { z } from "zod";
import { memoSchema, monthSchema, qtySchema, signedMoneySchema, uuidSchema } from "./common";
import { categoryIdSchema, expenseLabelSchema, optionalDateSchema, optionalIdSchema, taxModeSchema, vendorSchema } from "./expenses";

/**
 * レシートからの経費登録と、元請の実績ファイルの取り込みの入力スキーマ（サーバー・クライアント共用）。
 * 金額・日付は文字列でも受け取り、zod で正規化する（全角・カンマ可）。
 */

// ---------------------------------------------------------------------------
// レシート
// ---------------------------------------------------------------------------

/** レシート画像の上限（5MB） */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** <input type="file"> の accept（スマホのカメラから直接撮れるようにする） */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/*";

/** 受け付ける画像の案内（画面に出す） */
export const RECEIPT_SUPPORT_TEXT = "JPEG・PNG・WebP・HEIC の画像（5MB まで）。スマホのカメラでそのまま撮れます。";

/** Storage（receipts）のパス */
export const receiptPathSchema = z
  .string()
  .trim()
  .min(1, "画像のパスが空です")
  .max(300, "画像のパスが長すぎます")
  .refine((p) => !p.includes("..") && !p.startsWith("/"), "画像のパスが不正です");

/** AI が読み取った内容（expenses.ocr にそのまま保存する） */
export const receiptOcrSchema = z.object({
  amount: z.number().nullable(),
  incurred_on: z.string().max(10).nullable(),
  vendor: z.string().max(200),
  category_id: z.string().max(100).nullable(),
  label: z.string().max(200),
  tax_included: z.boolean().nullable(),
  confidence: z.number().min(0).max(1),
  model: z.string().max(100).default(""),
  read_at: z.string().max(40).default(""),
});
export type ReceiptOcr = z.output<typeof receiptOcrSchema>;

/** 確認フォームの入力（クライアント → Server Action） */
export interface ReceiptExpenseInput {
  /** 稼動月 "YYYY-MM" */
  month: string;
  category_id: string;
  label: string;
  /** 入力された金額（tax_included が true なら税込） */
  amount: string;
  /** 金額が税込か（true なら税抜に直して保存する） */
  tax_included: boolean;
  tax_mode: string;
  /** "" = 指定なし */
  incurred_on: string;
  vendor: string;
  memo: string;
  /** Storage のパス（readReceiptAction が返した値） */
  receipt_path: string;
  /** AI の読み取り結果（無ければ null） */
  ocr: ReceiptOcr | null;
}

export const receiptExpenseSchema = z.object({
  month: monthSchema,
  category_id: categoryIdSchema,
  label: expenseLabelSchema,
  amount: signedMoneySchema,
  tax_included: z.boolean(),
  tax_mode: taxModeSchema,
  incurred_on: optionalDateSchema,
  vendor: vendorSchema,
  memo: memoSchema,
  receipt_path: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), receiptPathSchema.nullable()),
  ocr: receiptOcrSchema.nullable().default(null),
});
export type ReceiptExpenseValues = z.output<typeof receiptExpenseSchema>;

/** レシート画像の削除 */
export const deleteReceiptSchema = z.object({ path: receiptPathSchema });

// ---------------------------------------------------------------------------
// 元請の実績ファイル
// ---------------------------------------------------------------------------

/** 実績ファイルの上限（5MB） */
export const MAX_SHEET_BYTES = 5 * 1024 * 1024;

/** 読み込める拡張子（CSV / TSV のみ） */
export const SHEET_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;

/** <input type="file"> の accept */
export const SHEET_ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

/** 画面に出す「対応しているファイル」の案内（lib/intake/sheet.ts と共用） */
export const SHEET_SUPPORT_TEXT =
  "対応しているファイル：CSV（.csv）・TSV（.tsv / .txt）。文字コードは UTF-8 と Shift_JIS を自動で判定します。Excel（.xlsx）と PDF には対応していないので、Excel で「CSV UTF-8（コンマ区切り）」として保存し直してから選んでください。";

/** 1 回に取り込める行数の上限 */
export const MAX_IMPORT_ROWS = 2000;

/** 取り込み定義の名前 */
export const profileNameSchema = z.string().trim().min(1, "取り込み定義の名前を入力してください").max(80, "80 文字以内で入力してください");

/** 列の対応（値は元請ファイルのヘッダー名。"" は未対応） */
const mappingValueSchema = z.string().trim().max(100, "列名が長すぎます").default("");

export const sheetMappingSchema = z.object({
  date: mappingValueSchema,
  driver: mappingValueSchema,
  project: mappingValueSchema,
  item: mappingValueSchema,
  qty: mappingValueSchema,
});

/** 元請の表記 → uuid の対応表 */
export const matchMapSchema = z.record(z.string().trim().min(1).max(200), uuidSchema);

export const headerRowSchema = z.number().int().min(0, "ヘッダー行が不正です").max(50, "ヘッダー行が不正です");

/** 取り込む 1 行（プレビューで確定した内容） */
export const importRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付が不正です"),
  driver_id: uuidSchema,
  item_id: uuidSchema,
  qty: qtySchema,
});
export type ImportRowValues = z.output<typeof importRowSchema>;

/** 取り込みの実行 */
export const runImportSchema = z.object({
  profile_id: optionalIdSchema,
  /** 取り込み定義として保存する名前（"" なら保存しない） */
  profile_name: z.string().trim().max(80).default(""),
  month: monthSchema,
  file_name: z.string().trim().max(200).default(""),
  header_row: headerRowSchema,
  mapping: sheetMappingSchema,
  driver_match: matchMapSchema.default({}),
  item_match: matchMapSchema.default({}),
  rows: z.array(importRowSchema).min(1, "取り込む行がありません").max(MAX_IMPORT_ROWS, `1 回に取り込めるのは ${MAX_IMPORT_ROWS} 行までです`),
  /** 取り込まなかった行数 */
  skipped: z.number().int().min(0).max(100_000).default(0),
  /** 対応が付かなかった名前（履歴に残す） */
  unmatched: z.array(z.string().max(200)).max(200).default([]),
  client_id: optionalIdSchema,
  project_id: optionalIdSchema,
});
export type RunImportInput = z.input<typeof runImportSchema>;
export type RunImportValues = z.output<typeof runImportSchema>;

/** 取り込み定義の保存 */
export const saveImportProfileSchema = z.object({
  id: optionalIdSchema,
  name: profileNameSchema,
  client_id: optionalIdSchema,
  project_id: optionalIdSchema,
  mapping: sheetMappingSchema,
  header_row: headerRowSchema.default(0),
  memo: memoSchema,
  is_active: z.boolean().default(true),
});
export type SaveImportProfileInput = z.input<typeof saveImportProfileSchema>;

export const deleteImportProfileSchema = z.object({ id: uuidSchema });
