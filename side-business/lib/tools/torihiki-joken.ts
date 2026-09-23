/**
 * 無料ツール「軽貨物版 取引条件明示書（フリーランス法）の作成と、支払期日の60日チェック」の純関数。
 * 画面（components/tools/torihiki-joken.tsx）はここを呼ぶだけで、日付の数え方や文面を自前で持たない。
 *
 * 支払期日の60日の数え方（2026年9月時点。出典はページに載せる）
 *  1. 原則：役務の提供を受けた日から「起算して」60日以内。初日を1日目と数えるので、その日＋59日までが期限。
 *  2. 月単位で締める場合は、60日を「2か月」として扱う（31日の月も30日の月も1か月と数える）。
 *     2か月の終わりは、2か月後の同じ日の前日（その日が無い月は、その月の末日）。1 と 2 の遅い方を期限とする。
 *     公取委・中小企業庁の資料の「月末締めなら翌月末日までに支払期日を設定する」と一致する。
 *  3. 同じ種類の役務が続き、①月単位の締めでまとめて払うことを話し合って決めて明示書に書き、
 *     ②報酬の額か算定方法を明示書に書いている場合は、締め期間の末日に役務の提供を受けたものとして、
 *     その日から数えてよい（解釈ガイドライン）。
 * 判定は安全側に倒す：期間の初日から数えて期限内なら ok、締め日から数えてはじめて期限内なら caution（条件つき）、
 * 締め日から数えても超えるなら ng。
 */
import { daysBetween, groupDigits, jpDate } from "@/lib/tools/invoice-cost";

/** この道具がもとにしている制度の時点 */
export const TORIHIKI_RULES_AS_OF = "2026年9月";

/* ───────────── 日付 ───────────── */

/** 月の中の日。"末" は月末 */
export type DayOfMonth = number | "末";
/** 0 = 当月、1 = 翌月、2 = 翌々月 */
export type PayMonthOffset = 0 | 1 | 2;
/** 支払日が銀行の休みの日のとき。before = 前の営業日、after = 次の営業日 */
export type HolidayRule = "before" | "after";

export const PAY_MONTH_LABELS: Record<PayMonthOffset, string> = { 0: "当月", 1: "翌月", 2: "翌々月" };

type Ymd = { y: number; m: number; d: number };

