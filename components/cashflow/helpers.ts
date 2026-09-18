/**
 * 資金繰りカレンダーの純関数（React に依存しない。画面・CSV 出力・テストから使う）
 *
 * - 金額は入金が ＋、支払が − で RPC cash_forecast から渡ってくる（税込）
 * - 残高の積み上げはここだけで行い、画面側では計算しない
 * - 合計は lib/calc の sumMoney（独自の丸めは書かない）
 */
import { sumMoney } from "@/lib/calc";
import { yen } from "@/lib/format";
import { dateToMonth } from "@/lib/month";
import { isDateString } from "@/lib/schemas/expenses";
import { CASH_KIND_LABELS, CASH_STATUS_LABELS, type CashEvent, type CashSnapshot } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// 日付ユーティリティ（日本時間。DB と同じ "YYYY-MM-DD" の文字列で扱う）
// ---------------------------------------------------------------------------

/** 期間の上限（グラフ・一覧が重くなりすぎないように） */
export const MAX_RANGE_DAYS = 400;

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

/** n 日後（n はマイナス可） */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoOf(new Date(Date.UTC(y, m - 1, d + n)));
}

/** n か月後（月末は詰める。例: 1/31 の 1 か月後 → 2/28） */
export function addMonthsToDate(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return isoOf(new Date(Date.UTC(y, m - 1 + n, Math.min(d, lastDay))));
}

/** from から to までの日数（両端を含む。to < from なら 0） */
export function daysBetween(from: string, to: string): number {
  if (to < from) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(diff / 86_400_000) + 1;
}

/** from 〜 to の日付の配列（両端を含む。上限 max 日） */
export function eachDate(from: string, to: string, max: number = MAX_RANGE_DAYS): string[] {
  const out: string[] = [];
  if (!isDateString(from) || !isDateString(to) || to < from) return out;
  let d = from;
  for (let i = 0; i < max && d <= to; i += 1) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** "2026-11-30" → "11月30日" */
export function formatMonthDayJa(date: string): string {
  const [, m, d] = date.split("-");
  if (!m || !d) return date;
  return `${Number(m)}月${Number(d)}日`;
}

/** "2026-11-30" → "11/30" */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  if (!m || !d) return date;
  return `${Number(m)}/${Number(d)}`;
}

/** 曜日（日本語 1 文字） */
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export function weekdayJa(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** 土日か（一覧の見出しの色分け用） */
export function isWeekend(date: string): boolean {
  const w = weekdayJa(date);
  return w === "土" || w === "日";
}

// ---------------------------------------------------------------------------
// 期間（URL の ?from= / ?to=）
// ---------------------------------------------------------------------------

export interface CashRange {
  from: string;
  to: string;
}

export interface RangePreset {
  key: string;
  label: string;
  /** days か months のどちらか */
  days?: number;
  months?: number;
}

/** 画面上の期間切り替え */
export const RANGE_PRESETS: RangePreset[] = [
  { key: "30d", label: "30 日", days: 30 },
  { key: "60d", label: "60 日", days: 60 },
  { key: "90d", label: "90 日", days: 90 },
  { key: "6m", label: "6 か月", months: 6 },
];

/** 既定は「今日から 90 日後まで」 */
export const DEFAULT_PRESET_KEY = "90d";

function firstParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : "";
}

/** プリセットの期間（起点は today） */
export function presetRange(key: string, today: string): CashRange {
  const preset = RANGE_PRESETS.find((p) => p.key === key) ?? RANGE_PRESETS.find((p) => p.key === DEFAULT_PRESET_KEY);
  if (!preset) return { from: today, to: today };
  const to = preset.months != null ? addMonthsToDate(today, preset.months) : addDays(today, preset.days ?? 0);
  return { from: today, to };
}

/** 表示中の期間がどのプリセットか（該当しなければ null＝カスタム） */
export function activePresetKey(range: CashRange, today: string): string | null {
  if (range.from !== today) return null;
  return RANGE_PRESETS.find((p) => presetRange(p.key, today).to === range.to)?.key ?? null;
}

/**
 * URL の ?from= / ?to= から期間を決める。
 * 未指定・不正は「今日から 90 日後まで」。to < from は from に揃え、長すぎる期間は MAX_RANGE_DAYS で切る。
 */
export function resolveRange(fromParam: string | string[] | undefined, toParam: string | string[] | undefined, now: Date = new Date()): CashRange {
  const today = todayJST(now);
  const rawFrom = firstParam(fromParam);
  const rawTo = firstParam(toParam);
  const from = isDateString(rawFrom) ? rawFrom : today;
  const fallbackTo = presetRange(DEFAULT_PRESET_KEY, from).to;
  let to = isDateString(rawTo) ? rawTo : fallbackTo;
  if (to < from) to = from;
  const limit = addDays(from, MAX_RANGE_DAYS - 1);
  if (to > limit) to = limit;
  return { from, to };
}

