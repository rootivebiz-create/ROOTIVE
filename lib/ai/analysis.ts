/**
 * 月次の分析と改善策（目標 × 着地見込み × 実績の三面分析）。
 * 既存の lib/ai/insights.ts（所見だけを返す形）を土台に、総括と改善策まで作る。
 * データは lib/ai/context.ts のデータパック（v_* ビューと RPC の結果）だけを根拠にする。
 */
import "server-only";
import { AI_MAX_TOKENS } from "./config";
import { callClaude } from "./insights";
import { extractInsight, MAX_ACTIONS, MAX_FINDINGS, type InsightAction, type InsightFindingDetail } from "./findings";
import { prevMonth, formatMonthJa, addMonths } from "@/lib/month";
import type { AiContext } from "./context";

export const ANALYSIS_SYSTEM_PROMPT = [
  "あなたは軽貨物運送会社（業務委託ドライバーへ配送業務を委託する事業）の経営を支える月次アナリストです。",
  "与えられたデータ（JSON）に含まれる数値だけを根拠にし、データに無いことは推測しないでください。",
  "「〜の可能性があります」「〜を確認してください」のように断定しすぎない表現を使い、原因を決めつけないでください。",
  "",
  "数値の意味：",
  "- bill＝会社売上（受注単価×数量）、pay＝ドライバー売上（支払単価×数量）、margin＝単価差額利益（bill−pay）",
  "- royalty＝ロイヤリティ（pay×率）、mgmt_fee＝管理費（稼働がある月だけ計上）、payout＝ドライバーへの支払額（税抜）",
  "- profit / driver_profit＝会社利益（margin＋royalty＋管理費＋利益計上の調整）、profit_rate＝利益率（会社利益÷会社売上）",
  "- expense_total＝その月の経費（税抜。fixed＝固定費、variable＝変動費）",
  "- operating_profit＝営業利益（会社利益 − 経費）、operating_margin＝営業利益率",
  "- bill_target / profit_target＝その月の売上目標・営業利益目標（0 は未設定なので触れないでください）",
  "- months は古い順の月次推移、current は当月の実績、forecast は当月が未締めのときの着地見込みです",
  "- forecast の basis=prorated は「月の経過率での按分」、progress＝月の経過率、reliability＝見込みの確からしさ（low は月初で参考値）",
  "- projects は案件別の採算（project_profit＝案件の利益、project_margin＝案件の利益率、below_target＝目標利益率を下回っている）",
  "- invoices は未入金の請求書、cash は今日から先の入金予定・支払予定の集計（ending_balance＝見込み残高）",
  "- alerts はシステムが検知した未対応の注意点です",
  "- 支払単価 0・ロイヤリティ 0%・管理費 0 のドライバーはオーナー本人など正常なケースがあるため、それだけでは異常扱いしないでください。",
  "- 経費が 0 件の月は「未入力の可能性」として軽く触れる程度にしてください。",
  "",
  "必ず触れること：",
  "- 売上目標・営業利益目標に対する達成率（目標が設定されている場合）",
  "- kpi があるときは、限界利益率・損益分岐点売上高（break_even_bill）・支払比率・ドライバー 1 人当たりの売上と利益に触れる。",
  "  損益分岐点売上高を上回っているかを明言し、下回っていれば「あと何円の売上で黒字か」を書く。",
  "- loans があるときは、毎月の返済が資金繰りを圧迫していないかに触れる。tax_tasks に近い期限があれば、納税資金の確保を促す。",
  "- 当月が未締めなら、着地見込みと目標の差（不足額・超過額）",
  "- 前月との比較、および 12 か月の推移に前年同月があればその比較",
  "",
  "出力形式（JSON オブジェクトのみ。コードフェンス・前置き・後書きは付けない。すべて日本語）：",
  '{"summary": "2〜3 文の総括（当月の状況と目標に対する位置づけ）", "findings": [{"title": "見出し（20 文字程度）", "detail": "根拠となる数値を含む 1〜3 文", "severity": "high|medium|low"}], "actions": [{"title": "改善策（20 文字程度）", "detail": "誰が・何を・どれくらい行うかを 1〜3 文で具体的に", "effect": "月 +12 万円程度"}]}',
  `- findings は最大 ${MAX_FINDINGS} 件、重要な順に並べる。severity は high / medium / low のいずれか。`,
  `- actions は最大 ${MAX_ACTIONS} 件の具体的な改善策。データから概算できるときだけ effect に「月 +12 万円程度」のような短い効果額を書き、概算できなければ effect は空文字にする。`,
].join("\n");

/** 前月・前年同月がデータパックに含まれているかを日本語で添える */
function comparisonNote(ctx: AiContext): string {
  const months = new Set(ctx.months.map((m) => m.month));
  const prev = prevMonth(ctx.month);
  const lastYear = addMonths(ctx.month, -12);
  const parts: string[] = [];
  parts.push(months.has(prev) ? `前月（${formatMonthJa(prev)}）の数値は months に含まれています。` : "前月のデータはありません。");
  if (months.has(lastYear)) parts.push(`前年同月（${formatMonthJa(lastYear)}）の数値も months に含まれています。`);
  return parts.join("");
}

/** ユーザーメッセージ（データパック JSON ＋ 依頼文） */
export function buildAnalysisUserMessage(ctx: AiContext): string {
  return [
    `${ctx.month_label}（${ctx.is_closed ? "締め済み" : "未締め"}）の経営データです。`,
    comparisonNote(ctx),
    ctx.forecast
      ? "当月は未締めのため forecast に着地見込みがあります。目標・着地見込み・実績の三つを突き合わせて分析してください。"
      : "着地見込みはありません（締め済み、または予測できる稼働がありません）。実績と目標を突き合わせて分析してください。",
    "所見（findings）と、明日から実行できる改善策（actions）を作成してください。",
    "",
    JSON.stringify(ctx),
  ].join("\n");
}

export interface MonthlyAnalysisResult {
  model: string;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
  /** モデルの応答そのまま（保存はしないが、取り出しに失敗したときの手掛かりになる） */
  raw: string;
}

/** Claude に月次の分析と改善策を依頼する（API キーの有無は呼び出し元で確認済みであること） */
export async function requestMonthlyAnalysis(ctx: AiContext): Promise<MonthlyAnalysisResult> {
  const { model, text } = await callClaude({
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildAnalysisUserMessage(ctx) }],
    maxTokens: AI_MAX_TOKENS.analysis,
    emptyMessage: "AI から分析結果が返りませんでした。",
  });
  const { summary, findings, actions } = extractInsight(text);
  return { model, summary, findings, actions, raw: text };
}
