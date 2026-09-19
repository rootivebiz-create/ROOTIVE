/**
 * 銀行明細 CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * 金額は銀行の明細そのまま（入金・出金に分けて出す）。消込先の請求書番号・取引先も付ける。
 */
import { BANK_TXN_STATUS_LABELS, type BankTransactionRow } from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { toCsv, type CsvValue } from "./csv";

export const BANK_CSV_HEADERS = ["日付", "摘要", "入金", "出金", "残高", "状態", "自動", "請求書番号", "取引先", "取り込みファイル", "備考"] as const;

/** v_bank_transaction_list のうち CSV に必要な列 */
export type BankCsvSource = Pick<
  BankTransactionRow,
  "txn_date" | "description" | "amount" | "balance" | "status" | "auto_matched" | "invoice_no" | "client_name" | "import_file_name" | "memo"
>;

export function bankCsvRow(t: BankCsvSource): CsvValue[] {
  const amount = Number(t.amount ?? 0);
  return [
    t.txn_date ?? "",
    t.description ?? "",
    rawNumber(amount > 0 ? amount : 0),
    rawNumber(amount < 0 ? -amount : 0),
    t.balance == null ? "" : rawNumber(t.balance),
    t.status ? BANK_TXN_STATUS_LABELS[t.status] : "",
    t.auto_matched ? "自動" : "",
    t.invoice_no ?? "",
    t.client_name ?? "",
    t.import_file_name ?? "",
    t.memo ?? "",
  ];
}

/** 銀行明細 CSV（ヘッダー行付き） */
export function bankCsv(rows: BankCsvSource[]): string {
  return toCsv([[...BANK_CSV_HEADERS], ...rows.map(bankCsvRow)]);
}

/** 絞り込みごとのファイル名の見出し */
export const BANK_CSV_STATUS_LABELS: Record<string, string> = {
  unmatched: "未消込",
  matched: "消込済み",
  ignored: "対象外",
  all: "すべて",
};

/** ファイル名："銀行明細_未消込.csv" */
export function bankCsvFilename(status: string): string {
  return `銀行明細_${BANK_CSV_STATUS_LABELS[status] ?? "すべて"}.csv`;
}
