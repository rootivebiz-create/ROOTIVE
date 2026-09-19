/**
 * 資金繰り CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * 金額は税込（入金予定・ドライバーへの支払・経費）。残高はその日の終わりの残高。
 */
import { rawNumber } from "@/lib/format";
import type { CashflowCsvRow } from "@/components/cashflow/helpers";
import { toCsv, type CsvValue } from "./csv";

export const CASHFLOW_CSV_HEADERS = ["日付", "種別", "相手先", "内容", "入金", "支払", "残高", "状態", "稼動月"] as const;

export function cashflowToCsvRow(r: CashflowCsvRow): CsvValue[] {
  return [r.date, r.kindLabel, r.label, r.detail, rawNumber(r.inflow), rawNumber(r.outflow), rawNumber(r.balance), r.statusLabel, r.month];
}

/** 資金繰り CSV（ヘッダー行付き） */
export function toCashflowCsv(rows: CashflowCsvRow[]): string {
  return toCsv([[...CASHFLOW_CSV_HEADERS], ...rows.map(cashflowToCsvRow)]);
}

/** ファイル名："資金繰り_2026-09-18_2026-12-17.csv" */
export function cashflowCsvFilename(from: string, to: string): string {
  return `資金繰り_${from}_${to}.csv`;
}

/** 資金繰りの行配列（先頭が見出し行。Excel 出力と共用） */
export function cashflowCsvRows(rows: CashflowCsvRow[]): CsvValue[][] {
  return [[...CASHFLOW_CSV_HEADERS], ...rows.map(cashflowToCsvRow)];
}
