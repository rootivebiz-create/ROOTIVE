/**
 * 採用（応募者）と業務委託契約の純関数（React・DB に依存しない。画面・CSV 出力・テストから使う）
 *
 * - 日付は "YYYY-MM-DD"（日本時間）。Intl・ローカルタイムゾーンに頼らず自前で計算する
 *   （サーバーとブラウザで同じ結果になるよう、「今日」は必ず引数で渡す）
 * - DB ビュー（v_applicant_list / v_contract_list）の null を画面用の型へ正規化してから使う
 */
import {
  APPLICANT_STAGES,
  APPLICANT_STAGE_LABELS,
  CONTRACT_PERIOD_LABELS,
  type ApplicantRow,
  type ApplicantStage,
  type ContractRow,
  type ContractStatus,
} from "@/lib/db/types";
import { isDateString } from "@/lib/schemas/common";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** フォロー漏れとみなす日数（最後のやりとりからこの日数以上動いていない） */
export const STALE_DAYS = 10;

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/** 日本時間の今日 "YYYY-MM-DD" */
export function todayJST(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" として実在する日付か */
// 日付の判定は lib/schemas/common.ts が正（0025 でまとめた）。ここから読んでいる箇所があるので再輸出する
export { isDateString };

/** from → to の日数（同じ日は 0、to が後なら正）。どちらかが不正なら null */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!isDateString(from) || !isDateString(to)) return null;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

/** 日付の "YYYY-MM-DD" ＋ 日本時間 0 時の ISO（契約の合意日など timestamptz 列へ入れる用） */
export function jstDateToIso(date: string | null | undefined): string | null {
  if (!isDateString(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - JST_OFFSET_MS).toISOString();
}

/** ISO（timestamptz）→ 日本時間の "YYYY-MM-DD"。空・不正は "" */
export function isoToJstDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 必要書類のチェックリスト（applicants.checklist）
// ---------------------------------------------------------------------------

/** 稼働開始までに揃える書類（この 4 つだけを正とする） */
export const CHECKLIST_ITEMS = [
  { key: "license", label: "運転免許証" },
  { key: "vehicle", label: "車検証" },
  { key: "insurance", label: "任意保険証券" },
  { key: "black_plate", label: "黒ナンバーの届出" },
] as const;

export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];

/** チェックリストの key の一覧（表示順） */
export const CHECKLIST_KEYS: ChecklistKey[] = CHECKLIST_ITEMS.map((i) => i.key);

/** 4 項目ぶんの真偽値（未入力は false） */
export type Checklist = Record<ChecklistKey, boolean>;

export function isChecklistKey(value: unknown): value is ChecklistKey {
  return typeof value === "string" && (CHECKLIST_KEYS as string[]).includes(value);
}

/** チェックリストの項目名（未知の key はそのまま返す） */
export function checklistLabel(key: string): string {
  return CHECKLIST_ITEMS.find((i) => i.key === key)?.label ?? key;
}

/** jsonb（何が入っているか分からない）→ 4 項目の真偽値。true だけを「済み」とみなす */
export function toChecklist(raw: unknown): Checklist {
  const src = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Checklist;
  for (const key of CHECKLIST_KEYS) out[key] = src[key] === true;
  return out;
}

/** 書類の進み具合（done / total と、4 つすべて揃ったか） */
export function checklistProgress(raw: unknown): { done: number; total: number; complete: boolean } {
  const checklist = toChecklist(raw);
  const done = CHECKLIST_KEYS.filter((k) => checklist[k]).length;
  const total = CHECKLIST_KEYS.length;
  return { done, total, complete: done === total };
}

/** カードに出す短い表記："2/4" */
export function checklistText(raw: unknown): string {
  const { done, total } = checklistProgress(raw);
  return `${done}/${total}`;
}

/** 足りていない書類の名前（「あと何が要るか」の表示用） */
export function missingChecklistLabels(raw: unknown): string[] {
  const checklist = toChecklist(raw);
  return CHECKLIST_ITEMS.filter((i) => !checklist[i.key]).map((i) => i.label);
}

