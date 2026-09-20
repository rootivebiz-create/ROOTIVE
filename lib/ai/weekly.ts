/**
 * 週次の経営サマリー（毎週月曜の朝に LINE へ届くもの）。
 *
 * - 集計は lib/weekly の純関数（weeklyNumbers / compareWeeks / weeklyHighlights）だけで行う
 * - Claude に渡すのは集計 JSON だけ（電話番号・メール・口座などの個人情報は入れない。lib/ai/context.ts と同じ方針）
 * - ANTHROPIC_API_KEY が無いときは AI を呼ばず、weeklyHighlights の結果をそのまま所見にする
 * - 結果は ai_insights（kind='weekly'、month はその週の月曜が属する月の月初日）に保存する
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/database.types";
import type { RoundingMode, TaxMode } from "@/lib/calc";
import { resolveEntryDefaults } from "@/lib/calc";
import { monthToDate } from "@/lib/month";
import {
  compareWeeks,
  jstDate,
  previousWeekRange,
  shiftDate,
  weeklyDrivers,
  weeklyHighlights,
  weeklyNumbers,
  weeklyProjects,
  weekRangeFrom,
  type WeekRange,
  type WeeklyAlertInput,
  type WeeklyBreakdownRow,
  type WeeklyComparison,
  type WeeklyEntryInput,
  type WeeklyExpenseInput,
  type WeeklyNumbers,
} from "@/lib/weekly";
import { AI_MAX_TOKENS, isAiInsightsEnabled } from "./config";
import { callClaude } from "./insights";
import {
  extractInsight,
  MAX_ACTIONS,
  MAX_FINDINGS,
  normalizeActions,
  normalizeInsightFindings,
  type InsightAction,
  type InsightFindingDetail,
} from "./findings";

/** サーバー側の supabase クライアント（ログイン中のセッション用・サービスロールのどちらでも渡せる） */
export type WeeklySupabase = SupabaseClient<Database>;

/** JSON を小さく保つための上限 */
export const WEEKLY_LIMITS = {
  /** 1 週間に読む稼働行の上限 */
  entries: 2000,
  drivers: 5,
  projects: 5,
  alerts: 10,
  /** 資金の見込みを何日先まで見るか */
  cashDays: 30,
} as const;

