import { z } from "zod";
import { DATE_RE, emptyToNull, isDateString, memoSchema, monthSchema, moneySchema, qtySchema, unitSchema, uuidSchema } from "./common";
import type { Unit } from "@/lib/calc/types";
import type { InvoiceStatus } from "@/lib/db/types";

/**
 * 日付 "YYYY-MM-DD"（存在する日付かどうかも確認する）。
 * 請求書だけは「形が違う」と「存在しない日付」でメッセージを分けているので、
 * 共通の optionalDateSchema ではなくここで組み立てる（判定そのものは common の isDateString）。
 */
export const dateSchema = z
  .string()
  .trim()
  .regex(DATE_RE, "日付は YYYY-MM-DD 形式で入力してください")
  .refine(isDateString, "存在しない日付です");

/** 空欄・null は「未設定」（null） */
export const optionalDateSchema = z.preprocess(emptyToNull, dateSchema.nullable());

/** 請求書の作成・作り直し（RPC build_invoice） */
export interface BuildInvoiceInput {
  client_id: string;
  /** 稼動月 "YYYY-MM" */
  month: string;
}

export const buildInvoiceInputSchema = z.object({
  client_id: uuidSchema,
  month: monthSchema,
});

/** 請求書の見出し（番号・発行日・入金予定日・備考）の編集 */
export interface InvoiceFormInput {
  id: string;
  invoice_no: string;
  /** "YYYY-MM-DD" */
  issue_date: string;
  /** "YYYY-MM-DD"。空欄 = 未設定 */
  due_date: string;
  note: string;
}

export const invoiceInputSchema = z.object({
  id: uuidSchema,
  invoice_no: z.string().trim().min(1, "請求書番号を入力してください").max(50, "50 文字以内で入力してください"),
  issue_date: dateSchema,
  due_date: optionalDateSchema,
  note: memoSchema,
});

export type InvoiceInputParsed = z.output<typeof invoiceInputSchema>;

/** 請求明細の 1 行。金額は DB が 数量 × 単価 で計算するので送らない */
export interface InvoiceItemFormInput {
  /** null = 新規 */
  id: string | null;
  name: string;
  /** "" = 区分なし */
  unit: Unit | "";
  qty: string;
  unit_price: string;
}

export const invoiceItemSchema = z.object({
  id: uuidSchema.nullable(),
  name: z.string().trim().min(1, "内容を入力してください").max(200, "200 文字以内で入力してください"),
  unit: z.preprocess((v) => (v === "" || v == null ? null : v), unitSchema.nullable()),
  qty: qtySchema,
  unit_price: moneySchema,
});

export const invoiceItemsInputSchema = z.object({
  invoice_id: uuidSchema,
  items: z.array(invoiceItemSchema).max(200, "明細が多すぎます"),
});

export type InvoiceItemsInputParsed = z.output<typeof invoiceItemsInputSchema>;

/** 状態変更（RPC set_invoice_status）。入金済み以外では入金日を送らない */
export interface InvoiceStatusInput {
  id: string;
  status: InvoiceStatus;
  /** "YYYY-MM-DD"。空欄なら当日 */
  paid_on?: string | null;
}

export const invoiceStatusInputSchema = z.object({
  id: uuidSchema,
  status: z.enum(["draft", "issued", "paid"], { error: "状態を選択してください" }),
  paid_on: optionalDateSchema,
});

export type InvoiceStatusInputParsed = z.output<typeof invoiceStatusInputSchema>;
