/**
 * 日報・点呼と日別の稼働の CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * - kind=report：点呼記録簿・業務記録（1 年間の保存が必要な帳票としてそのまま使える列）
 * - kind=entry：日別の稼働（ドライバー報告の承認状況）
 * 実施者・承認者の名前は行に持たせて渡す（ビューには ID しか無いため、呼び出し側で解決する）
 */
import { DAY_ENTRY_STATUS_LABELS, ENTRY_SOURCE_LABELS, ROLL_CALL_METHOD_LABELS, type DailyReportRow, type WorkDayEntryRow } from "@/lib/db/types";
import { UNIT_LABELS } from "@/lib/calc/types";
import { rawNumber } from "@/lib/format";
import { isoToJstDate, isoToJstTime } from "@/lib/daily/helpers";
import { toCsv, type CsvValue } from "./csv";

/** CSV の種類（?kind=） */
export const DAILY_CSV_KINDS = ["report", "entry"] as const;
export type DailyCsvKind = (typeof DAILY_CSV_KINDS)[number];

/** ?kind= の値（不正・未指定なら "report"） */
export function dailyCsvKindFromParam(param: string | string[] | null | undefined): DailyCsvKind {
  const v = Array.isArray(param) ? param[0] : param;
  return v === "entry" ? "entry" : "report";
}

/** はい／いいえ（未入力は空欄） */
export function boolText(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "○" : "×";
}

/** 日本時間の日時 "2026-09-18 08:30"（空・不正は空欄） */
export function jstTimestampText(iso: string | null | undefined): string {
  const date = isoToJstDate(iso);
  return date === "" ? "" : `${date} ${isoToJstTime(iso)}`;
}

/** 数値（未入力は空欄。0 は "0"） */
function numText(v: number | null | undefined): string {
  return v == null ? "" : rawNumber(v);
}

// ---------------------------------------------------------------------------
// 点呼記録簿・業務記録
// ---------------------------------------------------------------------------

export const DAILY_REPORT_CSV_HEADERS = [
  "日付",
  "ドライバー",
  "車両",
  "業務前点呼 時刻",
  "業務前点呼 方法",
  "業務前点呼 アルコール",
  "業務前点呼 体調",
  "業務前点呼 日常点検",
  "業務前点呼 指示事項",
  "業務前点呼 実施者",
  "業務後点呼 時刻",
  "業務後点呼 方法",
  "業務後点呼 アルコール",
  "業務後点呼 体調",
  "業務後点呼 事故・違反の報告",
  "業務後点呼 実施者",
  "業務開始",
  "業務終了",
  "休憩（分）",
  "走行距離",
  "稼働合計",
  "備考",
] as const;

/** v_daily_report_list のうち CSV に必要な列 ＋ 実施者名（呼び出し側で解決する） */
export type DailyReportCsvSource = Pick<
  DailyReportRow,
  | "work_date"
  | "driver_name"
  | "vehicle_plate"
  | "pre_at"
  | "pre_method"
  | "pre_alcohol"
  | "pre_health_ok"
  | "pre_inspection_ok"
  | "pre_instruction"
  | "post_at"
  | "post_method"
  | "post_alcohol"
  | "post_condition_ok"
  | "post_incident"
  | "start_at"
  | "end_at"
  | "break_minutes"
  | "distance_km"
  | "qty_total"
  | "memo"
> & {
  /** 業務前点呼の実施者名（不明なら空欄） */
  pre_by_name?: string | null;
  /** 業務後点呼の実施者名（不明なら空欄） */
  post_by_name?: string | null;
};

