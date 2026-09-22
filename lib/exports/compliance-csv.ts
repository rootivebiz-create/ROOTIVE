/**
 * 法定帳票の CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 *
 * - roster       運転者台帳（1 人 1 行。国交省の様式の項目にそろえる）
 * - instruction  指導・監督の記録
 * - incident     事故・違反の記録
 * - aptitude     適性診断の記録
 *
 * 監査で「出してください」と言われたときにそのまま渡せるよう、
 * 日付は "YYYY-MM-DD"、空欄は空のまま（0 を入れない）にする。
 */
import {
  APTITUDE_KIND_LABELS,
  INCIDENT_KIND_LABELS,
  INSTRUCTION_KIND_LABELS,
  type AptitudeKind,
  type DriverRosterRow,
  type IncidentKind,
} from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { isoToJstDate } from "@/lib/daily/helpers";
import { toCsv, type CsvValue } from "./csv";

/** CSV の種類（?kind=） */
export const COMPLIANCE_CSV_KINDS = ["roster", "instruction", "incident", "aptitude"] as const;
export type ComplianceCsvKind = (typeof COMPLIANCE_CSV_KINDS)[number];

/** ?kind= の値（不正・未指定なら "roster"） */
export function complianceCsvKindFromParam(param: string | string[] | null | undefined): ComplianceCsvKind {
  const v = Array.isArray(param) ? param[0] : param;
  return (COMPLIANCE_CSV_KINDS as readonly string[]).includes(String(v)) ? (v as ComplianceCsvKind) : "roster";
}

export const COMPLIANCE_CSV_LABELS: Record<ComplianceCsvKind, string> = {
  roster: "運転者台帳",
  instruction: "指導・監督の記録",
  incident: "事故・違反の記録",
  aptitude: "適性診断の記録",
};

/** 数値（未入力は空欄。0 は "0"） */
function numText(v: number | null | undefined): string {
  return v == null ? "" : rawNumber(v);
}

// ---------------------------------------------------------------------------
// 運転者台帳
// ---------------------------------------------------------------------------

export const ROSTER_CSV_HEADERS = [
  "作成番号",
  "氏名",
  "かな",
  "生年月日",
  "年齢",
  "住所",
  "電話",
  "雇入れ年月日",
  "選任年月日",
  "退職年月日",
  "在籍",
  "免許証番号",
  "免許の種類",
  "免許の条件",
  "免許交付日",
  "免許有効期限",
  "健康診断",
  "指導の回数",
  "最終の指導",
  "初任診断",
  "適齢診断",
  "最終の適性診断",
  "事故",
  "違反",
  "保存期限",
] as const;

export type RosterCsvSource = DriverRosterRow;

export function rosterToCsvRow(r: RosterCsvSource): CsvValue[] {
  return [
    r.roster_no ?? "",
    r.name ?? "",
    r.kana ?? "",
    r.birth_date ?? "",
    numText(r.age),
    r.address ?? "",
    r.phone ?? "",
    r.hired_on ?? "",
    r.appointed_on ?? "",
    r.retired_on ?? "",
    r.retired_on ? "退職" : r.is_active ? "在籍" : "停止中",
    r.license_no ?? "",
    r.license_kinds ?? "",
    r.license_conditions ?? "",
    r.license_issued_on ?? "",
    r.license_expires_on ?? "",
    r.health_check_on ?? "",
    numText(r.instruction_count),
    r.instruction_last_on ?? "",
    r.aptitude_initial_on ?? "",
    r.aptitude_age_on ?? "",
    r.aptitude_last_on ?? "",
    numText(r.accident_count),
    numText(r.violation_count),
    r.keep_until ?? "",
  ];
}

export function rosterCsvRows(rows: RosterCsvSource[]): CsvValue[][] {
  return [[...ROSTER_CSV_HEADERS], ...rows.map(rosterToCsvRow)];
}

// ---------------------------------------------------------------------------
// 指導・監督の記録
// ---------------------------------------------------------------------------

export const INSTRUCTION_CSV_HEADERS = ["実施日", "ドライバー", "種類", "時間", "内容", "実施者", "備考"] as const;

