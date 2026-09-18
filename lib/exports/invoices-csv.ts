/**
 * 請求書一覧 CSV（§8.1 の書式に合わせる：UTF-8 BOM・CRLF・数値は生の値）
 * 金額は DB が計算した値（v_invoice_list）をそのまま出す。
 */
import type { InvoiceListRow } from "@/lib/db/types";
import { INVOICE_STATUS_LABELS } from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { dateToMonth } from "@/lib/month";
import { toCsv, type CsvValue } from "./csv";

export const INVOICES_CSV_HEADERS = ["稼動月", "請求書番号", "取引先", "状態", "発行日", "入金予定日", "小計", "消費税", "合計", "入金日", "備考"] as const;

/** v_invoice_list のうち CSV に必要な列 */
export type InvoiceCsvSource = Pick<
  InvoiceListRow,
  "month" | "invoice_no" | "client_name" | "status" | "issue_date" | "due_date" | "subtotal" | "tax" | "total" | "paid_on" | "note"
>;

export function invoiceToCsvRow(r: InvoiceCsvSource): CsvValue[] {
  return [
    r.month ? dateToMonth(r.month) : "",
    r.invoice_no ?? "",
    r.client_name ?? "",
    r.status ? INVOICE_STATUS_LABELS[r.status] : "",
    r.issue_date ?? "",
    r.due_date ?? "",
    rawNumber(r.subtotal),
    rawNumber(r.tax),
    rawNumber(r.total),
    r.paid_on ?? "",
    r.note ?? "",
  ];
}

/** 請求書一覧 CSV（ヘッダー行付き） */
export function invoicesToCsv(rows: InvoiceCsvSource[]): string {
  return toCsv([[...INVOICES_CSV_HEADERS], ...rows.map(invoiceToCsvRow)]);
}
