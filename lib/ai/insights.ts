import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { DriverMonthSummary, MonthSummary, ProjectSummary } from "@/lib/db/types";
import { formatMonthJa, monthToDate, prevMonth } from "@/lib/month";
import { ActionError } from "@/lib/actions/result";
import { resolveAnthropicModel } from "./config";
import { extractFindings, MAX_FINDINGS, type InsightFinding } from "./findings";

/** 小数 2 桁に丸めた数値（JSON を小さくするため） */
function n(v: number | null | undefined): number {
  return Math.round(Number(v ?? 0) * 100) / 100;
}

export interface InsightCompanySummary {
  month: string;
  status: "open" | "closed";
  driver_count: number;
  active_driver_count: number;
  entry_count: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmt_fee: number;
  adj_pay: number;
  adj_profit: number;
  payout: number;
  profit: number;
  profit_rate: number;
}

export interface InsightDriverRow {
  name: string;
  is_active: boolean;
  entry_count: number;
  active_entry_count: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmt_fee: number;
  mgmt_fee_setting: number;
  driver_default_mgmt_fee: number;
  adj_pay: number;
  adj_profit: number;
  payout: number;
  driver_profit: number;
  profit_rate: number;
}

export interface InsightProjectRow {
  project: string;
  item: string;
  unit: "day" | "piece";
  entry_count: number;
  driver_count: number;
  qty_total: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  entry_profit: number;
  profit_rate: number;
}

/** Claude に渡す集計 JSON（当月の会社・ドライバー・案件別 ＋ 前月の会社） */
export interface InsightSource {
  month: string;
  month_label: string;
  company: InsightCompanySummary;
  previous_month: InsightCompanySummary | null;
  drivers: InsightDriverRow[];
  projects: InsightProjectRow[];
}

function toCompany(row: MonthSummary, month: string): InsightCompanySummary {
  return {
    month,
    status: row.status === "closed" ? "closed" : "open",
    driver_count: Number(row.driver_count ?? 0),
    active_driver_count: Number(row.active_driver_count ?? 0),
    entry_count: Number(row.entry_count ?? 0),
    bill: n(row.bill),
    pay: n(row.pay),
    margin: n(row.margin),
    royalty: n(row.royalty),
    mgmt_fee: n(row.mgmt_fee),
    adj_pay: n(row.adj_pay),
    adj_profit: n(row.adj_profit),
    payout: n(row.payout),
    profit: n(row.profit),
    profit_rate: Number(row.profit_rate ?? 0),
  };
}

function toDriver(row: DriverMonthSummary): InsightDriverRow {
  const bill = Number(row.bill ?? 0);
  const profit = Number(row.driver_profit ?? 0);
  return {
    name: row.driver_name ?? "",
    is_active: Boolean(row.driver_is_active),
    entry_count: Number(row.entry_count ?? 0),
    active_entry_count: Number(row.active_entry_count ?? 0),
    bill: n(bill),
    pay: n(row.pay),
    margin: n(row.margin),
    royalty: n(row.royalty),
    mgmt_fee: n(row.mgmt_fee),
    mgmt_fee_setting: n(row.mgmt_fee_setting),
    driver_default_mgmt_fee: n(row.driver_default_mgmt_fee),
    adj_pay: n(row.adj_pay),
    adj_profit: n(row.adj_profit),
    payout: n(row.payout),
    driver_profit: n(profit),
    profit_rate: bill !== 0 ? Math.round((profit / bill) * 10_000) / 10_000 : 0,
  };
}

function toProject(row: ProjectSummary): InsightProjectRow {
  return {
    project: row.project_name ?? "",
    item: row.item_name ?? "",
    unit: row.unit === "piece" ? "piece" : "day",
    entry_count: Number(row.entry_count ?? 0),
    driver_count: Number(row.driver_count ?? 0),
    qty_total: n(row.qty_total),
    bill: n(row.bill),
    pay: n(row.pay),
    margin: n(row.margin),
    royalty: n(row.royalty),
    entry_profit: n(row.entry_profit),
    profit_rate: Number(row.profit_rate ?? 0),
  };
}

