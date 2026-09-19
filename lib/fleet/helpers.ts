/**
 * 車両・書類の期限、安全管理（指導・監督／講習）の純関数
 * React・DB に依存しない（画面・CSV 出力・テストから使う）。
 *
 * - 期限の判定は DB ビュー `v_document_list.expiry_status` と同じルール
 *   （expires_on < 今日 → expired／expires_on <= 今日 + reminder_days → soon／それ以外 valid／未設定 none）
 * - 日付はすべて DB と同じ "YYYY-MM-DD" の文字列で扱い、基準日（today）は必ず引数で受け取る
 * - 事故の発生日時だけ timestamptz。画面の datetime-local（"YYYY-MM-DDTHH:mm"）と日本時間で相互変換する
 */
import { isDateString } from "@/lib/schemas/expenses";
import { DOCUMENT_KIND_LABELS, type DocumentKind, type DocumentListRow, type VehicleOwnership, type VehicleRow } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// 日付ユーティリティ（日本時間。"YYYY-MM-DD" の文字列で扱う）
// ---------------------------------------------------------------------------

/** 通知の既定（documents.reminder_days の既定値と同じ） */
export const DEFAULT_REMINDER_DAYS = 60;

/** 安全管理者の講習の間隔（2 年ごと） */
export const TRAINING_INTERVAL_YEARS = 2;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 日本時間の今日 "YYYY-MM-DD" */
export function todayJST(now: Date = new Date()): string {
  return isoOf(new Date(now.getTime() + 9 * 60 * 60 * 1000));
}

