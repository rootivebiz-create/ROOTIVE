/**
 * 気になること（アラート）CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * 金額は種類によって意味が違う（管理費・会社利益・請求額・残高見込みなど）ため、そのままの値を出す。
 */
import { ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS, type Alert } from "@/lib/db/types";
import { alertCodeInfo } from "@/lib/alerts/helpers";
import { rawNumber } from "@/lib/format";
import { dateToMonth } from "@/lib/month";
import { toCsv, type CsvValue } from "./csv";

export const ALERTS_CSV_HEADERS = ["稼動月", "重さ", "種類", "内容", "説明", "金額", "状態", "検知日時", "対応日時", "メモ", "リンク"] as const;

/** alerts のうち CSV に必要な列 */
export type AlertCsvSource = Pick<
  Alert,
  "month" | "code" | "severity" | "title" | "detail" | "amount" | "status" | "detected_at" | "resolved_at" | "note" | "href"
>;

export function alertToCsvRow(a: AlertCsvSource): CsvValue[] {
  return [
    a.month ? dateToMonth(a.month) : "",
    a.severity ? ALERT_SEVERITY_LABELS[a.severity] : "",
    alertCodeInfo(a.code).label,
    a.title ?? "",
    a.detail ?? "",
    a.amount == null ? "" : rawNumber(a.amount),
    a.status ? ALERT_STATUS_LABELS[a.status] : "",
    a.detected_at ?? "",
    a.resolved_at ?? "",
    a.note ?? "",
    a.href ?? "",
  ];
}

/** 気になること CSV（ヘッダー行付き） */
export function alertsCsv(rows: AlertCsvSource[]): string {
  return toCsv([[...ALERTS_CSV_HEADERS], ...rows.map(alertToCsvRow)]);
}

/** 出力 URL（/alerts の CSV リンク。status は "open" | "resolved" | "ignored" | "all"） */
export function alertsCsvUrl(month: string, status: string = "open"): string {
  return `/api/export/alerts.csv?m=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`;
}

/** ファイル名："気になること_2026-09.csv" */
export function alertsCsvFilename(monthLabel: string): string {
  return `気になること_${monthLabel}.csv`;
}

/** 気になることの行配列（先頭が見出し行。Excel 出力と共用） */
export function alertsCsvRows(rows: AlertCsvSource[]): CsvValue[][] {
  return [[...ALERTS_CSV_HEADERS], ...rows.map(alertToCsvRow)];
}
