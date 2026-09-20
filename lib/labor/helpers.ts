/**
 * 労務（拘束時間・実働・休息期間・連続勤務）の純関数
 *
 * - 計算はすべて「分（整数）」で行い、表示するときだけ formatMinutes() を通す
 * - 判定（ok / over / severe / short / unknown）は DB ビュー v_daily_labor / v_driver_month_labor が付けた値をそのまま使う
 *   （画面側で判定をやり直さない。しきい値は companies.labor_* で、ビューが行に持たせている）
 * - 金額は扱わない
 */
import { LABOR_BREAK_LABELS, LABOR_DUTY_LABELS, LABOR_REST_LABELS } from "@/lib/db/types";

/** 1 時間 = 60 分 */
export const MINUTES_PER_HOUR = 60;

// ---------------------------------------------------------------------------
// 基準値
// ---------------------------------------------------------------------------

/** 労務の基準（companies.labor_* と同じ並び） */
export interface LaborStandards {
  /** 1 日の拘束時間の目安（分） */
  labor_duty_limit_minutes: number;
  /** 1 日の拘束時間の上限（分） */
  labor_duty_max_minutes: number;
  /** 休息期間の目安（分） */
  labor_rest_target_minutes: number;
  /** 休息期間の下限（分） */
  labor_rest_min_minutes: number;
  /** 1 か月の拘束時間の上限（分） */
  labor_month_duty_minutes: number;
  /** 連続勤務の日数の上限 */
  labor_max_consecutive_days: number;
}

/** 改善基準告示に合わせた既定値（マイグレーション 0018 の既定と同じ） */
export const DEFAULT_LABOR_STANDARDS: LaborStandards = {
  labor_duty_limit_minutes: 780,
  labor_duty_max_minutes: 900,
  labor_rest_target_minutes: 660,
  labor_rest_min_minutes: 540,
  labor_month_duty_minutes: 17040,
  labor_max_consecutive_days: 13,
};

// ---------------------------------------------------------------------------
// 数値・時間の道具
// ---------------------------------------------------------------------------

/** 有限な数値だけを取り出す（null・NaN・数値でないものは null） */
function finite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 数値（未入力・不正は 0） */
function num(v: number | null | undefined): number {
  return finite(v) ?? 0;
}

/**
 * 分を「13 時間 20 分」の形に。未入力・数値でないものは "—"
 * 0 は "0 分"、ちょうどの時間は "13 時間"、1 時間未満は "45 分"、負の値は先頭に "-"
 */
export function formatMinutes(min: number | null | undefined): string {
  const v = finite(min);
  if (v == null) return "—";
  const total = Math.round(v);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const h = Math.floor(abs / MINUTES_PER_HOUR);
  const m = abs % MINUTES_PER_HOUR;
  if (h === 0) return `${sign}${m} 分`;
  if (m === 0) return `${sign}${h} 時間`;
  return `${sign}${h} 時間 ${m} 分`;
}

/** 分 → 時間（小数 2 桁まで）。未入力は null */
export function minutesToHours(min: number | null | undefined): number | null {
  const v = finite(min);
  if (v == null) return null;
  return Math.round((v / MINUTES_PER_HOUR) * 100) / 100;
}

/** 時間 → 分（整数に丸める）。未入力は null */
export function hoursToMinutes(hours: number | null | undefined): number | null {
  const v = finite(hours);
  if (v == null) return null;
  return Math.round(v * MINUTES_PER_HOUR);
}

/** 設定画面の入力欄に出す時間の文字列（780 → "13"、810 → "13.5"）。未入力は "" */
export function minutesToHoursInput(min: number | null | undefined): string {
  const h = minutesToHours(min);
  return h == null ? "" : String(h);
}

/** 労働基準法の目安：実働 6 時間超で 45 分、8 時間超で 60 分（v_daily_labor.break_status と同じルール） */
export function requiredBreakMinutes(workMinutes: number | null | undefined): number {
  const v = finite(workMinutes);
  if (v == null) return 0;
  if (v > 480) return 60;
  if (v > 360) return 45;
  return 0;
}