/** n 日後（n はマイナス可）。不正な日付はそのまま返す */
export function addDaysToDate(date: string, n: number): string {
  if (!isDateString(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  return isoOf(new Date(Date.UTC(y, m - 1, d + n)));
}

/** n 年後（2/29 は月末に詰める。例: 2024-02-29 の 2 年後 → 2026-02-28） */
export function addYearsToDate(date: string, n: number): string {
  if (!isDateString(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return isoOf(new Date(Date.UTC(y + n, m - 1, Math.min(d, lastDay))));
}

/** from から to までの日数（同じ日なら 0、to が過去ならマイナス） */
export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** "2026-09-19" → "2026/09/19"（未設定は "—"） */
export function formatDate(date: string | null | undefined): string {
  if (!date || !isDateString(date)) return "—";
  return date.replace(/-/g, "/");
}

/** "2026-09-19" → "9/19"（未設定は "—"） */
export function shortDate(date: string | null | undefined): string {
  if (!date || !isDateString(date)) return "—";
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// ---------------------------------------------------------------------------
// 期限の状態
// ---------------------------------------------------------------------------

export type ExpiryStatus = "expired" | "soon" | "valid" | "none";

export interface ExpiryState {
  status: ExpiryStatus;
  /** 残り日数（当日は 0、期限切れはマイナス）。期限が無ければ null */
  daysLeft: number | null;
}

/** 状態の並び順（期限切れ → まもなく → 有効 → 期限なし） */
export const EXPIRY_ORDER: Record<ExpiryStatus, number> = { expired: 0, soon: 1, valid: 2, none: 3 };

/**
 * 有効期限の状態と残り日数（DB ビュー v_document_list と同じ判定）
 * @param expiresOn 有効期限 "YYYY-MM-DD"（未設定は null / ""）
 * @param reminderDays 何日前から「まもなく期限」にするか（null は既定 60 日）
 * @param today 基準日 "YYYY-MM-DD"
 */
export function expiryState(expiresOn: string | null | undefined, reminderDays: number | null | undefined, today: string): ExpiryState {
  if (!expiresOn || !isDateString(expiresOn) || !isDateString(today)) return { status: "none", daysLeft: null };
  const remind = reminderDays == null || !Number.isFinite(reminderDays) ? DEFAULT_REMINDER_DAYS : Math.max(0, Math.trunc(reminderDays));
  const daysLeft = diffDays(today, expiresOn);
  if (daysLeft < 0) return { status: "expired", daysLeft };
  if (daysLeft <= remind) return { status: "soon", daysLeft };
  return { status: "valid", daysLeft };
}

/** 期限の状態を日本語 1 行で（「3 日前に期限切れ」「あと 12 日」「有効」「期限なし」） */
export function expiryLabel(state: ExpiryState): string {
  const { status, daysLeft } = state;
  if (status === "none" || daysLeft == null) return "期限なし";
  if (status === "expired") return `${-daysLeft} 日前に期限切れ`;
  if (status === "soon") return daysLeft === 0 ? "今日が期限" : `あと ${daysLeft} 日`;
  return "有効";
}

// ---------------------------------------------------------------------------
// 画面で扱う行（ビューの null を正規化したもの）
// ---------------------------------------------------------------------------

/** 書類 1 件（v_document_list の 1 行 ＋ 基準日で計算し直した期限の状態） */
export interface FleetDocument {
  id: string;
  kind: DocumentKind;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  label: string;
  number: string;
  /** "" = 未設定 */
  issuedOn: string;
  /** "" = 未設定 */
  expiresOn: string;
  reminderDays: number;
  memo: string;
  isActive: boolean;
  status: ExpiryStatus;
  /** 残り日数（当日は 0、期限切れはマイナス）。期限が無ければ null */
  daysLeft: number | null;
}

export function toFleetDocument(row: DocumentListRow, today: string): FleetDocument {
  const expiresOn = row.expires_on ?? "";
  const reminderDays = Number(row.reminder_days ?? DEFAULT_REMINDER_DAYS);
  const state = expiryState(expiresOn, reminderDays, today);
  return {
    id: row.id ?? "",
    kind: (row.kind ?? "other") as DocumentKind,
    driverId: row.driver_id ?? "",
    driverName: row.driver_name ?? "",
    vehicleId: row.vehicle_id ?? "",
    vehiclePlate: row.vehicle_plate ?? "",
    label: row.label ?? "",
    number: row.number ?? "",
    issuedOn: row.issued_on ?? "",
    expiresOn,
    reminderDays,
    memo: row.memo ?? "",
    isActive: row.is_active !== false,
    status: state.status,
    daysLeft: state.daysLeft,
  };
}

/** 車両 1 台（v_vehicle_list の 1 行 ＋ 基準日で計算し直した次の期限の状態） */
export interface FleetVehicle {
  id: string;
  plate: string;
  maker: string;
  model: string;
  ownership: VehicleOwnership;
  driverId: string;
  driverName: string;
  leaseMonthly: number;
  /** null = 未入力 */
  odometer: number | null;
  memo: string;
  isActive: boolean;
  /** "" = 期限のある書類が無い */
  nextExpiresOn: string;
  nextKind: DocumentKind | null;
  expiredCount: number;
  status: ExpiryStatus;
  daysLeft: number | null;
}

export function toFleetVehicle(row: VehicleRow, today: string): FleetVehicle {
  const nextExpiresOn = row.next_expires_on ?? "";
  const state = expiryState(nextExpiresOn, DEFAULT_REMINDER_DAYS, today);
  return {
    id: row.id ?? "",
    plate: row.plate ?? "",
    maker: row.maker ?? "",
    model: row.model ?? "",
    ownership: (row.ownership ?? "owned") as VehicleOwnership,
    driverId: row.driver_id ?? "",
    driverName: row.driver_name ?? "",
    leaseMonthly: Number(row.lease_monthly ?? 0),
    odometer: row.odometer == null ? null : Number(row.odometer),
    memo: row.memo ?? "",
    isActive: row.is_active !== false,
    nextExpiresOn,
    nextKind: (row.next_kind ?? null) as DocumentKind | null,
    expiredCount: Number(row.expired_count ?? 0),
    status: state.status,
    daysLeft: state.daysLeft,
  };
}

// ---------------------------------------------------------------------------
// 書類の並べ替え・集計・表示
// ---------------------------------------------------------------------------

/** 対象の表示名（ドライバー名 → 車両番号の順。どちらも無ければ ""） */
export function documentTarget(row: Pick<FleetDocument, "driverName" | "vehiclePlate">): string {
  return row.driverName || row.vehiclePlate || "";
}

/** 書類の名前（label が空なら種類の表示名） */
export function documentTitle(row: Pick<FleetDocument, "kind" | "label">): string {
  return row.label || DOCUMENT_KIND_LABELS[row.kind] || "書類";
}

/**
 * 期限切れ → まもなく期限 → 有効 → 期限なし の順。各グループの中は期限が近い順。
 * 同じ期限なら対象名・書類名で安定させる（元の配列は変更しない）。
 */
export function sortDocuments<T extends FleetDocument>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byStatus = EXPIRY_ORDER[a.status] - EXPIRY_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.expiresOn !== b.expiresOn) {
      if (!a.expiresOn) return 1;
      if (!b.expiresOn) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    }
    const target = documentTarget(a).localeCompare(documentTarget(b), "ja");
    if (target !== 0) return target;
    return documentTitle(a).localeCompare(documentTitle(b), "ja");
  });
}

export interface ExpiryCounts {
  expired: number;
  soon: number;
  valid: number;
  none: number;
}

/** 状態ごとの件数 */
export function countExpiry(rows: Pick<FleetDocument, "status">[]): ExpiryCounts {
  const counts: ExpiryCounts = { expired: 0, soon: 0, valid: 0, none: 0 };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

/** 名指しの案内（「足立 480 あ 12-34 の車検証が 3 日前に切れています」） */
export function expiryMessage(row: FleetDocument): string {
  const target = documentTarget(row);
  const who = target ? `${target} の` : "";
  const title = documentTitle(row);
  if (row.status === "expired" && row.daysLeft != null) return `${who}${title}が ${-row.daysLeft} 日前に切れています`;
  if (row.status === "soon" && row.daysLeft != null) {
    return row.daysLeft === 0 ? `${who}${title}は今日が期限です` : `${who}${title}はあと ${row.daysLeft} 日で期限です`;
  }
  return `${who}${title}`;
}

// ---------------------------------------------------------------------------
// 指導・監督（初任運転者）
// ---------------------------------------------------------------------------

export interface DriverLike {
  id: string;
  name: string;
  /** 省略時は稼働中として扱う */
  is_active?: boolean;
}

export interface InstructionLike {
  driver_id: string;
  kind: string;
}

/**
 * 初任運転者の指導の記録が無いドライバー（稼働中のみ）。
 * 初任運転者には運転させる前に 15 時間以上の特別な指導が必要で、記録は 3 年間保存する。
 */
export function missingInitialInstruction<T extends DriverLike>(drivers: T[], instructions: InstructionLike[]): T[] {
  const done = new Set(instructions.filter((i) => i.kind === "initial").map((i) => i.driver_id));
  return drivers.filter((d) => d.is_active !== false && !done.has(d.id));
}

// ---------------------------------------------------------------------------
// 安全管理者の講習
// ---------------------------------------------------------------------------

export interface SafetyManagerLike {
  /** 講習の受講日 */
  training_on?: string | null;
  /** 次回講習の期限（入っていればこちらが優先） */
  training_expires_on?: string | null;
}

export interface TrainingDue {
  /** 次回講習の期限 "YYYY-MM-DD"（分からなければ null） */
  dueOn: string | null;
  daysLeft: number | null;
  status: ExpiryStatus;
}

/**
 * 次回講習の期限（training_expires_on があればそれ、無ければ受講日の 2 年後）と残り日数。
 * どちらも未入力なら status = "none"。
 */
export function nextTrainingDue(manager: SafetyManagerLike, today: string, reminderDays: number = DEFAULT_REMINDER_DAYS): TrainingDue {
  const explicit = manager.training_expires_on && isDateString(manager.training_expires_on) ? manager.training_expires_on : null;
  const fromTraining = manager.training_on && isDateString(manager.training_on) ? addYearsToDate(manager.training_on, TRAINING_INTERVAL_YEARS) : null;
  const dueOn = explicit ?? fromTraining;
  const state = expiryState(dueOn, reminderDays, today);
  return { dueOn, daysLeft: state.daysLeft, status: state.status };
}

// ---------------------------------------------------------------------------
// 事故の発生日時（timestamptz ↔ datetime-local）
// ---------------------------------------------------------------------------

const LOCAL_DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;

/** "YYYY-MM-DDTHH:mm"（日本時間）か */
export function isLocalDateTime(s: unknown): s is string {
  return typeof s === "string" && LOCAL_DATETIME_RE.test(s) && isDateString(s.slice(0, 10));
}

/** datetime-local の値（日本時間）→ DB に渡す ISO 文字列。不正なら null */
export function localInputToIso(local: string | null | undefined): string | null {
  if (!isLocalDateTime(local)) return null;
  return `${local}:00+09:00`;
}

/** DB の timestamptz → datetime-local の値（日本時間）。不正なら "" */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${isoOf(jst)}T${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`;
}

/** 発生日時の表示（"2026/09/19 14:30"）。不正・未入力は "—" */
export function formatDateTime(iso: string | null | undefined): string {
  const local = isoToLocalInput(iso);
  if (!local) return "—";
  return `${local.slice(0, 10).replace(/-/g, "/")} ${local.slice(11)}`;
}

// ---------------------------------------------------------------------------
// 画面から使う URL
// ---------------------------------------------------------------------------

/** 車両と書類の画面（?tab= を引き継ぐ。稼動月には依存しない） */
export function fleetTabHref(tab: "vehicles" | "documents"): string {
  return `/fleet?tab=${tab}`;
}

/** 車両 / 書類 CSV のダウンロード URL（app/api/export/fleet.csv） */
export function fleetCsvUrl(kind: "vehicle" | "document"): string {
  return `/api/export/fleet.csv?kind=${kind}`;
}