// ---------------------------------------------------------------------------
// 段階（applicant_stage）
// ---------------------------------------------------------------------------

/** 選考中（離脱していない）段階。パイプラインの並び順でもある */
export const activeStages: ApplicantStage[] = ["applied", "contacted", "interview", "docs", "contract", "started"];

/** 離脱した段階（本人辞退・見送り） */
export const closedStages: ApplicantStage[] = ["declined", "rejected"];

/** まだ稼働開始していない＝対応が必要な段階（フォロー漏れ・選考中の件数はこれで数える） */
export const openStages: ApplicantStage[] = ["applied", "contacted", "interview", "docs", "contract"];

export function isActiveStage(stage: ApplicantStage | null | undefined): boolean {
  return stage != null && activeStages.includes(stage);
}
export function isClosedStage(stage: ApplicantStage | null | undefined): boolean {
  return stage != null && closedStages.includes(stage);
}
export function isOpenStage(stage: ApplicantStage | null | undefined): boolean {
  return stage != null && openStages.includes(stage);
}

export function stageLabel(stage: ApplicantStage): string {
  return APPLICANT_STAGE_LABELS[stage];
}

/** 次に進む段階（稼働開始・離脱の先は無い） */
export function nextStage(stage: ApplicantStage): ApplicantStage | null {
  const i = activeStages.indexOf(stage);
  if (i < 0 || i >= activeStages.length - 1) return null;
  return activeStages[i + 1];
}

/** ひとつ前に戻す段階（応募・離脱の前は無い） */
export function prevStage(stage: ApplicantStage): ApplicantStage | null {
  const i = activeStages.indexOf(stage);
  if (i <= 0) return null;
  return activeStages[i - 1];
}

// ---------------------------------------------------------------------------
// 応募者（画面用の型）
// ---------------------------------------------------------------------------

/** 画面で扱う応募者の 1 件（ビューの null を正規化したもの） */
export interface ApplicantView {
  id: string;
  name: string;
  kana: string;
  phone: string;
  email: string;
  source: string;
  stage: ApplicantStage;
  /** "YYYY-MM-DD" */
  appliedOn: string;
  /** "" = 未定 */
  interviewOn: string;
  /** "" = 未定 */
  startedOn: string;
  /** "" = 未登録 */
  driverId: string;
  driverName: string;
  checklist: Checklist;
  memo: string;
  /** やりとりの件数（段階の変更もトリガーで記録される） */
  eventCount: number;
  /** 最後のやりとりの日（"" = まだ無い） */
  lastEventOn: string;
  /** 応募日からの日数（DB の current_date 基準） */
  daysSinceApplied: number;
}

export function toApplicantView(r: ApplicantRow): ApplicantView {
  return {
    id: r.id ?? "",
    name: r.name ?? "",
    kana: r.kana ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    source: r.source ?? "",
    stage: (r.stage ?? "applied") as ApplicantStage,
    appliedOn: r.applied_on ?? "",
    interviewOn: r.interview_on ?? "",
    startedOn: r.started_on ?? "",
    driverId: r.driver_id ?? "",
    driverName: r.driver_name ?? "",
    checklist: toChecklist(r.checklist),
    memo: r.memo ?? "",
    eventCount: Number(r.event_count ?? 0),
    lastEventOn: r.last_event_on ?? "",
    daysSinceApplied: Number(r.days_since_applied ?? 0),
  };
}

/** やりとり 1 件（applicant_events）の画面用の型 */
export interface ApplicantEventView {
  id: string;
  applicantId: string;
  happenedOn: string;
  stage: ApplicantStage | null;
  note: string;
}

/** 段階の絞り込みに必要な最小限の形 */
export interface ApplicantLike {
  stage: ApplicantStage;
  /** "YYYY-MM-DD" */
  appliedOn: string;
  /** 最後のやりとりの日（無ければ "" / null） */
  lastEventOn?: string | null;
}