// ---------------------------------------------------------------------------
// 判定の色とラベル
// ---------------------------------------------------------------------------

/** 判定の種類（ラベルの辞書が異なる） */
export type LaborStatusKind = "duty" | "rest" | "break";

/** 表示の色：normal＝通常、warning＝注意、danger＝危険、muted＝判定できない */
export type LaborTone = "normal" | "warning" | "danger" | "muted";

export interface LaborToneInfo {
  tone: LaborTone;
  /** 日本語のラベル（"問題なし" / "長い" など） */
  label: string;
}

const TONE_BY_STATUS: Record<string, LaborTone> = {
  ok: "normal",
  over: "warning",
  short: "warning",
  severe: "danger",
  unknown: "muted",
};

const LABELS_BY_KIND: Record<LaborStatusKind, Record<string, string>> = {
  duty: LABOR_DUTY_LABELS,
  rest: LABOR_REST_LABELS,
  break: LABOR_BREAK_LABELS,
};

/**
 * 判定 → 表示の色と日本語ラベル
 * kind を省くと拘束時間のラベルを使う。知らない判定は muted ＋ "—"
 */
export function laborTone(status: string | null | undefined, kind: LaborStatusKind = "duty"): LaborToneInfo {
  const key = typeof status === "string" && status !== "" ? status : "unknown";
  const tone = TONE_BY_STATUS[key] ?? "muted";
  const label = LABELS_BY_KIND[kind][key] ?? "—";
  return { tone, label };
}

// ---------------------------------------------------------------------------
// 日ごとの行
// ---------------------------------------------------------------------------

/** 日ごとの労務（v_daily_labor の 1 行でもよい） */
export interface DailyLaborLike {
  work_date?: string | null;
  driver_id?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  break_minutes?: number | null;
  duty_minutes?: number | null;
  work_minutes?: number | null;
  rest_minutes?: number | null;
  consecutive_days?: number | null;
  labor_duty_limit_minutes?: number | null;
  labor_duty_max_minutes?: number | null;
  labor_rest_target_minutes?: number | null;
  labor_rest_min_minutes?: number | null;
  duty_status?: string | null;
  rest_status?: string | null;
  break_status?: string | null;
}

/** 注意が必要な日か（拘束が長い・休息が足りない・休憩が足りない・連続勤務が上限超） */
export function isAttentionDay(row: DailyLaborLike | null | undefined, maxConsecutiveDays = DEFAULT_LABOR_STANDARDS.labor_max_consecutive_days): boolean {
  if (!row) return false;
  if (row.duty_status === "over" || row.duty_status === "severe") return true;
  if (row.rest_status === "short" || row.rest_status === "severe") return true;
  if (row.break_status === "short") return true;
  return num(row.consecutive_days) > num(maxConsecutiveDays);
}

/** 注意が必要な日だけに絞り込む */
export function attentionDays<T extends DailyLaborLike>(rows: readonly T[] | null | undefined, maxConsecutiveDays?: number): T[] {
  return (rows ?? []).filter((r) => isAttentionDay(r, maxConsecutiveDays));
}

/**
 * その日の 1 行アドバイス（具体的な数字を入れる）。言うことが無ければ ""
 * 休息 → 拘束 → 休憩 → 連続勤務 の順に、重いものから 1 つだけ返す
 */
export function laborAdvice(row: DailyLaborLike | null | undefined, maxConsecutiveDays = DEFAULT_LABOR_STANDARDS.labor_max_consecutive_days): string {
  return laborAdviceLines(row, maxConsecutiveDays)[0] ?? "";
}