export interface InstructionCsvSource {
  instructed_on: string | null;
  driver_name?: string | null;
  kind: string | null;
  hours: number | null;
  topics: string | null;
  instructor: string | null;
  memo: string | null;
}

export function instructionToCsvRow(r: InstructionCsvSource): CsvValue[] {
  return [
    r.instructed_on ?? "",
    r.driver_name ?? "",
    INSTRUCTION_KIND_LABELS[r.kind ?? ""] ?? (r.kind ?? ""),
    numText(r.hours),
    r.topics ?? "",
    r.instructor ?? "",
    r.memo ?? "",
  ];
}

export function instructionCsvRows(rows: InstructionCsvSource[]): CsvValue[][] {
  return [[...INSTRUCTION_CSV_HEADERS], ...rows.map(instructionToCsvRow)];
}

// ---------------------------------------------------------------------------
// 事故・違反の記録
// ---------------------------------------------------------------------------

export const INCIDENT_CSV_HEADERS = ["発生日時", "ドライバー", "車両", "種類", "場所", "内容", "原因", "再発防止", "報告", "費用", "備考"] as const;

export interface IncidentCsvSource {
  occurred_at: string | null;
  driver_name?: string | null;
  vehicle_plate?: string | null;
  kind: string | null;
  place: string | null;
  description: string | null;
  cause: string | null;
  prevention: string | null;
  reported: boolean | null;
  cost: number | null;
  memo: string | null;
}

export function incidentToCsvRow(r: IncidentCsvSource): CsvValue[] {
  const date = isoToJstDate(r.occurred_at);
  return [
    date === "" ? "" : `${date} ${String(r.occurred_at ?? "").slice(11, 16)}`,
    r.driver_name ?? "",
    r.vehicle_plate ?? "",
    INCIDENT_KIND_LABELS[(r.kind ?? "") as IncidentKind] ?? (r.kind ?? ""),
    r.place ?? "",
    r.description ?? "",
    r.cause ?? "",
    r.prevention ?? "",
    r.reported == null ? "" : r.reported ? "済" : "未",
    numText(r.cost),
    r.memo ?? "",
  ];
}

export function incidentCsvRows(rows: IncidentCsvSource[]): CsvValue[][] {
  return [[...INCIDENT_CSV_HEADERS], ...rows.map(incidentToCsvRow)];
}

// ---------------------------------------------------------------------------
// 適性診断の記録
// ---------------------------------------------------------------------------

export const APTITUDE_CSV_HEADERS = ["受診日", "ドライバー", "種類", "実施機関", "結果", "備考"] as const;

export interface AptitudeCsvSource {
  taken_on: string | null;
  driver_name?: string | null;
  kind: string | null;
  institution: string | null;
  result: string | null;
  memo: string | null;
}

export function aptitudeToCsvRow(r: AptitudeCsvSource): CsvValue[] {
  return [
    r.taken_on ?? "",
    r.driver_name ?? "",
    APTITUDE_KIND_LABELS[(r.kind ?? "general") as AptitudeKind] ?? (r.kind ?? ""),
    r.institution ?? "",
    r.result ?? "",
    r.memo ?? "",
  ];
}

export function aptitudeCsvRows(rows: AptitudeCsvSource[]): CsvValue[][] {
  return [[...APTITUDE_CSV_HEADERS], ...rows.map(aptitudeToCsvRow)];
}

// ---------------------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------------------

export function rosterToCsv(rows: RosterCsvSource[]): string {
  return toCsv(rosterCsvRows(rows));
}
export function instructionsToCsv(rows: InstructionCsvSource[]): string {
  return toCsv(instructionCsvRows(rows));
}
export function incidentsToCsv(rows: IncidentCsvSource[]): string {
  return toCsv(incidentCsvRows(rows));
}
export function aptitudesToCsv(rows: AptitudeCsvSource[]): string {
  return toCsv(aptitudeCsvRows(rows));
}

/** ファイル名（種類と出力日） */
export function complianceCsvFilename(kind: ComplianceCsvKind, today: string): string {
  return `${COMPLIANCE_CSV_LABELS[kind]}_${today}.csv`;
}