/** 最後に動いた日（やりとりが無ければ応募日） */
export function lastActivityOn(a: ApplicantLike): string {
  return a.lastEventOn && isDateString(a.lastEventOn) ? a.lastEventOn : a.appliedOn;
}

/** 最後に動いてからの日数（判定できなければ null） */
export function daysSinceActivity(a: ApplicantLike, today: string): number | null {
  return daysBetween(lastActivityOn(a), today);
}

/**
 * フォロー漏れ：最後のやりとりから days 日以上動いていない「選考中（まだ稼働開始していない）」応募者。
 * 動いていない順（古い順）に並べる。離脱・稼働開始済みは含めない。
 */
export function staleApplicants<T extends ApplicantLike>(applicants: T[], today: string, days: number = STALE_DAYS): T[] {
  return applicants
    .filter((a) => {
      if (!isOpenStage(a.stage)) return false;
      const d = daysSinceActivity(a, today);
      return d != null && d >= days;
    })
    .sort((a, b) => {
      const c = lastActivityOn(a).localeCompare(lastActivityOn(b));
      return c !== 0 ? c : a.appliedOn.localeCompare(b.appliedOn);
    });
}

/** 段階ごとのまとまり（パイプライン表示の 1 列 ／ スマホの 1 ブロック） */
export interface StageGroup<T> {
  stage: ApplicantStage;
  label: string;
  applicants: T[];
  count: number;
}

/**
 * 段階ごとに分ける（既定は APPLICANT_STAGES の順。空の段階も 0 件のまとまりとして返す）。
 * 各まとまりの中の並びは渡された配列の順のまま。
 */
export function groupByStage<T extends { stage: ApplicantStage }>(
  applicants: T[],
  stages: ApplicantStage[] = APPLICANT_STAGES,
): StageGroup<T>[] {
  return stages.map((stage) => {
    const rows = applicants.filter((a) => a.stage === stage);
    return { stage, label: APPLICANT_STAGE_LABELS[stage], applicants: rows, count: rows.length };
  });
}

// ---------------------------------------------------------------------------
// 業務委託契約（画面用の型）
// ---------------------------------------------------------------------------

/** v_contract_list.period_status */
export type ContractPeriodStatus = "active" | "renewal" | "expired" | "open" | "ended";

const PERIOD_STATUSES: ContractPeriodStatus[] = ["active", "renewal", "expired", "open", "ended"];

export function toPeriodStatus(value: string | null | undefined): ContractPeriodStatus {
  return PERIOD_STATUSES.includes(value as ContractPeriodStatus) ? (value as ContractPeriodStatus) : "open";
}

export function periodLabel(status: ContractPeriodStatus): string {
  return CONTRACT_PERIOD_LABELS[status] ?? status;
}

/** 画面で扱う契約の 1 件（ビューの null を正規化したもの） */
export interface ContractView {
  id: string;
  driverId: string;
  driverName: string;
  driverIsActive: boolean;
  title: string;
  status: ContractStatus;
  /** "YYYY-MM-DD" */
  startOn: string;
  /** "" = 期限なし */
  endOn: string;
  autoRenew: boolean;
  noticeDays: number;
  /** "" = 未登録 */
  filePath: string;
  /** 合意日 "YYYY-MM-DD"（"" = 未入力） */
  agreedOn: string;
  memo: string;
  /** 終了日までの残り日数（期限なしは null。過ぎていればマイナス） */
  daysLeft: number | null;
  periodStatus: ContractPeriodStatus;
}

export function toContractView(r: ContractRow): ContractView {
  return {
    id: r.id ?? "",
    driverId: r.driver_id ?? "",
    driverName: r.driver_name ?? "",
    driverIsActive: r.driver_is_active === true,
    title: r.title ?? "",
    status: (r.status ?? "active") as ContractStatus,
    startOn: r.start_on ?? "",
    endOn: r.end_on ?? "",
    autoRenew: r.auto_renew === true,
    noticeDays: Number(r.notice_days ?? 0),
    filePath: r.file_path ?? "",
    agreedOn: isoToJstDate(r.agreed_at),
    memo: r.memo ?? "",
    daysLeft: r.days_left == null ? null : Number(r.days_left),
    periodStatus: toPeriodStatus(r.period_status),
  };
}

