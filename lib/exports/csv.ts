/**
 * CSV 出力の共通処理（§8.1）
 * - UTF-8 BOM 付き・CRLF・ダブルクォートのエスケープ（Excel でそのまま開ける）
 * - 数値は rawNumber()（生の値、カンマ無し）。率は 0.1 のような率のまま出す
 */
import type { WorkEntryCalc, DriverMonthSummary } from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { dateToMonth } from "@/lib/month";
import { UNIT_LABELS } from "@/lib/calc/types";

export type CsvValue = string | number | null | undefined;

/** UTF-8 BOM（Excel が文字コードを正しく判定するため） */
export const CSV_BOM = "﻿";

/** 1 セルを CSV 用にエスケープする（カンマ・ダブルクォート・改行を含む場合のみ引用符で囲む） */
export function csvCell(value: CsvValue): string {
  if (value == null) return "";
  const s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 2 次元配列 → CSV 文字列（先頭 BOM、行区切り CRLF、末尾にも CRLF） */
export function toCsv(rows: CsvValue[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// 稼働明細 CSV
// ---------------------------------------------------------------------------

export const ENTRIES_CSV_HEADERS = [
  "稼動月",
  "ドライバー",
  "案件",
  "内容",
  "区分",
  "数量",
  "受注単価",
  "支払単価",
  "会社売上",
  "ドライバー売上",
  "単価差額利益",
  "ロイヤリティ率",
  "ロイヤリティ額",
  "行の利益",
  "備考",
] as const;

/** v_work_entry_calc のうち CSV に必要な列 */
export type EntryCsvSource = Pick<
  WorkEntryCalc,
  | "month"
  | "driver_name"
  | "project_name"
  | "item_name"
  | "unit"
  | "qty"
  | "bill_rate"
  | "pay_rate"
  | "bill"
  | "pay"
  | "margin"
  | "royalty_rate"
  | "royalty"
  | "entry_profit"
  | "memo"
>;

export function entryToCsvRow(e: EntryCsvSource): CsvValue[] {
  return [
    e.month ? dateToMonth(e.month) : "",
    e.driver_name ?? "",
    e.project_name ?? "",
    e.item_name ?? "",
    e.unit ? UNIT_LABELS[e.unit] : "",
    rawNumber(e.qty),
    rawNumber(e.bill_rate),
    rawNumber(e.pay_rate),
    rawNumber(e.bill),
    rawNumber(e.pay),
    rawNumber(e.margin),
    rawNumber(e.royalty_rate),
    rawNumber(e.royalty),
    rawNumber(e.entry_profit),
    e.memo ?? "",
  ];
}

/** 稼働明細 CSV（ヘッダー行付き） */
export function entriesToCsv(rows: EntryCsvSource[]): string {
  return toCsv([[...ENTRIES_CSV_HEADERS], ...rows.map(entryToCsvRow)]);
}

// ---------------------------------------------------------------------------
// 支払一覧 CSV
// ---------------------------------------------------------------------------

/** 支払額は税抜、消費税・税込支払額は v_driver_month_summary の tax / payout_incl（実際の振込額は税込支払額） */
export const PAYOUTS_CSV_HEADERS = ["稼動月", "ドライバー", "会社売上", "ドライバー売上", "単価差額利益", "ロイヤリティ", "管理費", "調整", "支払額", "消費税", "税込支払額", "会社利益"] as const;

/** v_driver_month_summary のうち CSV に必要な列 */
export type PayoutCsvSource = Pick<DriverMonthSummary, "month" | "driver_name" | "bill" | "pay" | "margin" | "royalty" | "mgmt_fee" | "adj_pay" | "payout" | "tax" | "payout_incl" | "driver_profit">;

export function payoutToCsvRow(r: PayoutCsvSource): CsvValue[] {
  return [
    r.month ? dateToMonth(r.month) : "",
    r.driver_name ?? "",
    rawNumber(r.bill),
    rawNumber(r.pay),
    rawNumber(r.margin),
    rawNumber(r.royalty),
    rawNumber(r.mgmt_fee),
    rawNumber(r.adj_pay),
    rawNumber(r.payout),
    rawNumber(r.tax),
    rawNumber(r.payout_incl),
    rawNumber(r.driver_profit),
  ];
}

/** 支払一覧 CSV（ヘッダー行付き） */
export function payoutsToCsv(rows: PayoutCsvSource[]): string {
  return toCsv([[...PAYOUTS_CSV_HEADERS], ...rows.map(payoutToCsvRow)]);
}

/** ファイル名の月部分："2026-09" または "全期間" */
export function monthFileLabel(month: string): string {
  return month === "all" ? "全期間" : month;
}
