/**
 * 労務（拘束時間・実働・休息期間・連続勤務）の CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 * - kind=day：日ごと（v_daily_labor）
 * - kind=month：ドライバー × 月（v_driver_month_labor）
 * 時間はすべて分（整数）で出す（Excel で集計しやすいように、表示用の「13 時間 20 分」は使わない）。
 * ドライバー名は v_daily_labor に無いため、呼び出し側で解決して行に持たせる。
 */
import type { DailyLaborRow, DriverMonthLaborRow } from "@/lib/db/types";
import { dateToMonth } from "@/lib/month";
import { rawNumber } from "@/lib/format";
import { laborRiskLevel, laborTone } from "@/lib/labor/helpers";
import { jstTimestampText } from "./daily-csv";
import { toCsv, type CsvValue } from "./csv";

/** CSV の種類（?kind=） */
export const LABOR_CSV_KINDS = ["day", "month"] as const;
export type LaborCsvKind = (typeof LABOR_CSV_KINDS)[number];

/** ?kind= の値（不正・未指定なら "day"） */
export function laborCsvKindFromParam(param: string | string[] | null | undefined): LaborCsvKind {
  const v = Array.isArray(param) ? param[0] : param;
  return v === "month" ? "month" : "day";
}

/** 数値（未入力は空欄。0 は "0"） */
function numText(v: number | null | undefined): string {
  return v == null ? "" : rawNumber(v);
}

/** はい／いいえ（未入力は空欄） */
function overText(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "○" : "";
}

// ---------------------------------------------------------------------------
// 日ごと
// ---------------------------------------------------------------------------

export const LABOR_DAY_CSV_HEADERS = [
  "日付",
  "ドライバー",
  "開始",
  "終了",
  "拘束（分）",
  "休憩（分）",
  "実働（分）",
  "休息（分）",
  "連続日数",
  "拘束の判定",
  "休息の判定",
  "休憩の判定",
] as const;

/** v_daily_labor のうち CSV に必要な列 ＋ ドライバー名（呼び出し側で解決する） */
export type LaborDayCsvSource = Pick<
  DailyLaborRow,
  | "work_date"
  | "start_at"
  | "end_at"
  | "duty_minutes"
  | "break_minutes"
  | "work_minutes"
  | "rest_minutes"
  | "consecutive_days"
  | "duty_status"
  | "rest_status"
  | "break_status"
> & {
  /** ドライバー名（不明なら空欄） */
  driver_name?: string | null;
};

export function laborDayToCsvRow(r: LaborDayCsvSource): CsvValue[] {
  return [
    r.work_date ?? "",
    r.driver_name ?? "",
    jstTimestampText(r.start_at),
    jstTimestampText(r.end_at),
    numText(r.duty_minutes),
    numText(r.break_minutes),
    numText(r.work_minutes),
    numText(r.rest_minutes),
    numText(r.consecutive_days),
    laborTone(r.duty_status, "duty").label,
    laborTone(r.rest_status, "rest").label,
    laborTone(r.break_status, "break").label,
  ];
}

/** 日ごとの労務 CSV（ヘッダー行付き） */
export function toLaborDaysCsv(rows: LaborDayCsvSource[]): string {
  return toCsv(laborDaysCsvRows(rows));
}

/** 日ごとの労務の行配列（先頭が見出し行。Excel 出力と共用） */
export function laborDaysCsvRows(rows: LaborDayCsvSource[]): CsvValue[][] {
  return [[...LABOR_DAY_CSV_HEADERS], ...rows.map(laborDayToCsvRow)];
}

// ---------------------------------------------------------------------------
// ドライバー × 月
// ---------------------------------------------------------------------------

export const LABOR_MONTH_CSV_HEADERS = [
  "稼動月",
  "ドライバー",
  "日報の日数",
  "対象日数",
  "拘束の合計（分）",
  "拘束の平均（分）",
  "拘束の最大（分）",
  "実働の合計（分）",
  "走行距離",
  "拘束が目安超（日）",
  "拘束が上限超（日）",
  "休息が目安割れ（日）",
  "休息が下限割れ（日）",
  "休憩が不足（日）",
  "連続勤務の最大（日）",
  "1 か月の拘束が上限超",
  "連続勤務が上限超",
  "判定",
] as const;

/** v_driver_month_labor のうち CSV に必要な列 */
export type LaborMonthCsvSource = Pick<
  DriverMonthLaborRow,
  | "month"
  | "driver_name"
  | "report_days"
  | "measured_days"
  | "duty_minutes_total"
  | "duty_minutes_avg"
  | "duty_minutes_max"
  | "work_minutes_total"
  | "distance_km_total"
  | "over_duty_days"
  | "severe_duty_days"
  | "short_rest_days"
  | "severe_rest_days"
  | "short_break_days"
  | "max_consecutive_days"
  | "labor_month_duty_minutes"
  | "labor_max_consecutive_days"
  | "month_duty_over"
  | "consecutive_over"
>;

export function laborMonthToCsvRow(r: LaborMonthCsvSource): CsvValue[] {
  return [
    r.month ? dateToMonth(r.month) : "",
    r.driver_name ?? "",
    numText(r.report_days),
    numText(r.measured_days),
    numText(r.duty_minutes_total),
    numText(r.duty_minutes_avg),
    numText(r.duty_minutes_max),
    numText(r.work_minutes_total),
    numText(r.distance_km_total),
    numText(r.over_duty_days),
    numText(r.severe_duty_days),
    numText(r.short_rest_days),
    numText(r.severe_rest_days),
    numText(r.short_break_days),
    numText(r.max_consecutive_days),
    overText(r.month_duty_over),
    overText(r.consecutive_over),
    laborRiskLevel(r).label,
  ];
}

/** ドライバー × 月の労務 CSV（ヘッダー行付き） */
export function toLaborMonthsCsv(rows: LaborMonthCsvSource[]): string {
  return toCsv(laborMonthsCsvRows(rows));
}

/** ドライバー × 月の労務の行配列（先頭が見出し行。Excel 出力と共用） */
export function laborMonthsCsvRows(rows: LaborMonthCsvSource[]): CsvValue[][] {
  return [[...LABOR_MONTH_CSV_HEADERS], ...rows.map(laborMonthToCsvRow)];
}

// ---------------------------------------------------------------------------
// ファイル名
// ---------------------------------------------------------------------------

/** ファイル名："労務_日別_2026-09.csv" / "労務_月別_2026-09.csv" */
export function laborCsvFilename(monthLabel: string, kind: LaborCsvKind = "day"): string {
  return `労務_${kind === "month" ? "月別" : "日別"}_${monthLabel}.csv`;
}