export function dailyReportToCsvRow(r: DailyReportCsvSource): CsvValue[] {
  return [
    r.work_date ?? "",
    r.driver_name ?? "",
    r.vehicle_plate ?? "",
    jstTimestampText(r.pre_at),
    r.pre_method ? ROLL_CALL_METHOD_LABELS[r.pre_method] : "",
    numText(r.pre_alcohol),
    boolText(r.pre_health_ok),
    boolText(r.pre_inspection_ok),
    r.pre_instruction ?? "",
    r.pre_by_name ?? "",
    jstTimestampText(r.post_at),
    r.post_method ? ROLL_CALL_METHOD_LABELS[r.post_method] : "",
    numText(r.post_alcohol),
    boolText(r.post_condition_ok),
    r.post_incident ?? "",
    r.post_by_name ?? "",
    jstTimestampText(r.start_at),
    jstTimestampText(r.end_at),
    numText(r.break_minutes),
    numText(r.distance_km),
    rawNumber(r.qty_total),
    r.memo ?? "",
  ];
}

/** 点呼記録簿 CSV（ヘッダー行付き） */
export function toDailyReportsCsv(rows: DailyReportCsvSource[]): string {
  return toCsv([[...DAILY_REPORT_CSV_HEADERS], ...rows.map(dailyReportToCsvRow)]);
}

// ---------------------------------------------------------------------------
// 日別の稼働
// ---------------------------------------------------------------------------

export const DAY_ENTRY_CSV_HEADERS = [
  "日付",
  "ドライバー",
  "案件",
  "内容",
  "区分",
  "数量",
  "入力元",
  "状態",
  "差戻しの理由",
  "承認者",
  "承認日時",
  "備考",
] as const;

/** v_work_day_entry_list のうち CSV に必要な列 ＋ 承認者名（呼び出し側で解決する） */
export type DayEntryCsvSource = Pick<
  WorkDayEntryRow,
  "work_date" | "driver_name" | "project_name" | "item_name" | "unit" | "qty" | "source" | "status" | "reject_reason" | "approved_at" | "memo"
> & {
  /** 承認者名（不明なら空欄） */
  approved_by_name?: string | null;
};

export function dayEntryToCsvRow(e: DayEntryCsvSource): CsvValue[] {
  return [
    e.work_date ?? "",
    e.driver_name ?? "",
    e.project_name ?? "",
    e.item_name ?? "",
    e.unit ? UNIT_LABELS[e.unit] : "",
    rawNumber(e.qty),
    e.source ? ENTRY_SOURCE_LABELS[e.source] : "",
    e.status ? DAY_ENTRY_STATUS_LABELS[e.status] : "",
    e.reject_reason ?? "",
    e.approved_by_name ?? "",
    jstTimestampText(e.approved_at),
    e.memo ?? "",
  ];
}

/** 日別の稼働 CSV（ヘッダー行付き） */
export function toDayEntriesCsv(rows: DayEntryCsvSource[]): string {
  return toCsv([[...DAY_ENTRY_CSV_HEADERS], ...rows.map(dayEntryToCsvRow)]);
}

// ---------------------------------------------------------------------------
// URL・ファイル名
// ---------------------------------------------------------------------------

/** 出力 URL（/daily の CSV リンク） */
export function dailyCsvUrl(month: string, kind: DailyCsvKind = "report"): string {
  return `/api/export/daily.csv?m=${encodeURIComponent(month)}&kind=${encodeURIComponent(kind)}`;
}

/** ファイル名："点呼記録簿_2026-09.csv" / "日別の稼働_2026-09.csv" */
export function dailyCsvFilename(monthLabel: string, kind: DailyCsvKind = "report"): string {
  return `${kind === "entry" ? "日別の稼働" : "点呼記録簿"}_${monthLabel}.csv`;
}

/** 点呼記録簿・業務記録の行配列（先頭が見出し行。Excel 出力と共用） */
export function dailyReportsCsvRows(rows: DailyReportCsvSource[]): CsvValue[][] {
  return [[...DAILY_REPORT_CSV_HEADERS], ...rows.map(dailyReportToCsvRow)];
}

/** 日別の稼働の行配列（先頭が見出し行。Excel 出力と共用） */
export function dayEntriesCsvRows(rows: DayEntryCsvSource[]): CsvValue[][] {
  return [[...DAY_ENTRY_CSV_HEADERS], ...rows.map(dayEntryToCsvRow)];
}