function parse(date: string): Ymd {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** YYYY-MM-DD として正しい日付か */
export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parse(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** その月の day 日（31 日が無い月などは月末に寄せる） */
export function dayInMonth(y: number, m: number, day: DayOfMonth): string {
  const last = daysInMonth(y, m);
  return iso(y, m, day === "末" ? last : Math.min(day, last));
}

/** 0 = 日曜 … 6 = 土曜 */
function weekday(date: string): number {
  const { y, m, d } = parse(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-10-30 → 10/30(金) */
export function shortDate(date: string): string {
  const { m, d } = parse(date);
  return `${m}/${d}(${WEEKDAY_LABELS[weekday(date)]})`;
}

/**
 * 銀行が休みの日か。土日と年末年始（12月31日〜1月3日）だけを見る。祝日は入れていない（画面でそう書く）。
 */
export function isBankHoliday(date: string): boolean {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return true;
  const { m, d } = parse(date);
  return (m === 12 && d === 31) || (m === 1 && d <= 3);
}

/** 支払日が銀行の休みの日なら、前（または次）の営業日へずらす */
export function adjustForBankHoliday(date: string, rule: HolidayRule): string {
  let cur = date;
  while (isBankHoliday(cur)) cur = addDays(cur, rule === "before" ? -1 : 1);
  return cur;
}

/**
 * start の日に受けた役務の支払期日の最終日（start を 1 日目として 60 日目と、2 か月の終わりの遅い方）。
 * 例：8/1 → 9/30、7/1 → 8/31、8/31 → 10/30、12/31 → 翌年 2/28
 */
export function sixtyDayLimit(start: string): string {
  const byDays = addDays(start, 59);
  const { y, m, d } = parse(start);
  const t = shiftMonth(y, m, 2);
  const last = daysInMonth(t.y, t.m);
  const byMonths = d > last ? iso(t.y, t.m, last) : addDays(iso(t.y, t.m, d), -1);
  return byDays > byMonths ? byDays : byMonths;
}

/* ───────────── 支払期日の 60 日チェック ───────────── */

export type DeadlineInput = {
  closingDay: DayOfMonth;
  payMonthOffset: PayMonthOffset;
  payDay: DayOfMonth;
  holidayRule?: HolidayRule;
  /** 業務を始める日（YYYY-MM-DD）。この日が入る締め期間から数える。省略すると端末の今日 */
  serviceFrom?: string;
  /** 何か月分を見るか（既定 12） */
  months?: number;
};

export type DeadlineStatus = "ok" | "caution" | "ng";

export type DeadlineRow = {
  /** 締める月（YYYY-MM） */
  closingMonth: string;
  /** 締め期間の初日（最初の期間は業務を始める日） */
  periodStart: string;
  /** 締め日 */
  periodEnd: string;
  /** 決めた支払日 */
  payDate: string;
  /** 銀行の休みの日をずらしたあとの支払日 */
  payDateActual: string;
  shifted: boolean;
  /** 期間の初日から支払日まで何日後か */
  daysFromStart: number;
  /** 締め日から支払日まで何日後か */
  daysFromEnd: number;
  /** 期間の初日から数えた期限 */
  limitFromStart: string;
  /** 締め日から数えた期限（条件つき） */
  limitFromEnd: string;
  status: DeadlineStatus;
};

export type DeadlineResult = {
  /** 入力の誤り（当月払いで支払日が締め日より前など）。あれば rows は空 */
  error: string | null;
  /** 12 か月すべて ok なら true */
  ok: boolean;
  /** いちばん悪い月の判定 */
  status: DeadlineStatus;
  rows: DeadlineRow[];
  counts: Record<DeadlineStatus, number>;
  /** 期間の初日から支払日までの最大の日数 */
  maxDaysFromStart: number;
  /** 締め日から支払日までの最大の日数 */
  maxDaysFromEnd: number;
  /** 「毎月20日締め・翌月末日払い」 */
  ruleLabel: string;
  /** 1〜2 文のまとめ */
  summary: string;
};

const STATUS_ORDER: Record<DeadlineStatus, number> = { ok: 0, caution: 1, ng: 2 };

export const STATUS_LABELS: Record<DeadlineStatus, string> = {
  ok: "OK",
  caution: "要注意",
  ng: "60日を超えます",
};

function isDay(value: unknown): value is DayOfMonth {
  return value === "末" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31);
}

/** 20 → 「20日」、"末" → 「末日」。31 日も「末日」と読む */
export function dayLabel(day: DayOfMonth): string {
  return day === "末" || day === 31 ? "末日" : `${day}日`;
}

/** 「毎月20日締め・翌月末日払い」 */
export function payRuleLabel(closingDay: DayOfMonth, payMonthOffset: PayMonthOffset, payDay: DayOfMonth): string {
  return `毎月${dayLabel(closingDay)}締め・${PAY_MONTH_LABELS[payMonthOffset]}${dayLabel(payDay)}払い`;
}

/** 締め期間の説明。「毎月1日から末日まで」「前月21日から当月20日まで」 */
export function closingPeriodText(closingDay: DayOfMonth): string {
  if (closingDay === "末" || closingDay === 31) return "毎月1日から末日まで";
  if (closingDay <= 27) return `前月${closingDay + 1}日から当月${closingDay}日まで`;
  // 28 日はどの月にもあるが、29 日は 2 月に無いことがあるので「翌日から」と書く
  if (closingDay === 28) return "前月28日の翌日から当月28日まで";
  return `前月${closingDay}日の翌日から当月${closingDay}日まで（${closingDay}日が無い月は末日まで）`;
}

/** 入力の誤りを日本語で返す。問題なければ null */
export function validateDeadlineInput(input: DeadlineInput): string | null {
  if (!isDay(input.closingDay)) return "締め日を選んでください";
  if (!isDay(input.payDay)) return "支払日を選んでください";
  if (![0, 1, 2].includes(input.payMonthOffset)) return "支払う月を選んでください";
  if (input.serviceFrom !== undefined && !isDateString(input.serviceFrom)) return "業務を始める日を正しく入れてください";
  if (input.payMonthOffset === 0) {
    const c = input.closingDay === "末" ? 31 : input.closingDay;
    const p = input.payDay === "末" ? 31 : input.payDay;
    if (p < c) return "当月払いにするときは、支払日を締め日と同じか後の日にしてください";
  }
  return null;
}

function todayString(): string {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 締め月 (y, m) の締め期間（初日・締め日） */
function periodOf(y: number, m: number, closingDay: DayOfMonth): { start: string; end: string } {
  const prev = shiftMonth(y, m, -1);
  return { start: addDays(dayInMonth(prev.y, prev.m, closingDay), 1), end: dayInMonth(y, m, closingDay) };
}

/**
 * 締め日・支払月・支払日から、これから 12 か月の支払日と、60 日（2 か月）以内かを月ごとに出す。
 */
export function paymentDeadlineCheck(input: DeadlineInput): DeadlineResult {
  const { closingDay, payMonthOffset, payDay } = input;
  const holidayRule = input.holidayRule ?? "before";
  const months = Math.max(1, Math.min(input.months ?? 12, 36));
  const ruleLabel = isDay(closingDay) && isDay(payDay) ? payRuleLabel(closingDay, payMonthOffset, payDay) : "";
  const empty = { ok: 0, caution: 0, ng: 0 };
  const error = validateDeadlineInput(input);
  if (error) {
    return {
      error,
      ok: false,
      status: "ng",
      rows: [],
      counts: empty,
      maxDaysFromStart: 0,
      maxDaysFromEnd: 0,
      ruleLabel,
      summary: error,
    };
  }

  const serviceFrom = input.serviceFrom ?? todayString();
  const from = parse(serviceFrom);
  // 業務を始める日が入る締め期間から
  let first = { y: from.y, m: from.m };
  if (serviceFrom > periodOf(first.y, first.m, closingDay).end) first = shiftMonth(first.y, first.m, 1);

  const rows: DeadlineRow[] = [];
  for (let i = 0; i < months; i++) {
    const { y, m } = shiftMonth(first.y, first.m, i);
    const period = periodOf(y, m, closingDay);
    const periodStart = i === 0 && serviceFrom > period.start ? serviceFrom : period.start;
    const payMonth = shiftMonth(y, m, payMonthOffset);
    const payDate = dayInMonth(payMonth.y, payMonth.m, payDay);
    const payDateActual = adjustForBankHoliday(payDate, holidayRule);
    const limitFromStart = sixtyDayLimit(periodStart);
    const limitFromEnd = sixtyDayLimit(period.end);
    const status: DeadlineStatus =
      payDateActual <= limitFromStart ? "ok" : payDateActual <= limitFromEnd ? "caution" : "ng";
    rows.push({
      closingMonth: `${y}-${String(m).padStart(2, "0")}`,
      periodStart,
      periodEnd: period.end,
      payDate,
      payDateActual,
      shifted: payDateActual !== payDate,
      daysFromStart: daysBetween(periodStart, payDateActual),
      daysFromEnd: daysBetween(period.end, payDateActual),
      limitFromStart,
      limitFromEnd,
      status,
    });
  }

  const counts = { ...empty };
  for (const r of rows) counts[r.status] += 1;
  const status = rows.reduce<DeadlineStatus>((w, r) => (STATUS_ORDER[r.status] > STATUS_ORDER[w] ? r.status : w), "ok");
  const n = rows.length;
  const summary =
    status === "ok"
      ? `${n}か月すべてで、締め期間の最初の日に行った業務の分も、60日（2か月）以内に払えます。`
      : status === "caution"
        ? `締め期間の最初の日から数えると、${n}か月のうち${counts.caution}か月で60日（2か月）を超えます。締め日から数えれば60日（2か月）以内です。`
        : `締め日から数えても、${n}か月のうち${counts.ng}か月で60日（2か月）を超えます。支払日を早めてください。`;

  return {
    error: null,
    ok: status === "ok",
    status,
    rows,
    counts,
    maxDaysFromStart: Math.max(...rows.map((r) => r.daysFromStart)),
    maxDaysFromEnd: Math.max(...rows.map((r) => r.daysFromEnd)),
    ruleLabel,
    summary,
  };
}

/** 選べる支払日（1〜30 日と末日） */
export const DAY_CHOICES: DayOfMonth[] = [...Array.from({ length: 30 }, (_, i) => i + 1), "末"];

/**
 * 期間の初日から数えても 12 か月すべて ok になる、いちばん遅い支払のルール。見つからなければ null。
 * 「翌月20日払いまでなら OK」のように、直し方を示すために使う。
 */
export function latestSafePayRule(
  input: Omit<DeadlineInput, "payMonthOffset" | "payDay">,
): { payMonthOffset: PayMonthOffset; payDay: DayOfMonth; ruleLabel: string } | null {
  const offsets: PayMonthOffset[] = [2, 1, 0];
  for (const payMonthOffset of offsets) {
    for (let i = DAY_CHOICES.length - 1; i >= 0; i--) {
      const payDay = DAY_CHOICES[i];
      const r = paymentDeadlineCheck({ ...input, payMonthOffset, payDay });
      if (r.error === null && r.ok) return { payMonthOffset, payDay, ruleLabel: r.ruleLabel };
    }
  }
  return null;
}

/* ───────────── 取引条件明示書 ───────────── */

export type RateUnitId = "piece" | "case" | "day" | "hour" | "month" | "km";

export const RATE_UNITS: { id: RateUnitId; label: string; per: string }[] = [
  { id: "piece", label: "個建て", per: "1個" },
  { id: "case", label: "件・便", per: "1件" },
  { id: "day", label: "日当", per: "1日" },
  { id: "hour", label: "時間", per: "1時間" },
  { id: "month", label: "月額", per: "1か月" },
  { id: "km", label: "距離", per: "1km" },
];

export type DeductionKindId = "monthly" | "daily" | "percent";

export const DEDUCTION_KINDS: { id: DeductionKindId; label: string }[] = [
  { id: "monthly", label: "毎月・円" },
  { id: "daily", label: "1日ごと・円" },
  { id: "percent", label: "報酬の%" },
];

export type Bearer = "company" | "driver";

export type RateLine = { label: string; unit: RateUnitId; unitPrice: number | null; note?: string };
export type Deduction = { label: string; kind: DeductionKindId; amount: number | null };
export type ExpenseLine = { label: string; bearer: Bearer };

export type TorihikiInput = {
  /** 委託する者（会社） */
  clientName: string;
  /** 委託を受ける者（ドライバー。氏名・屋号、または番号でもよい） */
  driverName: string;
  /** 業務委託をした日（合意した日） */
  commissionDate: string;
  /** 業務の内容（例：宅配便の配達） */
  work: string;
  /** 業務の内容の補足（担当コース・荷物・時間帯など） */
  workDetail: string;
  /** 業務を行う期間 */
  periodFrom: string;
  periodTo: string;
  /** 期間が終わっても申し出がなければ更新する */
  autoRenew: boolean;
  /** 業務を行う場所・エリア */
  place: string;
  rates: RateLine[];
  /** 単価に消費税を含むか */
  taxIncluded: boolean;
  deductions: Deduction[];
  closingDay: DayOfMonth;
  payMonthOffset: PayMonthOffset;
  payDay: DayOfMonth;
  holidayRule: HolidayRule;
  transferFeeBearer: Bearer;
  expenses: ExpenseLine[];
  /** 検査（検収）をするか。するなら終える期日 */
  inspection: boolean;
  inspectionDue: string;
  other: string;
};

export type DocSection = {
  key: string;
  heading: string;
  lines: string[];
  table?: { head: [string, string]; rows: [string, string][] };
};

export type ChecklistStatus = "ok" | "missing" | "na";
export type ChecklistItem = { label: string; status: ChecklistStatus; note: string };

export type TorihikiDoc = {
  title: string;
  clientName: string;
  driverName: string;
  /** 業務委託をした日（和暦ではなく「2026年10月1日」） */
  dateText: string;
  intro: string;
  sections: DocSection[];
  footer: string;
  /** 公取委規則の明示事項ごとの記入状況 */
  checklist: ChecklistItem[];
  /** 未記入の項目（見出し） */
  missing: string[];
  /** 気をつけること（振込手数料・支払期日など） */
  warnings: string[];
  deadline: DeadlineResult;
};

/** 未記入の欄に出す文字 */
export const BLANK = "（未記入）";

/** 差し引くものの行が埋まっていないときの missing の値（明示事項のチェックには入らないので、画面で別に出す） */
export const DEDUCTION_MISSING = "差し引くものの名前か金額";

const text = (v: string) => v.trim() || BLANK;

/** 150 → 「150円」、null → 「（未記入）」 */
function yenText(v: number | null): string {
  return v === null ? BLANK : `${groupDigits(v)}円`;
}

/** 10 → 「10%」、2.5 → 「2.5%」 */
function percentText(v: number | null): string {
  if (v === null) return BLANK;
  return `${Math.round(v * 100) / 100}%`;
}

function rateText(r: RateLine, taxIncluded: boolean): string {
  const unit = RATE_UNITS.find((u) => u.id === r.unit) ?? RATE_UNITS[0];
  return `${unit.per}あたり ${yenText(r.unitPrice)}${r.unitPrice === null ? "" : taxIncluded ? "（税込）" : "（税抜）"}`;
}

function deductionText(d: Deduction): string {
  if (d.kind === "percent") return `報酬の ${percentText(d.amount)}`;
  if (d.kind === "daily") return `業務1日あたり ${yenText(d.amount)}`;
  return `毎月 ${yenText(d.amount)}`;
}

function periodText(input: TorihikiInput): string {
  const from = isDateString(input.periodFrom) ? jpDate(input.periodFrom) : BLANK;
  if (!isDateString(input.periodTo)) return `${from}から（終わりの日は定めない）`;
  return `${from}から${jpDate(input.periodTo)}まで`;
}

const filledRates = (rates: RateLine[]) => rates.filter((r) => r.label.trim() !== "" || r.unitPrice !== null);
const filledDeductions = (ds: Deduction[]) => ds.filter((d) => d.label.trim() !== "" || d.amount !== null);

/**
 * 画面の入力から、取引条件明示書の中身（見出しと行）を組み立てる。
 * 公正取引委員会規則が定める明示事項の順に並べ、書けていない項目は「（未記入）」にして missing に入れる。
 */
export function buildTorihikiJoken(input: TorihikiInput): TorihikiDoc {
  const deadline = paymentDeadlineCheck({
    closingDay: input.closingDay,
    payMonthOffset: input.payMonthOffset,
    payDay: input.payDay,
    holidayRule: input.holidayRule,
    serviceFrom: isDateString(input.periodFrom) ? input.periodFrom : undefined,
  });
  const rates = filledRates(input.rates);
  const deductions = filledDeductions(input.deductions);
  const sections: DocSection[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  const hasClient = input.clientName.trim() !== "";
  const hasDriver = input.driverName.trim() !== "";
  if (!hasClient) missing.push("委託する者（会社）の名前");
  if (!hasDriver) missing.push("ドライバーの名前");
  sections.push({
    key: "parties",
    heading: "当事者",
    lines: [`委託する者（発注する会社）：${text(input.clientName)}`, `委託を受ける者（ドライバー）：${text(input.driverName)}`],
  });

  const hasCommissionDate = isDateString(input.commissionDate);
  if (!hasCommissionDate) missing.push("業務委託をした日");
  sections.push({
    key: "date",
    heading: "業務委託をした日",
    lines: [hasCommissionDate ? jpDate(input.commissionDate) : BLANK],
  });

  const hasWork = input.work.trim() !== "";
  if (!hasWork) missing.push("業務の内容");
  sections.push({
    key: "work",
    heading: "業務の内容",
    lines: [text(input.work), ...(input.workDetail.trim() ? input.workDetail.trim().split(/\r?\n/) : [])],
  });

  const hasPeriod = isDateString(input.periodFrom);
  if (!hasPeriod) missing.push("業務を行う期間");
  if (hasPeriod && isDateString(input.periodTo) && input.periodTo < input.periodFrom) {
    warnings.push("業務を行う期間の終わりの日が、始まりの日より前になっています。");
  }
  const periodLines = [periodText(input)];
  if (input.autoRenew && isDateString(input.periodTo)) {
    periodLines.push("期間が終わる30日前までに、どちらからも申し出がなければ、同じ条件で同じ長さだけ更新します。");
  }
  sections.push({ key: "period", heading: "業務を行う期間", lines: periodLines });

  const hasPlace = input.place.trim() !== "";
  if (!hasPlace) missing.push("業務を行う場所");
  sections.push({ key: "place", heading: "業務を行う場所", lines: [text(input.place)] });

  const hasInspectionDue = input.inspectionDue.trim() !== "";
  if (input.inspection) {
    if (!hasInspectionDue) missing.push("検査を終える日");
    sections.push({ key: "inspection", heading: "検査", lines: [`検査を終える日：${text(input.inspectionDue)}`] });
  }

  const hasRates = rates.length > 0 && rates.every((r) => r.label.trim() !== "" && r.unitPrice !== null);
  if (!hasRates) missing.push("報酬の単価");
  const companyExpenses = input.expenses.filter((e) => e.label.trim() !== "" && e.bearer === "company");
  const feeLines = [
    "報酬の額は、上の単価に、締め期間の数量（個数・件数・日数・時間など）をかけた金額の合計です。",
    input.taxIncluded ? "単価は消費税を含みます。" : "単価は消費税を含みません。消費税は別に計算して支払います。",
  ];
  if (companyExpenses.length > 0) {
    feeLines.push(`当社が負担する費用（${companyExpenses.map((e) => e.label.trim()).join("・")}）は、実費を報酬とあわせて支払います。`);
  }
  sections.push({
    key: "fee",
    heading: "報酬の額（算定方法）",
    lines: feeLines,
    table: {
      head: ["内容", "単価"],
      rows: (rates.length > 0 ? rates : [{ label: "", unit: "piece" as RateUnitId, unitPrice: null }]).map((r) => [
        text(r.label) + (r.note?.trim() ? `（${r.note.trim()}）` : ""),
        rateText(r, input.taxIncluded),
      ]),
    },
  });

  if (deductions.length > 0) {
    if (deductions.some((d) => d.label.trim() === "" || d.amount === null)) missing.push(DEDUCTION_MISSING);
    if (deductions.some((d) => d.kind === "percent" && d.amount !== null && (d.amount < 0 || d.amount > 100))) {
      warnings.push("差し引く割合は0〜100%の間で入れてください。");
    }
    sections.push({
      key: "deduction",
      heading: "報酬から差し引くもの（話し合って決めたもの）",
      lines: ["ここに書いたもののほかに、報酬から差し引くものはありません。"],
      table: { head: ["名前", "金額"], rows: deductions.map((d) => [text(d.label), deductionText(d)]) },
    });
  } else {
    sections.push({ key: "deduction", heading: "報酬から差し引くもの", lines: ["ありません。"] });
  }

  const payLines: string[] = [];
  if (deadline.error) {
    missing.push("支払期日");
    payLines.push(BLANK);
    warnings.push(deadline.error);
  } else {
    const first = deadline.rows[0];
    payLines.push(
      deadline.ruleLabel.replace("・", "、"),
      `締め期間は${closingPeriodText(input.closingDay)}です。締め期間の末日までに行った業務の報酬は、話し合って決めたとおり、締め期間ごとにまとめて支払日に支払います。`,
      input.holidayRule === "before"
        ? "支払日が銀行の休業日にあたるときは、前の営業日に支払います。"
        : "支払日が銀行の休業日にあたるときは、次の営業日に支払います。",
      `例：${jpDate(first.periodStart)}〜${jpDate(first.periodEnd)}の分は、${jpDate(first.payDateActual)}に支払います。`,
    );
    if (deadline.status === "caution") {
      warnings.push("締め期間の最初の日から数えると、支払日が60日（2か月）を超える月があります。締め日から数えてよい条件にあてはまるか確かめてください。");
    } else if (deadline.status === "ng") {
      warnings.push("支払日が、締め日から数えても60日（2か月）を超える月があります。支払日を早めてください。");
    }
  }
  sections.push({ key: "payment", heading: "支払期日", lines: payLines });

  sections.push({
    key: "method",
    heading: "支払方法",
    lines: [
      "ドライバーが指定する銀行口座への振込",
      input.transferFeeBearer === "company"
        ? "振込手数料は当社が負担します。"
        : "振込手数料はドライバーの負担とし、報酬から差し引きます。",
    ],
  });
  if (input.transferFeeBearer === "driver") {
    warnings.push(
      "2026年1月1日以後に発注する取引では、合意があっても振込手数料を報酬から差し引くと「報酬の減額」などとして違反になると、公正取引委員会が示しています。",
    );
  }

  const expenses = input.expenses.filter((e) => e.label.trim() !== "");
  if (expenses.length > 0) {
    sections.push({
      key: "expenses",
      heading: "費用の負担",
      lines: expenses.map((e) => `${e.label.trim()}：${e.bearer === "company" ? "当社が負担（実費）" : "ドライバーが負担"}`),
    });
  }

  const other = input.other.trim();
  if (other) sections.push({ key: "other", heading: "その他", lines: other.split(/\r?\n/).filter((l) => l.trim() !== "") });

  const checklist: ChecklistItem[] = [
    { label: "当事者の名前", status: hasClient && hasDriver ? "ok" : "missing", note: "番号や記号でもかまいません" },
    { label: "業務委託をした日", status: hasCommissionDate ? "ok" : "missing", note: "話し合って決めた日" },
    { label: "業務の内容", status: hasWork ? "ok" : "missing", note: "何を運ぶか・どの仕事か" },
    { label: "業務を行う日・期間", status: hasPeriod ? "ok" : "missing", note: "続く仕事なら期間" },
    { label: "業務を行う場所", status: hasPlace ? "ok" : "missing", note: "営業所・担当エリアなど" },
    {
      label: "検査をする場合は、検査を終える日",
      status: input.inspection ? (hasInspectionDue ? "ok" : "missing") : "na",
      note: input.inspection ? "" : "検査をしないなら書かなくてよい",
    },
    { label: "報酬の額（算定方法）", status: hasRates ? "ok" : "missing", note: "単価 × 数量でもよい" },
    { label: "支払期日", status: deadline.error ? "missing" : "ok", note: deadline.error ? "" : deadline.ruleLabel },
    {
      label: "現金以外で払う場合の事項",
      status: "na",
      note: "振込なら不要。手形・電子記録債権・デジタル払いなどで払うときは、別に書く事項があります",
    },
  ];

  return {
    title: "取引条件明示書",
    clientName: text(input.clientName),
    driverName: text(input.driverName),
    dateText: hasCommissionDate ? jpDate(input.commissionDate) : BLANK,
    intro: "業務を委託するにあたり、取引の条件を次のとおり明示します。",
    sections,
    footer:
      "この書面は、特定受託事業者に係る取引の適正化等に関する法律（フリーランス・事業者間取引適正化等法）第3条にもとづき、取引の条件を明示するものです。",
    checklist,
    missing,
    warnings,
    deadline,
  };
}

/** LINE・メールで送る文面（プレーンテキスト） */
export function torihikiPlainText(doc: TorihikiDoc): string {
  const out: string[] = [`【${doc.title}】`, `${doc.driverName} 様`, "", doc.intro, ""];
  doc.sections.forEach((s, i) => {
    out.push(`■${i + 1}. ${s.heading}`);
    if (s.table) {
      for (const [a, b] of s.table.rows) out.push(`・${a}：${b}`);
    }
    for (const line of s.lines) out.push(line);
    out.push("");
  });
  out.push(doc.footer, "", `${doc.dateText}`, doc.clientName, "", "内容を確認したら、このメッセージに「確認しました」と返信してください。");
  return out.join("\n");
}
