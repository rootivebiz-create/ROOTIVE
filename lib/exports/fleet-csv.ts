/**
 * 車両・書類 CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * 期限の状態・残り日数は DB ビュー（v_vehicle_list / v_document_list）の値をそのまま出す。
 * 金額（リース料）は税抜。
 */
import {
  DOCUMENT_KIND_LABELS,
  EXPIRY_STATUS_LABELS,
  VEHICLE_OWNERSHIP_LABELS,
  type DocumentListRow,
  type VehicleRow,
} from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { toCsv, type CsvValue } from "./csv";

const activeLabel = (isActive: boolean | null | undefined) => (isActive === false ? "停止中" : "有効");

// ---------------------------------------------------------------------------
// 車両
// ---------------------------------------------------------------------------

export const VEHICLES_CSV_HEADERS = [
  "車両番号",
  "メーカー",
  "車種",
  "所有区分",
  "割当ドライバー",
  "月額リース料",
  "走行距離",
  "次の期限",
  "次の書類",
  "期限切れ件数",
  "状態",
  "備考",
] as const;

/** v_vehicle_list のうち CSV に必要な列 */
export type VehicleCsvSource = Pick<
  VehicleRow,
  "plate" | "maker" | "model" | "ownership" | "driver_name" | "lease_monthly" | "odometer" | "next_expires_on" | "next_kind" | "expired_count" | "is_active" | "memo"
>;

export function vehicleToCsvRow(v: VehicleCsvSource): CsvValue[] {
  return [
    v.plate ?? "",
    v.maker ?? "",
    v.model ?? "",
    v.ownership ? VEHICLE_OWNERSHIP_LABELS[v.ownership] : "",
    v.driver_name ?? "",
    rawNumber(v.lease_monthly),
    v.odometer == null ? "" : rawNumber(v.odometer),
    v.next_expires_on ?? "",
    v.next_kind ? DOCUMENT_KIND_LABELS[v.next_kind] : "",
    rawNumber(v.expired_count),
    activeLabel(v.is_active),
    v.memo ?? "",
  ];
}

/** 車両 CSV（ヘッダー行付き） */
export function vehiclesCsv(rows: VehicleCsvSource[]): string {
  return toCsv([[...VEHICLES_CSV_HEADERS], ...rows.map(vehicleToCsvRow)]);
}

// ---------------------------------------------------------------------------
// 書類と期限
// ---------------------------------------------------------------------------

export const DOCUMENTS_CSV_HEADERS = ["対象", "対象の種別", "種類", "名称", "番号", "取得日", "有効期限", "残り日数", "期限の状態", "通知（日前）", "状態", "備考"] as const;

/** v_document_list のうち CSV に必要な列 */
export type DocumentCsvSource = Pick<
  DocumentListRow,
  "kind" | "driver_name" | "vehicle_plate" | "label" | "number" | "issued_on" | "expires_on" | "days_left" | "expiry_status" | "reminder_days" | "is_active" | "memo"
>;

export function documentToCsvRow(d: DocumentCsvSource): CsvValue[] {
  const driverName = d.driver_name ?? "";
  const plate = d.vehicle_plate ?? "";
  return [
    driverName || plate,
    driverName ? "ドライバー" : plate ? "車両" : "",
    d.kind ? DOCUMENT_KIND_LABELS[d.kind] : "",
    d.label ?? "",
    d.number ?? "",
    d.issued_on ?? "",
    d.expires_on ?? "",
    d.days_left == null ? "" : rawNumber(d.days_left),
    d.expiry_status ? (EXPIRY_STATUS_LABELS[d.expiry_status] ?? d.expiry_status) : "",
    rawNumber(d.reminder_days),
    activeLabel(d.is_active),
    d.memo ?? "",
  ];
}

/** 書類 CSV（ヘッダー行付き） */
export function documentsCsv(rows: DocumentCsvSource[]): string {
  return toCsv([[...DOCUMENTS_CSV_HEADERS], ...rows.map(documentToCsvRow)]);
}

/** 車両の行配列（先頭が見出し行。Excel 出力と共用） */
export function vehiclesCsvRows(rows: VehicleCsvSource[]): CsvValue[][] {
  return [[...VEHICLES_CSV_HEADERS], ...rows.map(vehicleToCsvRow)];
}

/** 書類と期限の行配列（先頭が見出し行。Excel 出力と共用） */
export function documentsCsvRows(rows: DocumentCsvSource[]): CsvValue[][] {
  return [[...DOCUMENTS_CSV_HEADERS], ...rows.map(documentToCsvRow)];
}
