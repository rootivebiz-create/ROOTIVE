/**
 * ドライバー別の採算 CSV（§8.1 の共通ルール：UTF-8 BOM・CRLF・数値は rawNumber）
 * 値は v_driver_month_summary（＋ 数量は v_work_entry_calc）の値をそのまま出す。
 * 支払は税抜、税込支払額は消費税を含む実際の振込額。利益率 ＝ 会社利益 ÷ 売上。
 */
import { rawNumber } from "@/lib/format";
import { driverStateLabel, sumDriverPlRows, type DriverPlRow } from "@/components/drivers-pl/helpers";
import { toCsv, type CsvValue } from "./csv";

export const DRIVERS_PL_CSV_HEADERS = [
  "稼動月",
  "ドライバー",
  "状態",
  "稼働件数",
  "数量",
  "売上",
  "支払（税抜）",
  "単価差額利益",
  "ロイヤリティ",
  "管理費",
  "調整",
  "会社利益",
  "利益率",
  "税込支払額",
] as const;

export function driverPlToCsvRow(r: DriverPlRow): CsvValue[] {
  return [
    r.month,
    r.driverName,
    driverStateLabel(r),
    rawNumber(r.entryCount),
    rawNumber(r.qtyTotal),
    rawNumber(r.bill),
    rawNumber(r.pay),
    rawNumber(r.margin),
    rawNumber(r.royalty),
    rawNumber(r.mgmtFee),
    rawNumber(r.adjPay),
    rawNumber(r.profit),
    rawNumber(r.profitRate),
    rawNumber(r.payoutIncl),
  ];
}

/** 合計行（利益率は 合計の会社利益 ÷ 合計の売上） */
export function driversPlTotalCsvRow(rows: DriverPlRow[]): CsvValue[] {
  const t = sumDriverPlRows(rows);
  return [
    "合計",
    `${t.driverCount} 名`,
    "",
    rawNumber(t.entryCount),
    rawNumber(t.qtyTotal),
    rawNumber(t.bill),
    rawNumber(t.pay),
    rawNumber(t.margin),
    rawNumber(t.royalty),
    rawNumber(t.mgmtFee),
    rawNumber(t.adjPay),
    rawNumber(t.profit),
    rawNumber(t.profitRate),
    rawNumber(t.payoutIncl),
  ];
}

/** ヘッダー行 ＋ ドライバー行 ＋ 合計行 */
export function toDriversPlCsvRows(rows: DriverPlRow[]): CsvValue[][] {
  return [[...DRIVERS_PL_CSV_HEADERS], ...rows.map(driverPlToCsvRow), driversPlTotalCsvRow(rows)];
}

/** ドライバー別の採算 CSV（UTF-8 BOM・CRLF） */
export function toDriversPlCsv(rows: DriverPlRow[]): string {
  return toCsv(toDriversPlCsvRows(rows));
}

/** ファイル名：ドライバー別採算_2026-09.csv */
export function driversPlCsvFilename(month: string): string {
  return `ドライバー別採算_${month}.csv`;
}
