/**
 * 入金消込の画面で使う純関数（React に依存しない。画面・CSV 出力・テストから使う）
 * 合計は lib/calc の sumMoney、金額の向きは「入金 ＋ / 出金 −」で統一する。
 */
import { sumMoney } from "@/lib/calc";
import { dateToMonth } from "@/lib/month";
import type { BankImport, BankTransactionRow, BankTxnStatus, InvoiceListRow } from "@/lib/db/types";
import type { InvoiceCandidate } from "@/lib/bank";
import type { BankStatusFilter } from "@/lib/schemas/bank";

/** 一覧の 1 行（画面用に必要な形だけに整える） */
export interface BankTxnRow {
  id: string;
  txnDate: string;
  description: string;
  /** 入金は ＋、出金は − */
  amount: number;
  balance: number | null;
  status: BankTxnStatus;
  autoMatched: boolean;
  memo: string;
  invoiceId: string | null;
  invoiceNo: string;
  invoiceTotal: number;
  clientName: string;
  expenseLabel: string;
  importFileName: string;
}

/** v_bank_transaction_list の 1 行 → 画面用 */
export function toTxnRow(row: BankTransactionRow): BankTxnRow {
  return {
    id: row.id ?? "",
    txnDate: row.txn_date ?? "",
    description: row.description ?? "",
    amount: Number(row.amount ?? 0),
    balance: row.balance == null ? null : Number(row.balance),
    status: row.status ?? "unmatched",
    autoMatched: row.auto_matched ?? false,
    memo: row.memo ?? "",
    invoiceId: row.invoice_id ?? null,
    invoiceNo: row.invoice_no ?? "",
    invoiceTotal: Number(row.invoice_total ?? 0),
    clientName: row.client_name ?? "",
    expenseLabel: row.expense_label ?? "",
    importFileName: row.import_file_name ?? "",
  };
}

/** v_invoice_list の 1 行 → 消し込み先の候補 */
export function toInvoiceCandidate(row: InvoiceListRow): InvoiceCandidate {
  return {
    id: row.id ?? "",
    invoiceNo: row.invoice_no ?? "",
    clientName: row.client_name ?? "",
    total: Number(row.total ?? 0),
    status: row.status ?? "draft",
    month: row.month ? dateToMonth(row.month) : "",
    issueDate: row.issue_date ?? null,
    dueDate: row.due_date ?? null,
  };
}

/** 取り込み履歴の 1 行（画面用） */
export interface BankImportRow {
  id: string;
  fileName: string;
  format: string;
  rowCount: number;
  insertedCount: number;
  skippedCount: number;
  matchedCount: number;
  periodFrom: string | null;
  periodTo: string | null;
  createdAt: string;
}

export function toImportRow(row: BankImport): BankImportRow {
  return {
    id: row.id,
    fileName: row.file_name,
    format: row.format,
    rowCount: row.row_count,
    insertedCount: row.inserted_count,
    skippedCount: row.skipped_count,
    matchedCount: row.matched_count,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    createdAt: row.created_at,
  };
}

/** 一覧のタブ（?status=） */
export const BANK_STATUS_TABS: { key: BankStatusFilter; label: string }[] = [
  { key: "unmatched", label: "未消込" },
  { key: "matched", label: "消込済み" },
  { key: "ignored", label: "対象外" },
  { key: "all", label: "すべて" },
];

/** タブのリンク先（稼動月には依存しない） */
export function bankStatusHref(status: BankStatusFilter): string {
  return `/bank?status=${encodeURIComponent(status)}`;
}

/** 銀行明細 CSV のダウンロード URL */
export function bankExportUrl(status: BankStatusFilter): string {
  return `/api/export/bank.csv?status=${encodeURIComponent(status)}`;
}

/** 一覧の集計 */
export interface BankTotals {
  count: number;
  inflow: number;
  outflow: number;
  unmatchedCount: number;
  unmatchedInflow: number;
}

export function bankTotals(rows: BankTxnRow[]): BankTotals {
  const unmatched = rows.filter((r) => r.status === "unmatched");
  return {
    count: rows.length,
    inflow: sumMoney(rows.filter((r) => r.amount > 0).map((r) => r.amount)),
    outflow: sumMoney(rows.filter((r) => r.amount < 0).map((r) => -r.amount)),
    unmatchedCount: unmatched.length,
    unmatchedInflow: sumMoney(unmatched.filter((r) => r.amount > 0).map((r) => r.amount)),
  };
}

/** 取り込み結果のサマリー（トーストと画面上部に出す文） */
export function importResultMessage(result: { inserted: number; matched: number; skipped: number; failed?: number }): string {
  const parts: string[] = [];
  if (result.inserted > 0) {
    parts.push(result.matched > 0 ? `${result.inserted} 件を取り込み、${result.matched} 件を自動で消し込みました。` : `${result.inserted} 件を取り込みました。`);
  } else {
    parts.push("新しく取り込んだ明細はありませんでした。");
  }
  if (result.skipped > 0) parts.push(`${result.skipped} 件は取り込み済みのため飛ばしました。`);
  if (result.failed && result.failed > 0) parts.push(`${result.failed} 行は読み取れませんでした。`);
  return parts.join("");
}

/** "2026-09-18" → "9/18" */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  if (!m || !d) return date;
  return `${Number(m)}/${Number(d)}`;
}

/** 取り込み履歴の期間表示 */
export function importPeriodText(row: BankImportRow): string {
  if (!row.periodFrom || !row.periodTo) return "—";
  return row.periodFrom === row.periodTo ? row.periodFrom : `${row.periodFrom} 〜 ${row.periodTo}`;
}
