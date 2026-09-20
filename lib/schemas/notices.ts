import { z } from "zod";
import { memoSchema, monthSchema, moneySchema, qtySchema, uuidSchema } from "./common";
import { optionalDateSchema, optionalIdSchema } from "./expenses";
import type { NoticeStatus } from "@/lib/db/types";

/**
 * 元請の支払通知書（支払明細書）の入力スキーマ（サーバー・クライアント共用）。
 * 金額・数量はクライアントから文字列で受け取り、zod で正規化する（全角・カンマ可）。
 * 金額はすべて税抜で扱い、消費税は tax_amount に別で入れる（通知書に書かれている値をそのまま控える）。
 */

/** 支払通知書の状態 */
export const NOTICE_STATUS_VALUES: NoticeStatus[] = ["received", "checked", "resolved"];

/** 1 件の通知に取り込める明細の上限 */
export const MAX_NOTICE_ITEMS = 500;

/** 貼り付けできるテキストの上限（1MB） */
export const MAX_NOTICE_TEXT_LENGTH = 1_000_000;

/** CSV ファイルの上限（2MB） */
export const MAX_NOTICE_CSV_BYTES = 2 * 1024 * 1024;

/** <input type="file"> の accept */
export const NOTICE_CSV_ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

/** 画面に出す「読み込めるファイル」の案内 */
export const NOTICE_CSV_SUPPORT_TEXT =
  "読み込めるファイル：CSV（.csv）・TSV（.tsv / .txt）。文字コードは UTF-8 と Shift_JIS を自動で判定します。Excel（.xlsx）と PDF は読み込めないので、Excel なら「CSV UTF-8（コンマ区切り）」で保存し直すか、表をコピーして「貼り付け」タブに貼ってください。";

/** 通知番号（元請の書類番号。空欄可） */
export const noticeNoSchema = z.string().trim().max(50, "50 文字以内で入力してください").default("");

/** 元請の表記（明細の内容） */
export const rawNameSchema = z.string().trim().min(1, "内容を入力してください").max(200, "200 文字以内で入力してください");

// ---------------------------------------------------------------------------
// 支払通知書（見出し）
// ---------------------------------------------------------------------------

/** 支払通知書の登録・編集 */
export interface NoticeFormInput {
  /** null = 新規 */
  id: string | null;
  /** "" = 取引先を指定しない */
  client_id: string;
  /** 稼動月 "YYYY-MM" */
  month: string;
  notice_no: string;
  /** "YYYY-MM-DD"。空欄 = 未設定 */
  received_on: string;
  /** 通知書に書かれている支払額（税抜） */
  total_amount: string;
  /** 通知書に書かれている消費税 */
  tax_amount: string;
  memo: string;
}

export const noticeInputSchema = z.object({
  id: optionalIdSchema,
  client_id: optionalIdSchema,
  month: monthSchema,
  notice_no: noticeNoSchema,
  received_on: optionalDateSchema,
  total_amount: moneySchema,
  tax_amount: moneySchema,
  memo: memoSchema,
});
export type NoticeInputValues = z.output<typeof noticeInputSchema>;

/** 状態の変更 */
export interface NoticeStatusInput {
  id: string;
  status: NoticeStatus;
}

export const noticeStatusSchema = z.object({
  id: uuidSchema,
  status: z.enum(["received", "checked", "resolved"], { error: "状態を選択してください" }),
});

export const deleteNoticeSchema = z.object({ id: uuidSchema });

// ---------------------------------------------------------------------------
// 明細
// ---------------------------------------------------------------------------

/** 明細 1 行の編集（金額が 0 のときは DB のトリガーが 数量 × 単価 で埋める） */
export interface NoticeItemFormInput {
  /** null = 新規 */
  id: string | null;
  notice_id: string;
  /** "" = 未紐づけ */
  project_item_id: string;
  raw_name: string;
  qty: string;
  unit_price: string;
  amount: string;
  memo: string;
}

export const noticeItemSchema = z.object({
  id: optionalIdSchema,
  notice_id: uuidSchema,
  project_item_id: optionalIdSchema,
  raw_name: rawNameSchema,
  qty: qtySchema,
  unit_price: moneySchema,
  amount: moneySchema,
  memo: memoSchema,
});
export type NoticeItemValues = z.output<typeof noticeItemSchema>;

export const deleteNoticeItemSchema = z.object({ id: uuidSchema });

export const matchNoticeItemsSchema = z.object({ notice_id: uuidSchema });

/** 取り込みの方法 */
export const NOTICE_IMPORT_MODES = ["replace", "append"] as const;
export type NoticeImportMode = (typeof NOTICE_IMPORT_MODES)[number];

export const NOTICE_IMPORT_MODE_LABELS: Record<NoticeImportMode, string> = {
  replace: "既存の明細を置き換える",
  append: "今ある明細に追加する",
};

/** CSV から読み取った 1 行（プレビューで確定した内容） */
export const noticeImportRowSchema = z.object({
  raw_name: rawNameSchema,
  qty: qtySchema,
  unit_price: moneySchema,
  amount: moneySchema,
});
export type NoticeImportRowValues = z.output<typeof noticeImportRowSchema>;

/** 明細のまとめて取り込み */
export interface ImportNoticeItemsInput {
  notice_id: string;
  mode: NoticeImportMode;
  rows: { raw_name: string; qty: number; unit_price: number; amount: number }[];
}

export const importNoticeItemsSchema = z.object({
  notice_id: uuidSchema,
  mode: z.enum(NOTICE_IMPORT_MODES, { error: "取り込みの方法を選択してください" }).default("replace"),
  rows: z
    .array(noticeImportRowSchema)
    .min(1, "取り込む明細がありません")
    .max(MAX_NOTICE_ITEMS, `1 回に取り込めるのは ${MAX_NOTICE_ITEMS} 行までです`),
});
export type ImportNoticeItemsValues = z.output<typeof importNoticeItemsSchema>;
