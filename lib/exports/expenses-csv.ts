/**
 * 経費 CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * 金額はすべて税抜。課税区分は消費税の集計用（課税／対象外）。
 */
import { EXPENSE_KIND_LABELS, type ExpenseListRow } from "@/lib/db/types";
import { EXPENSE_TAX_MODE_LABELS } from "@/lib/schemas/expenses";
import { rawNumber } from "@/lib/format";
import { dateToMonth } from "@/lib/month";
import { toCsv, type CsvValue } from "./csv";

export const EXPENSES_CSV_HEADERS = ["稼動月", "カテゴリ", "区分", "内容", "金額", "課税区分", "発生日", "ドライバー", "案件", "支払先", "備考"] as const;

/** v_expense_list のうち CSV に必要な列 */
export type ExpenseCsvSource = Pick<
  ExpenseListRow,
  "month" | "category_name" | "kind" | "label" | "amount" | "tax_mode" | "incurred_on" | "driver_name" | "project_name" | "vendor" | "memo"
>;

export function expenseToCsvRow(e: ExpenseCsvSource): CsvValue[] {
  return [
    e.month ? dateToMonth(e.month) : "",
    e.category_name ?? "",
    e.kind ? EXPENSE_KIND_LABELS[e.kind] : "",
    e.label ?? "",
    rawNumber(e.amount),
    e.tax_mode ? EXPENSE_TAX_MODE_LABELS[e.tax_mode] : "",
    e.incurred_on ?? "",
    e.driver_name ?? "",
    e.project_name ?? "",
    e.vendor ?? "",
    e.memo ?? "",
  ];
}

/** 経費 CSV（ヘッダー行付き） */
export function toExpensesCsv(rows: ExpenseCsvSource[]): string {
  return toCsv([[...EXPENSES_CSV_HEADERS], ...rows.map(expenseToCsvRow)]);
}

/** 経費の行配列（先頭が見出し行。Excel 出力と共用） */
export function expensesCsvRows(rows: ExpenseCsvSource[]): CsvValue[][] {
  return [[...EXPENSES_CSV_HEADERS], ...rows.map(expenseToCsvRow)];
}
