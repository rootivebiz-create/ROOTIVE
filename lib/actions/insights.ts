"use server";

import type { ActionResult } from "@/lib/actions/result";
import { generateAnalysisAction } from "@/lib/actions/ai";
import type { InsightAction, InsightFindingDetail } from "@/lib/ai/findings";

/**
 * AI 月次分析の結果。
 * 旧ダッシュボードカードが使っていた { model, findings } の形は維持したまま、
 * 総括（summary）と改善策（actions）を足している。
 */
export interface GenerateInsightsResult {
  model: string;
  /** 所見（重さ付き。InsightFinding と互換） */
  findings: InsightFindingDetail[];
  summary: string;
  actions: InsightAction[];
}

/**
 * AI 月次分析（§4.1 → AI の経営分析）：当月のデータパックを Claude に渡し、
 * 総括・所見・改善策を ai_insights（kind='monthly'）に保存する。
 * 実体は lib/actions/ai.ts の generateAnalysisAction（admin 以上・ANTHROPIC_API_KEY 必須）。
 */
export async function generateInsightsAction(month: string): Promise<ActionResult<GenerateInsightsResult>> {
  const res = await generateAnalysisAction(month);
  if (!res.ok) return res;
  const { model, summary, findings, actions } = res.data;
  return { ok: true, data: { model, findings, summary, actions }, message: res.message };
}