/** 期間を ?from=&to= のクエリにする */
export function rangeQuery(range: CashRange): string {
  return `from=${range.from}&to=${range.to}`;
}

// ---------------------------------------------------------------------------
// 起点残高（cash_snapshots）
// ---------------------------------------------------------------------------

export interface OpeningBalance {
  /** 残高の日付 */
  asOf: string;
  balance: number;
  memo: string;
  id: string;
}

/** 画面で扱う残高の 1 件 */
export type CashSnapshotRow = OpeningBalance;

export function toSnapshotRow(s: CashSnapshot): CashSnapshotRow {
  return { id: s.id, asOf: s.as_of ?? "", balance: Number(s.balance ?? 0), memo: s.memo ?? "" };
}

/** 期間開始日以前で一番新しい残高（無ければ null） */
export function pickOpeningBalance(snapshots: CashSnapshot[], from: string): OpeningBalance | null {
  const usable = snapshots.filter((s) => typeof s.as_of === "string" && s.as_of <= from);
  if (usable.length === 0) return null;
  const latest = usable.reduce((a, b) => (a.as_of >= b.as_of ? a : b));
  return { asOf: latest.as_of, balance: Number(latest.balance ?? 0), memo: latest.memo ?? "", id: latest.id };
}

// ---------------------------------------------------------------------------
// 予定（cash_forecast の 1 行）
// ---------------------------------------------------------------------------

export interface CashRow {
  /** React の key 用（同じ日に同じ相手が複数出るため連番を含める） */
  key: string;
  date: string;
  /** invoice / payout / expense */
  kind: string;
  kindLabel: string;
  /** 相手先（取引先名・ドライバー名・経費カテゴリ名） */
  label: string;
  /** 内容（請求書番号・「2026年09月の支払」・経費の内容） */
  detail: string;
  /** 入金は ＋、支払は −（税込） */
  amount: number;
  /** planned / confirmed / done */
  status: string;
  statusLabel: string;
  refId: string;
  /** 稼動月 "YYYY-MM"（不明なら ""） */
  month: string;
}

const KIND_ORDER: Record<string, number> = { invoice: 0, payout: 1, expense: 2 };

/** RPC の 1 行を画面で扱う形へ（null の正規化とラベル付け） */
export function toCashRow(e: CashEvent, index = 0): CashRow {
  const kind = e.kind ?? "";
  const status = e.status ?? "";
  const date = e.event_date ?? "";
  const refId = e.ref_id ?? "";
  return {
    key: `${kind}-${refId}-${date}-${index}`,
    date,
    kind,
    kindLabel: CASH_KIND_LABELS[kind] ?? kind,
    label: e.label ?? "",
    detail: e.detail ?? "",
    amount: Number(e.amount ?? 0),
    status,
    statusLabel: CASH_STATUS_LABELS[status] ?? status,
    refId,
    month: e.month ? dateToMonth(e.month) : "",
  };
}

/** 同じ日の中の並び：入金 → ドライバー支払 → 経費、同じ種別は金額の大きい順 */
export function sortCashRows(rows: CashRow[]): CashRow[] {
  return [...rows].sort((a, b) => {
    const ka = KIND_ORDER[a.kind] ?? 9;
    const kb = KIND_ORDER[b.kind] ?? 9;
    if (ka !== kb) return ka - kb;
    const d = Math.abs(b.amount) - Math.abs(a.amount);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label, "ja");
  });
}

// ---------------------------------------------------------------------------
// 残高の積み上げ
// ---------------------------------------------------------------------------

/** 日ごとの予定と、その日の終わりの残高 */
export interface CashDay {
  date: string;
  events: CashRow[];
  /** 入金合計（正の値） */
  inflow: number;
  /** 支払合計（正の値） */
  outflow: number;
  /** その日の増減（inflow − outflow） */
  net: number;
  /** その日の終わりの残高 */
  balance: number;
}

export interface CashTimelineInput {
  events: CashEvent[];
  /** 期間開始日の時点の残高（未登録なら 0） */
  openingBalance: number;
  from: string;
  to: string;
}

/**
 * 期間内の予定を日付ごとにまとめ、起点残高から残高を積み上げる。
 * 予定が無い日は行を作らない（表が長くなりすぎるため。グラフ用は fillDailyBalances で埋める）。
 */
export function buildCashTimeline({ events, openingBalance, from, to }: CashTimelineInput): CashDay[] {
  const rows = events.map(toCashRow).filter((r) => r.date !== "" && r.date >= from && r.date <= to);
  const byDate = new Map<string, CashRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const days: CashDay[] = [];
  let balance = openingBalance;
  for (const date of [...byDate.keys()].sort()) {
    const dayRows = sortCashRows(byDate.get(date) ?? []);
    const inflow = sumMoney(dayRows.filter((r) => r.amount > 0).map((r) => r.amount));
    const outflow = sumMoney(dayRows.filter((r) => r.amount < 0).map((r) => -r.amount));
    const net = sumMoney([inflow, -outflow]);
    balance = sumMoney([balance, net]);
    days.push({ date, events: dayRows, inflow, outflow, net, balance });
  }
  return days;
}

