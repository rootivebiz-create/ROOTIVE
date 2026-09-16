"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/actions/result";
import { monthSchema } from "@/lib/schemas/common";
import { monthToDate } from "@/lib/month";
import { isAiInsightsEnabled } from "@/lib/ai/config";
import { loadInsightSource, requestInsights } from "@/lib/ai/insights";
import type { InsightFinding } from "@/lib/ai/findings";

export interface GenerateInsightsResult {
  model: string;
  findings: InsightFinding[];
}

/**
 * AI 月次分析（§4.1）：当月の集計 JSON を Claude に渡し、所見を ai_insights に保存する。
 * admin 以上。ANTHROPIC_API_KEY が無い場合はエラー。
 */
export async function generateInsightsAction(month: string): Promise<ActionResult<GenerateInsightsResult>> {
  return runAction(async () => {
    const { supabase, user, company } = await requireAdminAction();
    const m = monthSchema.parse(month);
    if (!isAiInsightsEnabled()) throw new ActionError("ANTHROPIC_API_KEY が設定されていません");

    const source = await loadInsightSource(supabase, company.id, m);
    if (source.company.entry_count === 0 && source.drivers.length === 0) {
      throw new ActionError("この月には稼働データがないため分析できません。");
    }

    const { model, findings } = await requestInsights(source);

    const { error } = await supabase.from("ai_insights").insert({
      company_id: company.id,
      month: monthToDate(m),
      model,
      findings,
      created_by: user.id,
    });
    if (error) throw error;

    revalidatePath("/dashboard");
    return { model, findings };
  }, "AI 月次分析を保存しました。");
}
