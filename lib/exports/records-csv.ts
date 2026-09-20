/**
 * 書類の索引簿 CSV（電子帳簿保存法の検索要件を紙でも示せるようにする）
 * 列：取引年月日・種類・取引先・件名・取引金額・電子データ・稼動月・メモ
 */
import { toCsv, type CsvValue } from "@/lib/exports/csv";
import { rawNumber } from "@/lib/format";
import { RECORD_KIND_LABELS, type RecordDoc } from "@/lib/records";

export const RECORDS_CSV_HEADERS = ["取引年月日", "種類", "取引先", "件名", "取引金額", "電子データ", "稼動月", "メモ"] as const;

export function recordToCsvRow(d: RecordDoc): CsvValue[] {
  return [
    d.date ?? "",
    RECORD_KIND_LABELS[d.kind],
    d.counterparty,
    d.title,
    d.amount == null ? "" : rawNumber(d.amount),
    d.hasFile ? "あり" : "なし",
    d.month ?? "",
    d.memo,
  ];
}

export function recordsCsvRows(docs: RecordDoc[]): CsvValue[][] {
  return [[...RECORDS_CSV_HEADERS], ...docs.map(recordToCsvRow)];
}

export function recordsToCsv(docs: RecordDoc[]): string {
  return toCsv(recordsCsvRows(docs));
}

export function recordsCsvFilename(from?: string, to?: string): string {
  const range = from || to ? `_${from || "開始"}〜${to || "終了"}` : "";
  return `書類の索引簿${range}.csv`;
}