export interface CashSummary {
  /** 期間内の入金合計（正） */
  inflow: number;
  /** 期間内の支払合計（正） */
  outflow: number;
  /** 差引（inflow − outflow） */
  net: number;
  /** 期間内の最低残高（予定が 1 件も無ければ null） */
  minBalance: number | null;
  minBalanceDate: string | null;
  /** 残高がマイナスになる日数 */
  negativeDays: number;
  /** 最初にマイナスになる日（無ければ null） */
  firstNegativeDate: string | null;
  eventCount: number;
}

/** 期間内の合計・最低残高・マイナスの日 */
export function cashSummary(timeline: CashDay[]): CashSummary {
  const inflow = sumMoney(timeline.map((d) => d.inflow));
  const outflow = sumMoney(timeline.map((d) => d.outflow));
  let minBalance: number | null = null;
  let minBalanceDate: string | null = null;
  let negativeDays = 0;
  let firstNegativeDate: string | null = null;
  for (const d of timeline) {
    if (minBalance == null || d.balance < minBalance) {
      minBalance = d.balance;
      minBalanceDate = d.date;
    }
    if (d.balance < 0) {
      negativeDays += 1;
      if (firstNegativeDate == null) firstNegativeDate = d.date;
    }
  }
  return {
    inflow,
    outflow,
    net: sumMoney([inflow, -outflow]),
    minBalance,
    minBalanceDate,
    negativeDays,
    firstNegativeDate,
    eventCount: timeline.reduce((a, d) => a + d.events.length, 0),
  };
}

/** グラフ用の 1 点（予定が無い日も前日の残高で埋める） */
export interface CashDailyPoint {
  date: string;
  balance: number;
  inflow: number;
  outflow: number;
  net: number;
  hasEvents: boolean;
}

/** 日ごとの残高（グラフ用）。予定の無い日は前日の残高をそのまま引き継ぐ */
export function fillDailyBalances(timeline: CashDay[], from: string, to: string, openingBalance = 0): CashDailyPoint[] {
  const byDate = new Map(timeline.map((d) => [d.date, d]));
  let balance = openingBalance;
  return eachDate(from, to).map((date) => {
    const day = byDate.get(date);
    if (day) balance = day.balance;
    return {
      date,
      balance,
      inflow: day?.inflow ?? 0,
      outflow: day?.outflow ?? 0,
      net: day?.net ?? 0,
      hasEvents: day != null,
    };
  });
}

/**
 * 折れ線をマイナスで色分けするためのグラデーション位置（0〜1）。
 * すべてプラスなら 1（全体が通常色）、すべてマイナスなら 0（全体が赤）。
 */
export function gradientOffset(values: number[]): number {
  if (values.length === 0) return 1;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (min >= 0) return 1;
  if (max <= 0) return 0;
  return max / (max - min);
}

/** 残高がマイナスになる見込みの警告文（問題なければ null） */
export function negativeBalanceMessage(summary: CashSummary): string | null {
  if (summary.firstNegativeDate == null) return null;
  const min = summary.minBalance ?? 0;
  const head = `${formatMonthDayJa(summary.firstNegativeDate)}に残高がマイナスになる見込みです`;
  const tail = summary.minBalanceDate ? `（最低残高 ${yen(min)}／${formatMonthDayJa(summary.minBalanceDate)}）` : "";
  return `${head}${tail}。入金予定の前倒しや支払の調整を検討してください。`;
}

// ---------------------------------------------------------------------------
// CSV 用の行
// ---------------------------------------------------------------------------

/** CSV の 1 行（残高はその日の残高。同じ日の行には同じ残高が入る） */
export interface CashflowCsvRow {
  date: string;
  kindLabel: string;
  label: string;
  detail: string;
  /** 入金（正。支払の行は 0） */
  inflow: number;
  /** 支払（正。入金の行は 0） */
  outflow: number;
  balance: number;
  statusLabel: string;
  month: string;
}

export function toCashflowCsvRows(timeline: CashDay[]): CashflowCsvRow[] {
  return timeline.flatMap((day) =>
    day.events.map((e) => ({
      date: day.date,
      kindLabel: e.kindLabel,
      label: e.label,
      detail: e.detail,
      inflow: e.amount > 0 ? e.amount : 0,
      outflow: e.amount < 0 ? -e.amount : 0,
      balance: day.balance,
      statusLabel: e.statusLabel,
      month: e.month,
    })),
  );
}