/** その日のアドバイスをすべて（重いものから並べる） */
export function laborAdviceLines(row: DailyLaborLike | null | undefined, maxConsecutiveDays = DEFAULT_LABOR_STANDARDS.labor_max_consecutive_days): string[] {
  if (!row) return [];
  const out: string[] = [];

  const rest = finite(row.rest_minutes);
  const restMin = finite(row.labor_rest_min_minutes) ?? DEFAULT_LABOR_STANDARDS.labor_rest_min_minutes;
  const restTarget = finite(row.labor_rest_target_minutes) ?? DEFAULT_LABOR_STANDARDS.labor_rest_target_minutes;
  if (rest != null && row.rest_status === "severe") {
    const need = Math.max(restMin - rest, 0);
    out.push(`休息が ${formatMinutes(rest)}です。翌日の開始を ${formatMinutes(need)}遅らせると ${formatMinutes(restMin)}を確保できます。`);
  } else if (rest != null && row.rest_status === "short") {
    const need = Math.max(restTarget - rest, 0);
    out.push(`休息が ${formatMinutes(rest)}です。あと ${formatMinutes(need)}空けると目安の ${formatMinutes(restTarget)}になります。`);
  }

  const duty = finite(row.duty_minutes);
  const dutyLimit = finite(row.labor_duty_limit_minutes) ?? DEFAULT_LABOR_STANDARDS.labor_duty_limit_minutes;
  const dutyMax = finite(row.labor_duty_max_minutes) ?? DEFAULT_LABOR_STANDARDS.labor_duty_max_minutes;
  if (duty != null && row.duty_status === "severe") {
    const over = Math.max(duty - dutyMax, 0);
    out.push(`拘束が ${formatMinutes(duty)}で、上限の ${formatMinutes(dutyMax)}を ${formatMinutes(over)}超えています。配送の件数を分けるか、翌日の開始を遅らせてください。`);
  } else if (duty != null && row.duty_status === "over") {
    const over = Math.max(duty - dutyLimit, 0);
    out.push(`拘束が ${formatMinutes(duty)}で、目安の ${formatMinutes(dutyLimit)}を ${formatMinutes(over)}超えています。終了を早めるか、翌日の開始を遅らせてください。`);
  }

  if (row.break_status === "short") {
    const work = finite(row.work_minutes);
    const need = requiredBreakMinutes(work);
    const taken = num(row.break_minutes);
    const lack = Math.max(need - taken, 0);
    if (need > 0 && lack > 0) {
      out.push(`実働 ${formatMinutes(work)}に対して休憩が ${formatMinutes(taken)}です。あと ${formatMinutes(lack)}休憩を取ってください。`);
    } else {
      out.push(`休憩が足りていません。実働 6 時間超で 45 分、8 時間超で 60 分を目安にしてください。`);
    }
  }

  const streak = finite(row.consecutive_days);
  const maxDays = num(maxConsecutiveDays);
  if (streak != null && maxDays > 0 && streak > maxDays) {
    out.push(`連続勤務が ${streak} 日目です。上限の ${maxDays} 日を超えているので、すぐに休みを入れてください。`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// 月のまとめ
// ---------------------------------------------------------------------------

/** ドライバー × 月の労務（v_driver_month_labor の 1 行でもよい） */
export interface MonthLaborLike {
  driver_id?: string | null;
  driver_name?: string | null;
  report_days?: number | null;
  measured_days?: number | null;
  duty_minutes_total?: number | null;
  duty_minutes_avg?: number | null;
  duty_minutes_max?: number | null;
  work_minutes_total?: number | null;
  distance_km_total?: number | null;
  over_duty_days?: number | null;
  severe_duty_days?: number | null;
  short_rest_days?: number | null;
  severe_rest_days?: number | null;
  short_break_days?: number | null;
  max_consecutive_days?: number | null;
  labor_month_duty_minutes?: number | null;
  labor_max_consecutive_days?: number | null;
  month_duty_over?: boolean | null;
  consecutive_over?: boolean | null;
}

/** 月の労務のまとめ（画面上部のカード用） */
export interface MonthLaborSummary {
  /** 日報が 1 件でもあるドライバーの人数 */
  driverCount: number;
  /** 日報の件数 */
  reportDays: number;
  /** 開始・終了の時刻が入っていて拘束時間を出せた日数（対象日数） */
  measuredDays: number;
  /** 拘束の合計（分） */
  dutyMinutesTotal: number;
  /** 拘束の平均（分／対象日数。対象日数が 0 なら 0） */
  dutyMinutesAvg: number;
  /** 拘束の最大（分） */
  dutyMinutesMax: number;
  /** 実働の合計（分） */
  workMinutesTotal: number;
  /** 走行距離の合計 */
  distanceKmTotal: number;
  /** 拘束が目安を超えた日数（上限超も含む） */
  overDutyDays: number;
  /** 拘束が上限を超えた日数 */
  severeDutyDays: number;
  /** 休息が目安を下回った日数（下限割れも含む） */
  shortRestDays: number;
  /** 休息が下限を下回った日数 */
  severeRestDays: number;
  /** 休憩が足りない日数 */
  shortBreakDays: number;
  /** 連続勤務の最大（日） */
  maxConsecutiveDays: number;
  /** 1 か月の拘束が上限を超えたドライバーの人数 */
  monthDutyOverDrivers: number;
  /** 連続勤務が上限を超えたドライバーの人数 */
  consecutiveOverDrivers: number;
}

/** ドライバー × 月の行から、その月の合計を出す */
export function monthLaborSummary(rows: readonly MonthLaborLike[] | null | undefined): MonthLaborSummary {
  const out: MonthLaborSummary = {
    driverCount: 0,
    reportDays: 0,
    measuredDays: 0,
    dutyMinutesTotal: 0,
    dutyMinutesAvg: 0,
    dutyMinutesMax: 0,
    workMinutesTotal: 0,
    distanceKmTotal: 0,
    overDutyDays: 0,
    severeDutyDays: 0,
    shortRestDays: 0,
    severeRestDays: 0,
    shortBreakDays: 0,
    maxConsecutiveDays: 0,
    monthDutyOverDrivers: 0,
    consecutiveOverDrivers: 0,
  };

  for (const r of rows ?? []) {
    if (!r) continue;
    out.driverCount += 1;
    out.reportDays += num(r.report_days);
    out.measuredDays += num(r.measured_days);
    out.dutyMinutesTotal += num(r.duty_minutes_total);
    out.dutyMinutesMax = Math.max(out.dutyMinutesMax, num(r.duty_minutes_max));
    out.workMinutesTotal += num(r.work_minutes_total);
    out.distanceKmTotal += num(r.distance_km_total);
    // ビューは 'over' と 'severe' を別々に数えているので、画面では「目安超え」にまとめて出す
    out.overDutyDays += num(r.over_duty_days) + num(r.severe_duty_days);
    out.severeDutyDays += num(r.severe_duty_days);
    out.shortRestDays += num(r.short_rest_days) + num(r.severe_rest_days);
    out.severeRestDays += num(r.severe_rest_days);
    out.shortBreakDays += num(r.short_break_days);
    out.maxConsecutiveDays = Math.max(out.maxConsecutiveDays, num(r.max_consecutive_days));
    if (r.month_duty_over === true) out.monthDutyOverDrivers += 1;
    if (r.consecutive_over === true) out.consecutiveOverDrivers += 1;
  }

  out.dutyMinutesAvg = out.measuredDays > 0 ? Math.round(out.dutyMinutesTotal / out.measuredDays) : 0;
  return out;
}

// ---------------------------------------------------------------------------
// リスクの判定
// ---------------------------------------------------------------------------

/** 危険度 */
export type LaborRiskLevel = "good" | "caution" | "danger";

export interface LaborRisk {
  level: LaborRiskLevel;
  /** 日本語のラベル（"良好" / "注意" / "危険"） */
  label: string;
  /** そう判定した理由（重いものから） */
  reasons: string[];
  /** 理由を 1 行にまとめたもの（理由が無ければ ""） */
  summary: string;
}

export const LABOR_RISK_LABELS: Record<LaborRiskLevel, string> = {
  good: "良好",
  caution: "注意",
  danger: "危険",
};

function risk(level: LaborRiskLevel, reasons: string[]): LaborRisk {
  return { level, label: LABOR_RISK_LABELS[level], reasons, summary: reasons.join(" ") };
}

/**
 * ドライバー × 月の労務から「良好 / 注意 / 危険」を判定する
 * - 危険：拘束が上限超の日がある／休息が下限割れの日がある／1 か月の拘束が上限超／連続勤務が上限超
 * - 注意：拘束が目安超の日がある／休息が目安割れの日がある／休憩が足りない日がある
 */
export function laborRiskLevel(monthRow: MonthLaborLike | null | undefined): LaborRisk {
  if (!monthRow) return risk("good", []);

  const severeDuty = num(monthRow.severe_duty_days);
  const severeRest = num(monthRow.severe_rest_days);
  const overDuty = num(monthRow.over_duty_days);
  const shortRest = num(monthRow.short_rest_days);
  const shortBreak = num(monthRow.short_break_days);
  const streak = num(monthRow.max_consecutive_days);
  const maxStreak = finite(monthRow.labor_max_consecutive_days) ?? DEFAULT_LABOR_STANDARDS.labor_max_consecutive_days;
  const monthLimit = finite(monthRow.labor_month_duty_minutes) ?? DEFAULT_LABOR_STANDARDS.labor_month_duty_minutes;
  const dutyTotal = num(monthRow.duty_minutes_total);
  const monthOver = monthRow.month_duty_over === true || (monthRow.month_duty_over == null && dutyTotal > monthLimit);
  const streakOver = monthRow.consecutive_over === true || (monthRow.consecutive_over == null && streak > maxStreak);

  const danger: string[] = [];
  if (severeRest > 0) danger.push(`休息が下限を下回った日が ${severeRest} 日あります。`);
  if (severeDuty > 0) danger.push(`拘束が上限を超えた日が ${severeDuty} 日あります。`);
  if (monthOver) danger.push(`1 か月の拘束が ${formatMinutes(dutyTotal)}で、上限の ${formatMinutes(monthLimit)}を超えています。`);
  if (streakOver) danger.push(`連続勤務が ${streak} 日で、上限の ${maxStreak} 日を超えています。`);
  if (danger.length > 0) return risk("danger", danger);

  const caution: string[] = [];
  if (overDuty > 0) caution.push(`拘束が目安を超えた日が ${overDuty} 日あります。`);
  if (shortRest > 0) caution.push(`休息が目安を下回った日が ${shortRest} 日あります。`);
  if (shortBreak > 0) caution.push(`休憩が足りない日が ${shortBreak} 日あります。`);
  if (caution.length > 0) return risk("caution", caution);

  return risk("good", []);
}

/** 月のまとめ（全ドライバー）から「良好 / 注意 / 危険」を判定する */
export function summaryRiskLevel(summary: MonthLaborSummary | null | undefined): LaborRisk {
  if (!summary || summary.measuredDays === 0) return risk("good", []);

  const danger: string[] = [];
  if (summary.severeRestDays > 0) danger.push(`休息が下限を下回った日が ${summary.severeRestDays} 日あります。`);
  if (summary.severeDutyDays > 0) danger.push(`拘束が上限を超えた日が ${summary.severeDutyDays} 日あります。`);
  if (summary.monthDutyOverDrivers > 0) danger.push(`1 か月の拘束が上限を超えたドライバーが ${summary.monthDutyOverDrivers} 人います。`);
  if (summary.consecutiveOverDrivers > 0) danger.push(`連続勤務が上限を超えたドライバーが ${summary.consecutiveOverDrivers} 人います。`);
  if (danger.length > 0) return risk("danger", danger);

  const caution: string[] = [];
  if (summary.overDutyDays > 0) caution.push(`拘束が目安を超えた日が ${summary.overDutyDays} 日あります。`);
  if (summary.shortRestDays > 0) caution.push(`休息が目安を下回った日が ${summary.shortRestDays} 日あります。`);
  if (summary.shortBreakDays > 0) caution.push(`休憩が足りない日が ${summary.shortBreakDays} 日あります。`);
  if (caution.length > 0) return risk("caution", caution);

  return risk("good", []);
}

/** 危険なときに出す「まず何をすればよいか」の 1 行 */
export function laborActionLine(r: LaborRisk | null | undefined): string {
  if (!r) return "";
  if (r.level === "danger") return "対象のドライバーの翌日の開始を遅らせ、休みを入れてください。件数の配分も見直してください。";
  if (r.level === "caution") return "拘束が長い日のドライバーに、終了を早めるか休憩を増やすよう伝えてください。";
  return "";
}