/** 警告に出す契約の最小限の形 */
export interface ContractLike {
  periodStatus: ContractPeriodStatus;
  daysLeft: number | null;
}

/**
 * 更新時期・期間切れの契約。
 * 更新時期は残り日数の少ない順、期間切れは過ぎている日数の多い順（どちらも「急ぐ順」）。
 */
export function contractAlerts<T extends ContractLike>(contracts: T[]): { renewal: T[]; expired: T[] } {
  const byDaysLeft = (a: T, b: T) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
  return {
    renewal: contracts.filter((c) => c.periodStatus === "renewal").sort(byDaysLeft),
    expired: contracts.filter((c) => c.periodStatus === "expired").sort(byDaysLeft),
  };
}

/**
 * 一覧の並び：期限が近い順。
 * 終了した契約はいちばん後ろ、期限なし（end_on が無い）はその手前に置く。
 */
export function sortContracts<T extends ContractLike>(contracts: T[]): T[] {
  const rank = (c: T) => (c.periodStatus === "ended" ? 2 : c.daysLeft == null ? 1 : 0);
  return [...contracts].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
  });
}

/** 警告の文面："あと 12 日で更新時期です" / "期間が切れています（5 日経過）" */
export function contractAlertText(c: ContractLike): string {
  if (c.periodStatus === "expired") {
    const over = c.daysLeft == null ? null : -c.daysLeft;
    return over != null && over > 0 ? `期間が切れています（${over} 日経過）` : "期間が切れています";
  }
  if (c.periodStatus === "renewal") {
    if (c.daysLeft == null) return "更新時期です";
    if (c.daysLeft <= 0) return "今日が期間の最終日です";
    return `あと ${c.daysLeft} 日で更新時期です`;
  }
  return periodLabel(c.periodStatus);
}

/** 契約の有無を数えるときの最小限の形 */
export interface ContractDriverLike {
  driverId: string;
  status: ContractStatus;
}

/** ドライバーの最小限の形（drivers テーブルの行） */
export interface DriverLike {
  id: string;
  name: string;
  is_active: boolean;
}

/**
 * 稼働中なのに有効な契約（下書き・有効）が 1 件も無いドライバー。
 * 終了した契約しか無い人も「契約が無い」として出す（更新を促すため）。
 */
export function driversWithoutContract<D extends DriverLike>(drivers: D[], contracts: ContractDriverLike[]): D[] {
  const withContract = new Set(contracts.filter((c) => c.status !== "ended").map((c) => c.driverId));
  return drivers.filter((d) => d.is_active && !withContract.has(d.id));
}

// ---------------------------------------------------------------------------
// ダッシュボード用のまとめ
// ---------------------------------------------------------------------------

export interface HrCounts {
  /** 選考中（まだ稼働開始していない）応募者 */
  inProgress: number;
  /** フォロー漏れ（10 日以上動いていない） */
  stale: number;
  /** 更新時期が来ている契約 */
  renewal: number;
  /** 期間が切れている契約 */
  expired: number;
}

export const ZERO_HR_COUNTS: HrCounts = { inProgress: 0, stale: 0, renewal: 0, expired: 0 };

/** ダッシュボードのカードに出す件数（すべて 0 なら「対応が必要なものはありません」） */
export function hrCounts(applicants: ApplicantLike[], contracts: ContractLike[], today: string, days: number = STALE_DAYS): HrCounts {
  const alerts = contractAlerts(contracts);
  return {
    inProgress: applicants.filter((a) => isOpenStage(a.stage)).length,
    stale: staleApplicants(applicants, today, days).length,
    renewal: alerts.renewal.length,
    expired: alerts.expired.length,
  };
}

/** 対応が必要なものがあるか（カード・バッジの出し分け） */
export function hasHrAttention(counts: HrCounts): boolean {
  return counts.inProgress > 0 || counts.stale > 0 || counts.renewal > 0 || counts.expired > 0;
}
