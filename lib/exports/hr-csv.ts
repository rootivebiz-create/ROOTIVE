/**
 * 採用（応募者）と業務委託契約の CSV（§8.1 の書式に合わせる：UTF-8 BOM・CRLF・数値は生の値）
 * 日付はビューの値（"YYYY-MM-DD"）をそのまま出す。真偽値は ○／×。
 */
import { APPLICANT_STAGE_LABELS, CONTRACT_PERIOD_LABELS, CONTRACT_STATUS_LABELS, type ApplicantRow, type ContractRow } from "@/lib/db/types";
import { rawNumber } from "@/lib/format";
import { CHECKLIST_ITEMS, checklistProgress, toChecklist } from "@/lib/hr/helpers";
import { toCsv, type CsvValue } from "./csv";

/** ○／×（未入力は空欄） */
function mark(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "○" : "×";
}

// ---------------------------------------------------------------------------
// 応募者
// ---------------------------------------------------------------------------

export const APPLICANTS_CSV_HEADERS = [
  "氏名",
  "かな",
  "電話",
  "メール",
  "応募元",
  "段階",
  "応募日",
  "面談日",
  "稼働開始日",
  "ドライバー",
  "書類",
  ...CHECKLIST_ITEMS.map((i) => i.label),
  "やりとり件数",
  "最終やりとり",
  "応募からの日数",
  "備考",
] as const;

/** v_applicant_list のうち CSV に必要な列 */
export type ApplicantCsvSource = Pick<
  ApplicantRow,
  | "name"
  | "kana"
  | "phone"
  | "email"
  | "source"
  | "stage"
  | "applied_on"
  | "interview_on"
  | "started_on"
  | "driver_name"
  | "checklist"
  | "event_count"
  | "last_event_on"
  | "days_since_applied"
  | "memo"
>;

export function applicantToCsvRow(a: ApplicantCsvSource): CsvValue[] {
  const checklist = toChecklist(a.checklist);
  const { done, total } = checklistProgress(a.checklist);
  return [
    a.name ?? "",
    a.kana ?? "",
    a.phone ?? "",
    a.email ?? "",
    a.source ?? "",
    a.stage ? APPLICANT_STAGE_LABELS[a.stage] : "",
    a.applied_on ?? "",
    a.interview_on ?? "",
    a.started_on ?? "",
    a.driver_name ?? "",
    `${done}/${total}`,
    ...CHECKLIST_ITEMS.map((i) => mark(checklist[i.key])),
    rawNumber(a.event_count),
    a.last_event_on ?? "",
    rawNumber(a.days_since_applied),
    a.memo ?? "",
  ];
}

/** 応募者 CSV（ヘッダー行付き） */
export function applicantsCsv(rows: ApplicantCsvSource[]): string {
  return toCsv([[...APPLICANTS_CSV_HEADERS], ...rows.map(applicantToCsvRow)]);
}

// ---------------------------------------------------------------------------
// 業務委託契約
// ---------------------------------------------------------------------------

export const CONTRACTS_CSV_HEADERS = [
  "ドライバー",
  "契約名",
  "状態",
  "期間の状態",
  "開始日",
  "終了日",
  "残り日数",
  "自動更新",
  "通知日数",
  "契約書",
  "合意日時",
  "備考",
] as const;

/** v_contract_list のうち CSV に必要な列 */
export type ContractCsvSource = Pick<
  ContractRow,
  | "driver_name"
  | "title"
  | "status"
  | "period_status"
  | "start_on"
  | "end_on"
  | "days_left"
  | "auto_renew"
  | "notice_days"
  | "file_path"
  | "agreed_at"
  | "memo"
>;

export function contractToCsvRow(c: ContractCsvSource): CsvValue[] {
  return [
    c.driver_name ?? "",
    c.title ?? "",
    c.status ? CONTRACT_STATUS_LABELS[c.status] : "",
    c.period_status ? (CONTRACT_PERIOD_LABELS[c.period_status] ?? c.period_status) : "",
    c.start_on ?? "",
    c.end_on ?? "",
    c.days_left == null ? "" : rawNumber(c.days_left),
    mark(c.auto_renew),
    rawNumber(c.notice_days),
    c.file_path ?? "",
    c.agreed_at ?? "",
    c.memo ?? "",
  ];
}

/** 業務委託契約 CSV（ヘッダー行付き） */
export function contractsCsv(rows: ContractCsvSource[]): string {
  return toCsv([[...CONTRACTS_CSV_HEADERS], ...rows.map(contractToCsvRow)]);
}

// ---------------------------------------------------------------------------
// URL・ファイル名
// ---------------------------------------------------------------------------

/** 出力 URL（/hr の CSV リンク。kind は "applicant" | "contract"） */
export function hrCsvUrl(kind: string): string {
  return `/api/export/hr.csv?kind=${encodeURIComponent(kind)}`;
}

/** ファイル名："応募者一覧.csv" / "業務委託契約一覧.csv" */
export function hrCsvFilename(kind: string): string {
  return kind === "contract" ? "業務委託契約一覧.csv" : "応募者一覧.csv";
}

/** 応募者の行配列（先頭が見出し行。Excel 出力と共用） */
export function applicantsCsvRows(rows: ApplicantCsvSource[]): CsvValue[][] {
  return [[...APPLICANTS_CSV_HEADERS], ...rows.map(applicantToCsvRow)];
}

/** 業務委託契約の行配列（先頭が見出し行。Excel 出力と共用） */
export function contractsCsvRows(rows: ContractCsvSource[]): CsvValue[][] {
  return [[...CONTRACTS_CSV_HEADERS], ...rows.map(contractToCsvRow)];
}
