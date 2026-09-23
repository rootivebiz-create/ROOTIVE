/**
 * 年次レポート CSV（月次推移。§8.1 の共通ルール：UTF-8 BOM・CRLF・数値は rawNumber）
 * 値はすべて v_month_pl の列をそのまま出す（会社利益 − 経費 ＝ 営業利益）。
 * 「調整」は会社利益に計上される調整（adj_profit）。単価差額利益 ＋ ロイヤリティ ＋ 管理費 ＋ 調整 ＝ 会社利益。
 */
import { rawNumber } from "@/lib/format";
import { MONTH_STATUS_LABELS, sumReport, type ReportMonthRow } from "@/components/reports/helpers";
import { toCsv, type CsvValue } from "./csv";

export const REPORT_CSV_HEADERS = [
  "稼動月",
  "売上",
  "支払",
  "単価差額利益",
  "ロイヤリティ",
  "管理費",
  "調整",
  "会社利益",
  "経費（固定）",
  "経費（変動）",
  "経費合計",
  "営業利益",
  "営業利益率",
  "消費税",
  "税込支払額",
  "状態",
] as const;

export function reportToCsvRow(r: ReportMonthRow): CsvValue[] {
  return [
    r.month,
    rawNumber(r.bill),
    rawNumber(r.payout),
    rawNumber(r.margin),
    rawNumber(r.royalty),
    rawNumber(r.mgmtFee),
    rawNumber(r.adjProfit),
    rawNumber(r.profit),
    rawNumber(r.expenseFixed),
    rawNumber(r.expenseVariable),
    rawNumber(r.expenseTotal),
    rawNumber(r.operatingProfit),
    rawNumber(r.operatingMargin),
    rawNumber(r.tax),
    rawNumber(r.payoutIncl),
    r.hasData ? MONTH_STATUS_LABELS[r.status] : "",
  ];
}

/** 合計行（営業利益率は 合計の営業利益 ÷ 合計の売上） */
export function reportTotalCsvRow(rows: ReportMonthRow[]): CsvValue[] {
  const t = sumReport(rows);
  return [
    "合計",
    rawNumber(t.bill),
    rawNumber(t.payout),
    rawNumber(t.margin),
    rawNumber(t.royalty),
    rawNumber(t.mgmtFee),
    rawNumber(t.adjProfit),
    rawNumber(t.profit),
    rawNumber(t.expenseFixed),
    rawNumber(t.expenseVariable),
    rawNumber(t.expenseTotal),
    rawNumber(t.operatingProfit),
    rawNumber(t.operatingMargin),
    rawNumber(t.tax),
    rawNumber(t.payoutIncl),
    "",
  ];
}

/** 年次レポート CSV の行（ヘッダー行 ＋ 月次 ＋ 合計行） */
export function toReportCsvRows(rows: ReportMonthRow[]): CsvValue[][] {
  return [[...REPORT_CSV_HEADERS], ...rows.map(reportToCsvRow), reportTotalCsvRow(rows)];
}

/** 年次レポート CSV 文字列（UTF-8 BOM・CRLF） */
export function toReportCsv(rows: ReportMonthRow[]): string {
  return toCsv(toReportCsvRows(rows));
}

/** ファイル名：年次レポート_2026.csv */
export function reportCsvFilename(year: number | string): string {
  return `年次レポート_${year}.csv`;
}
