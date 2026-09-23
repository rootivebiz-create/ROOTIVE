import { addMonths, compareMonth, formatMonthJa, isMonthKey, monthRange } from "@/lib/month";

/**
 * 会社の「期」（事業年度。0030）。純関数・サーバーとブラウザの両方で使う。
 *
 * - 期は決算月（companies.fiscal_month）で区切る。決算月が 9 なら 10月〜翌9月 が 1 つの期
 * - 期は「決算の年」で表す（2026年9月に終わる期 = endYear 2026）
 * - 設立日（companies.established_on）があれば「第N期」と数える。第1期は設立の月から最初の決算月まで（12 か月より短いことがある）
 * - 設立日が無ければ「2026年9月期」と決算の年月で呼ぶ
 */

export interface FiscalSettings {
  /** 決算月（1〜12） */
  fiscalMonth: number;
  /** 設立日（YYYY-MM-DD）。無ければ期の番号を出さない */
  establishedOn: string | null;
}

export interface FiscalPeriod {
  /** 決算の年（この期が終わる年） */
  endYear: number;
  /** 最初の月（YYYY-MM） */
  startMonth: string;
  /** 決算の月（YYYY-MM） */
  endMonth: string;
  /** 第N期の N（設立日が無い・設立前は null） */
  number: number | null;
  /** 「第3期」または「2026年9月期」 */
  label: string;
  /** 「2025年10月〜2026年9月」 */
  rangeLabel: string;
  /** この期の月（YYYY-MM。古い順） */
  months: string[];
}

/** 決算月の既定（未設定のとき）。会社設定の既定と同じ 3 月 */
export const DEFAULT_FISCAL_MONTH = 3;

export function normalizeFiscalMonth(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : DEFAULT_FISCAL_MONTH;
}

function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** companies の行（fiscal_month・established_on）から期の設定を作る */
export function fiscalSettingsOf(company: { fiscal_month?: unknown; established_on?: unknown } | null | undefined): FiscalSettings {
  return { fiscalMonth: normalizeFiscalMonth(company?.fiscal_month), establishedOn: normalizeDate(company?.established_on) };
}

/** その月が入る期の「決算の年」 */
export function periodEndYearOf(month: string, fiscalMonth: number): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m <= normalizeFiscalMonth(fiscalMonth) ? y : y + 1;
}

/** 設立の月（YYYY-MM）。設立日が無ければ null */
function establishedMonth(settings: FiscalSettings): string | null {
  return settings.establishedOn ? settings.establishedOn.slice(0, 7) : null;
}

/** 決算の年から期を作る */
export function fiscalPeriod(endYear: number, settings: FiscalSettings): FiscalPeriod {
  const fm = normalizeFiscalMonth(settings.fiscalMonth);
  const endMonth = `${endYear}-${String(fm).padStart(2, "0")}`;
  let startMonth = addMonths(endMonth, -11);
  let number: number | null = null;
  const est = establishedMonth(settings);
  if (est) {
    const n = endYear - periodEndYearOf(est, fm) + 1;
    if (n >= 1) {
      number = n;
      // 第1期は設立の月から（決算月の翌月より後に設立したとき）
      if (n === 1 && compareMonth(est, startMonth) > 0) startMonth = est;
    }
  }
  const label = number != null ? `第${number}期` : `${endYear}年${fm}月期`;
  return { endYear, startMonth, endMonth, number, label, rangeLabel: `${formatMonthJa(startMonth)}〜${formatMonthJa(endMonth)}`, months: monthRange(startMonth, endMonth) };
}

/** その月が入る期 */
export function fiscalPeriodOfMonth(month: string, settings: FiscalSettings): FiscalPeriod {
  return fiscalPeriod(periodEndYearOf(month, settings.fiscalMonth), settings);
}

/** 期の見出し（「第3期（2025年10月〜2026年9月）」） */
export function periodTitle(p: FiscalPeriod): string {
  return `${p.label}（${p.rangeLabel}）`;
}

/** 設立前の期か（設立日があり、その期が第1期より前） */
export function isBeforeEstablishment(p: FiscalPeriod, settings: FiscalSettings): boolean {
  const est = establishedMonth(settings);
  return est != null && p.number == null;
}

/**
 * 選べる期（新しい順）。データのある月・今月・いま見ている月を含む期と、その間。
 * 設立日があれば第1期より前は出さない
 */
export function periodOptions(months: (string | null | undefined)[], settings: FiscalSettings, extraMonths: string[] = []): FiscalPeriod[] {
  const years = new Set<number>();
  for (const m of [...months, ...extraMonths]) {
    if (m && isMonthKey(m.slice(0, 7))) years.add(periodEndYearOf(m.slice(0, 7), settings.fiscalMonth));
  }
  if (years.size === 0) return [];
  const min = Math.min(...years);
  const max = Math.max(...years);
  const out: FiscalPeriod[] = [];
  for (let y = max; y >= min; y--) {
    const p = fiscalPeriod(y, settings);
    if (isBeforeEstablishment(p, settings) && !years.has(y)) continue;
    out.push(p);
  }
  return out;
}

/** ?fy=YYYY（決算の年）。不正・未指定は null */
export function parsePeriodYear(param: string | string[] | undefined): number | null {
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw == null || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= 2000 && y <= 2100 ? y : null;
}

/** 月の切り替えの表に出す、月ごとの状態（v_month_list の行） */
export interface PeriodMonthInfo {
  month: string;
  status: "open" | "closed";
  bill?: number | null;
  entry_count?: number | null;
}

/** 期のまとめ（月の切り替えの表の下に出す）：売上の合計・締めた月の数・データのある月の数 */
export function summarizePeriod(p: FiscalPeriod, infos: PeriodMonthInfo[]): { bill: number; closed: number; withData: number; total: number } {
  const set = new Set(p.months);
  let bill = 0;
  let closed = 0;
  let withData = 0;
  for (const i of infos) {
    if (!set.has(i.month)) continue;
    bill += Number(i.bill ?? 0);
    if (i.status === "closed") closed += 1;
    if (Number(i.entry_count ?? 0) > 0) withData += 1;
  }
  return { bill, closed, withData, total: p.months.length };
}