/** 当月の v_month_summary / v_driver_month_summary / v_project_summary と前月の v_month_summary を取得して JSON 化する */
export async function loadInsightSource(supabase: ServerSupabase, companyId: string, month: string): Promise<InsightSource> {
  const monthDate = monthToDate(month);
  const prev = prevMonth(month);
  const [companyRes, prevRes, driversRes, projectsRes] = await Promise.all([
    supabase.from("v_month_summary").select("*").eq("company_id", companyId).eq("month", monthDate).maybeSingle(),
    supabase.from("v_month_summary").select("*").eq("company_id", companyId).eq("month", monthToDate(prev)).maybeSingle(),
    supabase.from("v_driver_month_summary").select("*").eq("company_id", companyId).eq("month", monthDate).order("driver_sort_order").order("driver_name"),
    supabase.from("v_project_summary").select("*").eq("company_id", companyId).eq("month", monthDate).order("project_name").order("item_name"),
  ]);
  if (companyRes.error) throw companyRes.error;
  if (prevRes.error) throw prevRes.error;
  if (driversRes.error) throw driversRes.error;
  if (projectsRes.error) throw projectsRes.error;

  const empty: MonthSummary = {
    company_id: companyId,
    month: monthDate,
    driver_count: 0,
    active_driver_count: 0,
    entry_count: 0,
    bill: 0,
    pay: 0,
    margin: 0,
    royalty: 0,
    mgmt_fee: 0,
    adj_pay: 0,
    adj_profit: 0,
    payout: 0,
    profit: 0,
    profit_rate: 0,
    status: "open",
    closed_at: null,
    closed_by: null,
    reopened_at: null,
    backup_path: null,
    closing_note: null,
  };

  return {
    month,
    month_label: formatMonthJa(month),
    company: toCompany(companyRes.data ?? empty, month),
    previous_month: prevRes.data ? toCompany(prevRes.data, prev) : null,
    drivers: (driversRes.data ?? []).map(toDriver),
    projects: (projectsRes.data ?? []).map(toProject),
  };
}

export const INSIGHT_SYSTEM_PROMPT = [
  "あなたは軽貨物運送会社（業務委託ドライバーへ配送業務を委託する事業）の月次経営分析を行うアナリストです。",
  "与えられた集計データ（JSON）に含まれる数値だけを根拠にし、データに無いことは推測しないでください。",
  "「〜の可能性があります」「〜を確認してください」のように断定しすぎない表現を使い、原因を決めつけないでください。",
  "",
  "数値の意味：",
  "- bill＝会社売上（受注単価×数量）、pay＝ドライバー売上（支払単価×数量）、margin＝単価差額利益（bill−pay）",
  "- royalty＝ロイヤリティ（pay×率）、mgmt_fee＝管理費（稼働がある月だけ計上）、adj_pay＝支払に反映した調整、adj_profit＝会社利益に計上した調整",
  "- payout＝ドライバーへの支払額、profit / driver_profit＝会社利益（margin＋royalty＋mgmt_fee＋adj_profit）、profit_rate＝利益率（会社利益÷会社売上）",
  "- 支払単価 0・ロイヤリティ 0%・管理費 0 のドライバーはオーナー本人など正常なケースがあるため、それだけでは異常扱いしないでください。",
  "- mgmt_fee_setting が driver_default_mgmt_fee と異なる場合は入力ミスの可能性として指摘してください。",
  "",
  "出力形式：",
  `- 所見は最大 ${MAX_FINDINGS} 項目。重要な順に並べる。`,
  '- JSON 配列のみを返す：[{"title": "見出し（20 文字程度）", "detail": "根拠となる数値を含む 1〜3 文の説明"}]',
  "- コードフェンス・前置き・後書きは付けない。すべて日本語で書く。",
].join("\n");

/** ユーザーメッセージ（集計 JSON） */
export function buildInsightUserMessage(source: InsightSource): string {
  const lines = [
    `${source.month_label} の集計データです。会社全体・ドライバー別・案件別の数値と、比較用に前月の会社全体の数値を含みます。`,
    source.previous_month ? "前月比・利益率・ドライバー間の差・案件ごとの利益率・入力ミスの疑いなどの観点で所見を作成してください。" : "前月のデータはありません。当月の数値だけから所見を作成してください。",
    "",
    JSON.stringify(source),
  ];
  return lines.join("\n");
}

export interface InsightResult {
  model: string;
  findings: InsightFinding[];
  raw: string;
}

/** Claude に月次分析を依頼し、所見の配列を返す（API キーは呼び出し元で確認済みであること） */
export async function requestInsights(source: InsightSource): Promise<InsightResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ActionError("ANTHROPIC_API_KEY が設定されていません");
  const model = resolveAnthropicModel();
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: INSIGHT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildInsightUserMessage(source) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ActionError("ANTHROPIC_API_KEY が無効です。設定を確認してください。");
    if (e instanceof Anthropic.PermissionDeniedError) throw new ActionError("この API キーではモデルを利用できません。");
    if (e instanceof Anthropic.NotFoundError) throw new ActionError(`モデル「${model}」が見つかりません。ANTHROPIC_MODEL を確認してください。`);
    if (e instanceof Anthropic.RateLimitError) throw new ActionError("AI の利用制限に達しました。しばらく待ってから再度お試しください。");
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ActionError("AI の応答がタイムアウトしました。もう一度お試しください。");
    if (e instanceof Anthropic.APIConnectionError) throw new ActionError("AI サービスに接続できませんでした。");
    if (e instanceof Anthropic.APIError) throw new ActionError(`AI 分析に失敗しました（${e.status ?? "?"}）: ${e.message}`);
    throw e;
  }

  if (response.stop_reason === "refusal") throw new ActionError("AI が分析を実行できませんでした。時間をおいて再度お試しください。");
  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!raw) throw new ActionError("AI から所見が返りませんでした。");
  return { model: response.model || model, findings: extractFindings(raw), raw };
}