/** 小数 2 桁（AI に渡す JSON 用） */
function round2(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** 率は小数 4 桁 */
function round4(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : 0;
}

/* ------------------------------------------------------------ 読み込み */

interface RateSource {
  billRate: number;
  payRate: number;
  royaltyRate: number;
  roundingMode: RoundingMode;
}

/** 稼働行の単価：その月の work_entries のスナップショット → 無ければマスタ（§2.5） */
function rateKey(month: string, driverId: string, projectItemId: string): string {
  return `${month}|${driverId}|${projectItemId}`;
}

export interface WeeklyLoadOptions {
  /** サービスロールで動いているか（cron）。会社を明示する RPC を使う */
  serviceRole?: boolean;
  /** 判定の基準時刻（既定は現在時刻） */
  now?: Date;
}

/** 週次サマリーの材料（DB から読んだもの。ここでは計算しない） */
export interface WeeklySource {
  companyName: string;
  numbers: WeeklyNumbers;
  previous: WeeklyNumbers;
  comparison: WeeklyComparison;
  drivers: WeeklyBreakdownRow[];
  projects: WeeklyBreakdownRow[];
  alerts: WeeklyAlertInput[];
}

function toSeverity(v: string | null | undefined): WeeklyAlertInput["severity"] {
  return v === "high" || v === "low" ? v : "medium";
}

/**
 * 先週と前々週の稼働・経費・アラート・資金の見込みを読み、週の数字を組み立てる。
 * 稼働は「承認済みの日別の稼働（work_day_entries）」を使う（月次の work_entries は日付を持たないため）。
 */
export async function loadWeeklySource(
  supabase: WeeklySupabase,
  companyId: string,
  range: WeekRange,
  opts: WeeklyLoadOptions = {},
): Promise<WeeklySource> {
  const now = opts.now ?? new Date();
  const prevRange = previousWeekRange(range);
  const windowFrom = prevRange.from;
  const windowTo = range.to;
  const cashFrom = jstDate(now);
  const cashTo = shiftDate(cashFrom, WEEKLY_LIMITS.cashDays);

  const [companyRes, dayRes, driversRes, expenseRes, alertRes] = await Promise.all([
    supabase.from("companies").select("name, tax_rate, tax_rounding, default_royalty_rate, rounding_mode").eq("id", companyId).maybeSingle(),
    supabase
      .from("v_work_day_entry_list")
      .select("work_date, month, driver_id, driver_name, project_item_id, project_name, item_name, qty, status")
      .eq("company_id", companyId)
      .eq("status", "approved")
      .gte("work_date", windowFrom)
      .lte("work_date", windowTo)
      .order("work_date")
      .limit(WEEKLY_LIMITS.entries),
    supabase.from("drivers").select("id, name, tax_mode, royalty_rate, rounding_mode").eq("company_id", companyId),
    supabase
      .from("v_expense_list")
      .select("amount, kind, category_name, incurred_on")
      .eq("company_id", companyId)
      .gte("incurred_on", windowFrom)
      .lte("incurred_on", windowTo),
    supabase.from("alerts").select("title, severity").eq("company_id", companyId).eq("status", "open").order("severity").limit(WEEKLY_LIMITS.alerts),
  ]);
  if (companyRes.error) throw companyRes.error;
  if (dayRes.error) throw dayRes.error;
  if (driversRes.error) throw driversRes.error;
  if (expenseRes.error) throw expenseRes.error;
  if (alertRes.error) throw alertRes.error;

  const dayRows = dayRes.data ?? [];
  const months = Array.from(new Set(dayRows.map((r) => (r.month ?? "").slice(0, 7)).filter((m) => m.length === 7)));

  // 単価は「その月の稼働行（work_entries）のスナップショット」が正。無い組み合わせだけマスタから補う
  const rates = new Map<string, RateSource>();
  if (months.length > 0) {
    const { data: entryRows, error: entryError } = await supabase
      .from("work_entries")
      .select("month, driver_id, project_item_id, bill_rate, pay_rate, royalty_rate, rounding_mode")
      .eq("company_id", companyId)
      .in(
        "month",
        months.map((m) => monthToDate(m)),
      );
    if (entryError) throw entryError;
    for (const r of entryRows ?? []) {
      rates.set(rateKey((r.month ?? "").slice(0, 7), r.driver_id, r.project_item_id), {
        billRate: Number(r.bill_rate ?? 0),
        payRate: Number(r.pay_rate ?? 0),
        royaltyRate: Number(r.royalty_rate ?? 0),
        roundingMode: r.rounding_mode,
      });
    }
  }

  const company = companyRes.data;
  const driverById = new Map((driversRes.data ?? []).map((d) => [d.id, d]));

  // スナップショットが無い行のためにマスタを読む（月末の稼働がまだ月次へ反映されていない場合など）
  const missing = dayRows.filter((r) => !rates.has(rateKey((r.month ?? "").slice(0, 7), r.driver_id ?? "", r.project_item_id ?? "")));
  const itemById = new Map<string, { bill_rate: number; pay_rate: number }>();
  const overrideByKey = new Map<string, { bill_rate: number | null; pay_rate: number | null }>();
  if (missing.length > 0) {
    const [itemsRes, overridesRes] = await Promise.all([
      supabase.from("project_items").select("id, bill_rate, pay_rate").eq("company_id", companyId),
      supabase.from("driver_pay_overrides").select("driver_id, project_item_id, bill_rate, pay_rate").eq("company_id", companyId),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (overridesRes.error) throw overridesRes.error;
    for (const i of itemsRes.data ?? []) itemById.set(i.id, { bill_rate: Number(i.bill_rate ?? 0), pay_rate: Number(i.pay_rate ?? 0) });
    for (const o of overridesRes.data ?? []) overrideByKey.set(`${o.driver_id}|${o.project_item_id}`, { bill_rate: o.bill_rate, pay_rate: o.pay_rate });
  }

  const entries: WeeklyEntryInput[] = [];
  for (const row of dayRows) {
    const workDate = row.work_date ?? "";
    const driverId = row.driver_id ?? "";
    const itemId = row.project_item_id ?? "";
    if (!workDate || !driverId || !itemId) continue;
    const driver = driverById.get(driverId);
    let rate = rates.get(rateKey((row.month ?? "").slice(0, 7), driverId, itemId));
    if (!rate) {
      const item = itemById.get(itemId);
      const override = overrideByKey.get(`${driverId}|${itemId}`);
      const defaults = resolveEntryDefaults({
        item: { billRate: item?.bill_rate ?? 0, payRate: item?.pay_rate ?? 0 },
        override: override ? { billRate: override.bill_rate, payRate: override.pay_rate } : null,
        driver: { royaltyRate: driver?.royalty_rate ?? null, roundingMode: driver?.rounding_mode ?? null },
        company: { defaultRoyaltyRate: Number(company?.default_royalty_rate ?? 0), roundingMode: company?.rounding_mode ?? "none" },
      });
      rate = { billRate: defaults.billRate, payRate: defaults.payRate, royaltyRate: defaults.royaltyRate, roundingMode: defaults.roundingMode };
    }
    entries.push({
      workDate,
      driverId,
      driverName: row.driver_name ?? "",
      projectName: row.project_name ?? "",
      itemName: row.item_name ?? "",
      qty: Number(row.qty ?? 0),
      billRate: rate.billRate,
      payRate: rate.payRate,
      royaltyRate: rate.royaltyRate,
      roundingMode: rate.roundingMode,
      taxMode: (driver?.tax_mode as TaxMode | undefined) ?? "taxable",
    });
  }

  const inRange = (date: string, r: WeekRange) => date >= r.from && date <= r.to;
  const expensesOf = (r: WeekRange): WeeklyExpenseInput[] =>
    (expenseRes.data ?? [])
      .filter((e) => inRange(e.incurred_on ?? "", r))
      .map((e) => ({ category: e.category_name ?? "", kind: e.kind === "fixed" ? "fixed" : "variable", amount: Number(e.amount ?? 0) }));

  const alerts: WeeklyAlertInput[] = (alertRes.data ?? []).map((a) => ({ title: a.title ?? "", severity: toSeverity(a.severity) }));

  // 資金の見込み（取れなければサマリーは続ける）
  const cashEvents = await loadCashEvents(supabase, companyId, cashFrom, cashTo, opts.serviceRole).catch(() => null);
  const { data: snapshots } = await supabase
    .from("cash_snapshots")
    .select("as_of, balance")
    .eq("company_id", companyId)
    .order("as_of", { ascending: false })
    .limit(1);
  const balance = snapshots && snapshots[0] ? Number(snapshots[0].balance ?? 0) : null;

  const tax = company ? { rate: Number(company.tax_rate ?? 0), rounding: (company.tax_rounding as RoundingMode) ?? "floor" } : null;
  const currentEntries = entries.filter((e) => inRange(e.workDate, range));
  const previousEntries = entries.filter((e) => inRange(e.workDate, prevRange));

  const numbers = weeklyNumbers({
    range,
    entries: currentEntries,
    expenses: expensesOf(range),
    alerts,
    cash: cashEvents ? { from: cashFrom, to: cashTo, events: cashEvents, balance } : null,
    tax,
  });
  const previous = weeklyNumbers({ range: prevRange, entries: previousEntries, expenses: expensesOf(prevRange), tax });

  return {
    companyName: company?.name ?? "",
    numbers,
    previous,
    comparison: compareWeeks(numbers, previous),
    drivers: weeklyDrivers(currentEntries, WEEKLY_LIMITS.drivers),
    projects: weeklyProjects(currentEntries, WEEKLY_LIMITS.projects),
    alerts,
  };
}

/** 資金の見込み（サービスロールは会社を明示する RPC、ログイン中は自社を返す RPC） */
async function loadCashEvents(
  supabase: WeeklySupabase,
  companyId: string,
  from: string,
  to: string,
  serviceRole?: boolean,
): Promise<{ amount: number | null }[]> {
  if (serviceRole) {
    const { data, error } = await supabase.rpc("cash_forecast_for", { p_company_id: companyId, p_from: from, p_to: to });
    if (error) throw error;
    return (data ?? []) as { amount: number | null }[];
  }
  const { data, error } = await supabase.rpc("cash_forecast", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as { amount: number | null }[];
}

/* ------------------------------------------------------------ AI に渡す JSON */

/** Claude に渡す集計だけの JSON（個人情報は入れない） */
export interface WeeklyContext {
  generated_at: string;
  week: { from: string; to: string; label: string };
  company: { name: string };
  numbers: Record<string, number>;
  previous: Record<string, number>;
  compare: { key: string; label: string; current: number; previous: number; diff: number; rate: number | null }[];
  drivers: { name: string; entry_count: number; qty: number; bill: number; profit: number; profit_rate: number }[];
  projects: { name: string; entry_count: number; qty: number; bill: number; profit: number; profit_rate: number }[];
  alerts: { title: string; severity: string }[];
  cash: { from: string; to: string; inflow: number; outflow: number; ending_balance: number | null } | null;
}

function toNumbersJson(n: WeeklyNumbers): Record<string, number> {
  return {
    entry_count: n.entryCount,
    active_entry_count: n.activeEntryCount,
    work_day_count: n.workDayCount,
    driver_count: n.driverCount,
    qty_total: round2(n.qtyTotal),
    bill: round2(n.bill),
    pay: round2(n.pay),
    margin: round2(n.margin),
    royalty: round2(n.royalty),
    profit: round2(n.profit),
    profit_rate: round4(n.profitRate),
    payout: round2(n.payout),
    tax: round2(n.tax),
    payout_incl: round2(n.payoutIncl),
    expense_total: round2(n.expenseTotal),
    expense_fixed: round2(n.expenseFixed),
    expense_variable: round2(n.expenseVariable),
    operating_profit: round2(n.operatingProfit),
    operating_margin: round4(n.operatingMargin),
    open_alert_count: n.openAlertCount,
    high_alert_count: n.highAlertCount,
  };
}

function toBreakdownJson(rows: WeeklyBreakdownRow[]) {
  return rows.map((r) => ({
    name: r.name,
    entry_count: r.entryCount,
    qty: round2(r.qty),
    bill: round2(r.bill),
    profit: round2(r.profit),
    profit_rate: round4(r.profitRate),
  }));
}

/** 集計だけのデータパックを作る */
export function buildWeeklyContext(source: WeeklySource, range: WeekRange, now: Date = new Date()): WeeklyContext {
  const { numbers, previous, comparison } = source;
  return {
    generated_at: jstDate(now),
    week: { from: range.from, to: range.to, label: range.label },
    company: { name: source.companyName },
    numbers: toNumbersJson(numbers),
    previous: toNumbersJson(previous),
    compare: comparison.items.map((d) => ({
      key: d.key,
      label: d.label,
      current: round2(d.current),
      previous: round2(d.previous),
      diff: round2(d.diff),
      rate: d.rate == null ? null : round4(d.rate),
    })),
    drivers: toBreakdownJson(source.drivers),
    projects: toBreakdownJson(source.projects),
    alerts: source.alerts.map((a) => ({ title: a.title, severity: a.severity })),
    cash: numbers.cash
      ? {
          from: numbers.cash.from,
          to: numbers.cash.to,
          inflow: round2(numbers.cash.inflow),
          outflow: round2(numbers.cash.outflow),
          ending_balance: numbers.cash.endingBalance == null ? null : round2(numbers.cash.endingBalance),
        }
      : null,
  };
}

export const WEEKLY_SYSTEM_PROMPT = [
  "あなたは軽貨物運送会社（業務委託ドライバーへ配送業務を委託する事業）の経営を支えるアナリストです。",
  "先週 1 週間の集計データ（JSON）だけを根拠にし、データに無いことは推測しないでください。",
  "経営者がスマホで 30 秒で読める、短くて具体的な日本語で書いてください。",
  "",
  "数値の意味：",
  "- bill＝会社売上、pay＝ドライバー売上、margin＝単価差額利益（bill−pay）、royalty＝ロイヤリティ",
  "- profit＝会社利益（margin＋royalty）。週次では管理費と調整（月単位のもの）は含めていません",
  "- payout_incl＝ドライバーへの支払（税込）、expense_total＝その週に計上した経費（税抜）",
  "- operating_profit＝営業利益（会社利益 − 経費）、operating_margin＝営業利益率",
  "- previous は前の週の同じ数値、compare は前週比（diff＝増減額、rate＝増減率）です",
  "- drivers / projects は先週の売上が多い順の内訳、alerts は未対応の注意点、cash は 30 日先までの資金の見込みです",
  "- 支払単価 0・ロイヤリティ 0%・管理費 0 のドライバーはオーナー本人など正常なケースがあるため、それだけでは異常扱いしないでください。",
  "- 1 週間は日数が短く、経費や請求の計上時期で数字が揺れます。断定せず「〜の可能性があります」と書いてください。",
  "",
  "出力形式（JSON オブジェクトのみ。コードフェンス・前置き・後書きは付けない。すべて日本語）：",
  '{"summary": "1〜2 文の総括", "findings": [{"title": "見出し（20 文字程度）", "detail": "根拠となる数値を含む 1〜2 文", "severity": "high|medium|low"}], "actions": [{"title": "今週やること（20 文字程度）", "detail": "誰が・何を・いつまでに行うかを 1〜2 文で", "effect": "週 +3 万円程度"}]}',
  `- findings は先週の要点を最大 ${Math.min(3, MAX_FINDINGS)} 件、重要な順に並べる。`,
  `- actions は今週やるべきことを最大 ${MAX_ACTIONS} 件。概算できるときだけ effect に短い効果額を書き、できなければ空文字にする。`,
].join("\n");

/** ユーザーメッセージ（集計 JSON ＋ 依頼文） */
export function buildWeeklyUserMessage(ctx: WeeklyContext): string {
  return [
    `${ctx.week.label}（先週 1 週間）の経営データです。`,
    ctx.previous.entry_count > 0 ? "前の週の数値も previous と compare に入っています。前週比にも触れてください。" : "前の週のデータはありません。先週の数値だけで判断してください。",
    "先週の要点を 3 つと、今週やるべきことを 3 つ、JSON で返してください。",
    "",
    JSON.stringify(ctx),
  ].join("\n");
}

/* ------------------------------------------------------------ 組み立て */

/** 週次サマリーの結果 */
export interface WeeklySummaryResult {
  range: WeekRange;
  companyName: string;
  numbers: WeeklyNumbers;
  previous: WeeklyNumbers;
  comparison: WeeklyComparison;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
  /** 使ったモデル（AI 抜きのときは空文字） */
  model: string;
  /** AI を使ったか */
  aiUsed: boolean;
  /** AI に失敗して数字だけのサマリーにした場合の理由（日本語） */
  aiError: string;
  /** LINE や画面に出す要点（AI があればその所見、無ければ weeklyHighlights） */
  highlights: string[];
}

/** weeklyHighlights の結果を所見の形にする（AI が無いとき用） */
export function highlightsToFindings(highlights: readonly string[]): InsightFindingDetail[] {
  return highlights.slice(0, MAX_FINDINGS).map((text, i) => ({
    title: text.length > 24 ? `${text.slice(0, 24)}…` : text,
    detail: text,
    severity: i === 0 ? "high" : "medium",
  }));
}

export interface BuildWeeklyOptions extends WeeklyLoadOptions {
  /** AI を使わずに数字だけのサマリーを作る */
  skipAi?: boolean;
}

/**
 * 週次サマリーを組み立てる。
 * ANTHROPIC_API_KEY が無いとき・AI の呼び出しに失敗したときは、weeklyHighlights の結果をそのまま使う
 * （鍵が無くても「数字だけのサマリー」が必ず届く）。
 */
export async function buildWeeklySummary(
  supabase: WeeklySupabase,
  companyId: string,
  range: WeekRange,
  opts: BuildWeeklyOptions = {},
): Promise<WeeklySummaryResult> {
  const now = opts.now ?? new Date();
  const source = await loadWeeklySource(supabase, companyId, range, opts);
  const fallback = weeklyHighlights(source.numbers, source.alerts, source.comparison);

  const base: WeeklySummaryResult = {
    range,
    companyName: source.companyName,
    numbers: source.numbers,
    previous: source.previous,
    comparison: source.comparison,
    summary: fallback[0] ?? "",
    findings: highlightsToFindings(fallback),
    actions: [],
    model: "",
    aiUsed: false,
    aiError: "",
    highlights: fallback,
  };

  if (opts.skipAi || !isAiInsightsEnabled()) return base;

  try {
    const ctx = buildWeeklyContext(source, range, now);
    const { model, text } = await callClaude({
      system: WEEKLY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildWeeklyUserMessage(ctx) }],
      maxTokens: AI_MAX_TOKENS.analysis,
      emptyMessage: "AI から週次サマリーが返りませんでした。",
    });
    const { summary, findings, actions } = extractInsight(text);
    const points = findings.slice(0, 3).map((f) => (f.detail ? `${f.title}：${f.detail}` : f.title));
    return {
      ...base,
      summary: summary || base.summary,
      findings: findings.length > 0 ? findings : base.findings,
      actions,
      model,
      aiUsed: true,
      highlights: points.length > 0 ? points : fallback,
    };
  } catch (e) {
    // AI が使えなくても数字だけのサマリーは届ける
    return { ...base, aiError: e instanceof Error ? e.message : "AI の呼び出しに失敗しました。" };
  }
}

/* ------------------------------------------------------------ 保存と読み出し */

/** 週次サマリーを ai_insights（kind='weekly'）に保存する */
export async function saveWeeklyInsight(
  supabase: WeeklySupabase,
  companyId: string,
  result: WeeklySummaryResult,
  createdBy: string | null = null,
): Promise<string> {
  const { data, error } = await supabase
    .from("ai_insights")
    .insert({
      company_id: companyId,
      month: monthToDate(result.range.from.slice(0, 7)),
      kind: "weekly",
      model: result.model,
      summary: weeklySummaryText(result),
      findings: result.findings as unknown as Json,
      actions: result.actions as unknown as Json,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data?.id ?? "";
}

/**
 * 保存する総括。どの週のものかを先頭に付けて、一覧から週を見分けられるようにする
 * （ai_insights には週の列が無いため、月だけでは月内の 4〜5 本を区別できない）。
 */
export function weeklySummaryText(result: WeeklySummaryResult): string {
  const head = `${result.range.from}〜${result.range.to}`;
  return `[${head}] ${result.summary}`.trim();
}

/** 保存した総括から週の範囲を取り出す（先頭の [2026-09-08〜2026-09-14]） */
export function parseWeeklySummary(summary: string | null | undefined): { from: string; to: string; text: string } | null {
  const m = /^\[(\d{4}-\d{2}-\d{2})〜(\d{4}-\d{2}-\d{2})\]\s*([\s\S]*)$/.exec((summary ?? "").trim());
  if (!m) return null;
  return { from: m[1], to: m[2], text: m[3].trim() };
}

/** 画面に出す保存済みの週次サマリー 1 件 */
export interface WeeklyInsightRow {
  id: string;
  createdAt: string;
  model: string;
  /** 週のはじめ（月曜）。総括から取り出せなければ月初日 */
  from: string;
  to: string;
  label: string;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
}

/**
 * 保存済みの週次サマリーを新しい順に読む（画面の履歴）。
 * 同じ週を作り直したときは新しいものだけを残す（作り直しても履歴が二重に並ばない）。
 */
export async function loadWeeklyInsights(supabase: WeeklySupabase, companyId: string, limit = 12): Promise<WeeklyInsightRow[]> {
  const { data, error } = await supabase
    .from("ai_insights")
    .select("id, created_at, model, summary, findings, actions")
    .eq("company_id", companyId)
    .eq("kind", "weekly")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit, 1) * 3);
  if (error) throw error;
  const rows = (data ?? []).map((row) => {
    const parsed = parseWeeklySummary(row.summary);
    const range = parsed ? weekRangeFrom(parsed.from) : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      model: row.model ?? "",
      from: range?.from ?? "",
      to: range?.to ?? "",
      label: range?.label ?? "",
      summary: parsed?.text ?? row.summary ?? "",
      findings: normalizeInsightFindings(row.findings),
      actions: normalizeActions(row.actions),
    };
  });
  const seen = new Set<string>();
  const unique: WeeklyInsightRow[] = [];
  for (const row of rows) {
    const key = row.from || row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  return unique;
}
