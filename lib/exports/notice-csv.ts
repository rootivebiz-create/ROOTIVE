/**
 * 支払通知の突合 CSV（§8.1 の書式に合わせる：UTF-8 BOM・CRLF・数値は生の値）
 * 差は DB のビュー（v_payment_notice_diff）が計算した値をそのまま出し、説明だけ lib/notices/diff.ts で付ける。
 */
import type { PaymentNoticeDiffRow, PaymentNoticeRow } from "@/lib/db/types";
import { NOTICE_DIFF_LABELS } from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { dateToMonth } from "@/lib/month";
import { explainDiff } from "@/lib/notices/diff";
import { toCsv, type CsvValue } from "./csv";

export const NOTICE_DIFF_CSV_HEADERS = [
  "稼動月",
  "通知番号",
  "取引先",
  "通知の内容",
  "案件",
  "案件内容",
  "通知の数量",
  "通知の単価",
  "通知の金額",
  "自社の数量",
  "自社の単価",
  "自社の金額",
  "数量の差",
  "金額の差",
  "判定",
  "説明",
] as const;

/** v_payment_notice_diff のうち CSV に必要な列 */
export type NoticeDiffCsvSource = Pick<
  PaymentNoticeDiffRow,
  | "month"
  | "client_name"
  | "raw_name"
  | "project_name"
  | "item_name"
  | "notice_qty"
  | "notice_unit_price"
  | "notice_amount"
  | "our_qty"
  | "our_amount"
  | "our_unit_price"
  | "qty_diff"
  | "amount_diff"
  | "diff_status"
>;

/** 見出しに入れる通知書の情報 */
export type NoticeCsvHeaderSource = Pick<PaymentNoticeRow, "notice_no" | "client_name" | "month">;

export function noticeDiffToCsvRow(notice: NoticeCsvHeaderSource, r: NoticeDiffCsvSource): CsvValue[] {
  const month = r.month ?? notice.month ?? "";
  return [
    month ? dateToMonth(month) : "",
    notice.notice_no ?? "",
    r.client_name ?? notice.client_name ?? "",
    r.raw_name ?? "",
    r.project_name ?? "",
    r.item_name ?? "",
    rawNumber(r.notice_qty),
    rawNumber(r.notice_unit_price),
    rawNumber(r.notice_amount),
    rawNumber(r.our_qty),
    rawNumber(r.our_unit_price),
    rawNumber(r.our_amount),
    rawNumber(r.qty_diff),
    rawNumber(r.amount_diff),
    r.diff_status ? (NOTICE_DIFF_LABELS[r.diff_status] ?? r.diff_status) : "",
    explainDiff(r),
  ];
}

/** 突合 CSV の行配列（先頭が見出し行） */
export function noticeDiffCsvRows(notice: NoticeCsvHeaderSource, rows: NoticeDiffCsvSource[]): CsvValue[][] {
  return [[...NOTICE_DIFF_CSV_HEADERS], ...rows.map((r) => noticeDiffToCsvRow(notice, r))];
}

/** 突合 CSV（ヘッダー行付き） */
export function noticeDiffToCsv(notice: NoticeCsvHeaderSource, rows: NoticeDiffCsvSource[]): string {
  return toCsv(noticeDiffCsvRows(notice, rows));
}

/** ファイル名（例: 支払通知突合_2026-09_ヤマト運輸.csv） */
export function noticeDiffCsvFilename(notice: NoticeCsvHeaderSource): string {
  const month = notice.month ? dateToMonth(notice.month) : "";
  const parts = ["支払通知突合", month, notice.client_name || "", notice.notice_no || ""].filter((p) => p !== "");
  return `${parts.join("_")}.csv`;
}
