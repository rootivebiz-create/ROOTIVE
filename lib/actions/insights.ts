"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, runAction, type ActionResult } from "@/lib/actions/result";
import { generateAnalysisAction } from "@/lib/actions/ai";
import { MANAGEMENT_VIEW_ROLES, requireManagerAction } from "@/lib/auth/session";
import type { InsightAction, InsightFindingDetail } from "@/lib/ai/findings";
import { buildWeeklySummary, loadWeeklyInsights, saveWeeklyInsight } from "@/lib/ai/weekly";
import { multicastLineMessage } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { weekLinkPath, weekRange, weekRangeFrom, weeklyLineText } from "@/lib/weekly";

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

/* ------------------------------------------------------------ 週次サマリー */

/** 週のはじめ（月曜）"YYYY-MM-DD"。省略すると先週 */
const weekFromSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "週のはじめの日付が正しくありません")
  .optional();

/** 週次サマリーの作成結果（画面に返すぶん） */
export interface WeeklySummaryActionResult {
  /** 週のはじめ（月曜）と終わり（日曜） */
  from: string;
  to: string;
  label: string;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
  /** 使ったモデル（AI 抜きのときは空文字） */
  model: string;
  aiUsed: boolean;
}

/**
 * 週次サマリーを手動で作る（admin 以上）。
 * 毎週月曜の Cron（/api/cron/weekly）と同じ処理をその場で実行し、ai_insights（kind='weekly'）へ保存する。
 * ANTHROPIC_API_KEY が無いときは AI を呼ばず、数字だけのサマリーを保存する。
 */
export async function generateWeeklySummaryAction(weekFrom?: string): Promise<ActionResult<WeeklySummaryActionResult>> {
  return runAction(async () => {
    const { supabase, user, company } = await requireManagerAction();
    const input = weekFromSchema.parse(weekFrom);
    const range = input ? weekRangeFrom(input) : weekRange(new Date());

    const result = await buildWeeklySummary(supabase, company.id, range);
    await saveWeeklyInsight(supabase, company.id, result, user.id);

    revalidatePath("/ai");
    return {
      from: range.from,
      to: range.to,
      label: range.label,
      summary: result.summary,
      findings: result.findings,
      actions: result.actions,
      model: result.model,
      aiUsed: result.aiUsed,
    };
  }, "週次サマリーを作成しました");
}

/** LINE へ送った結果 */
export interface SendWeeklySummaryResult {
  sent: number;
  label: string;
}

/**
 * 保存済みの週次サマリーを LINE へ送る（admin 以上）。
 * 送り先は LINE 連携しているスタッフのうち、経営の数字を見てよい人（owner・admin・viewer。事務員は外す）。
 * 数字は保存時ではなく送信時に集計し直す（あとから稼働を直しても正しい数字が届く）。
 */
export async function sendWeeklySummaryAction(weekFrom?: string): Promise<ActionResult<SendWeeklySummaryResult>> {
  return runAction(async () => {
    const { supabase, company } = await requireManagerAction();
    const input = weekFromSchema.parse(weekFrom);
    const range = input ? weekRangeFrom(input) : weekRange(new Date());

    const { data: staff, error: staffError } = await supabase
      .from("profiles")
      .select("line_user_id, is_active, role")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .in("role", MANAGEMENT_VIEW_ROLES);
    if (staffError) throw staffError;
    const to = (staff ?? []).map((s) => (s.line_user_id ?? "").trim()).filter((v) => v.length > 0);
    if (to.length === 0) {
      throw new ActionError("LINE 連携しているスタッフがいません。設定 → 外部連携 で連携してください。");
    }

    // 送る本文は AI を呼ばずに作り直し、保存済みの総括・所見があればそれを使う
    const numbers = await buildWeeklySummary(supabase, company.id, range, { skipAi: true });
    const saved = (await loadWeeklyInsights(supabase, company.id, 12)).find((row) => row.from === range.from);
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const text = weeklyLineText({
      companyName: company.name,
      numbers: numbers.numbers,
      summary: saved?.summary ?? numbers.summary,
      highlights: saved && saved.findings.length > 0 ? saved.findings.slice(0, 3).map((f) => (f.detail ? `${f.title}：${f.detail}` : f.title)) : numbers.highlights,
      url: appUrl ? `${appUrl}${weekLinkPath(range)}` : null,
    });

    const result = await multicastLineMessage(company.id, to, text);
    await logIntegration(company.id, "line", "weekly_summary", "ok", `${range.label}の週次サマリーを ${result.sent} 人に送りました`, {
      from: range.from,
      to: range.to,
    });
    return { sent: result.sent, label: range.label };
  }, "週次サマリーを LINE へ送りました");
}
