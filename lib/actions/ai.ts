"use server";

import { revalidatePath } from "next/cache";
import { canEdit, requireAdminAction, requireStaffAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import { AI_DISABLED_MESSAGE, isAiInsightsEnabled } from "@/lib/ai/config";
import { loadAiContext } from "@/lib/ai/context";
import { requestChatReply } from "@/lib/ai/chat";
import { requestMonthlyAnalysis } from "@/lib/ai/analysis";
import { requestDraft } from "@/lib/ai/draft";
import type { InsightAction, InsightFindingDetail } from "@/lib/ai/findings";
import { loadAiMessages } from "@/lib/db/queries";
import {
  conversationTitleFrom,
  deleteAiConversationSchema,
  generateAnalysisSchema,
  generateDraftSchema,
  renameAiConversationSchema,
  sendAiChatSchema,
  startAiChatSchema,
  type DraftKind,
  type DraftParamsInput,
} from "@/lib/schemas/ai";
import { currentMonthJST, dateToMonth, monthToDate } from "@/lib/month";

/** API キーが無いときは日本語のエラーにする（画面側はボタンを無効にして呼ばせない） */
function assertAiEnabled(): void {
  if (!isAiInsightsEnabled()) throw new ActionError(AI_DISABLED_MESSAGE);
}

function revalidateAi(conversationId?: string): void {
  revalidatePath("/ai");
  if (conversationId) revalidatePath(`/ai/${conversationId}`);
}

export interface AiChatReply {
  conversationId: string;
  answer: string;
  model: string;
  /** 何か月分の推移を渡したか（ai_messages.data_months） */
  dataMonths: number;
}

/* ------------------------------------------------------------ AI チャット */

/**
 * 新しい相談を始める（staff）。
 * 会話を作り、質問（user）と回答（assistant）を保存して会話 ID を返す。
 */
export async function startAiChatAction(month: string, question: string): Promise<ActionResult<AiChatReply>> {
  return runAction(async () => {
    const { supabase, user, company } = await requireStaffAction();
    const input = startAiChatSchema.parse({ month, question });
    assertAiEnabled();

    const context = await loadAiContext(supabase, company.id, input.month);
    const { model, content } = await requestChatReply({ context, history: [], question: input.question });

    const { data: conversation, error: insertError } = await supabase
      .from("ai_conversations")
      .insert({ company_id: company.id, title: conversationTitleFrom(input.question), month: monthToDate(input.month), created_by: user.id })
      .select("id")
      .single();
    if (insertError) throw insertError;
    if (!conversation) throw new ActionError("会話を作成できませんでした。");

    // 並び順が入れ替わらないよう、質問 → 回答の順に 1 件ずつ保存する（created_at で並べるため）
    const dataMonths = context.months.length;
    ensureNoError(
      await supabase.from("ai_messages").insert({
        company_id: company.id,
        conversation_id: conversation.id,
        role: "user",
        content: input.question,
        model: "",
        data_months: dataMonths,
        created_by: user.id,
      }),
    );
    ensureNoError(
      await supabase.from("ai_messages").insert({
        company_id: company.id,
        conversation_id: conversation.id,
        role: "assistant",
        content,
        model,
        data_months: dataMonths,
        created_by: user.id,
      }),
    );

    revalidateAi(conversation.id);
    return { conversationId: conversation.id, answer: content, model, dataMonths };
  });
}

/** 続けて質問する（staff）。履歴 ＋ 当月のデータパックから回答を作り、保存して返す */
export async function sendAiChatAction(conversationId: string, question: string): Promise<ActionResult<AiChatReply>> {
  return runAction(async () => {
    const { supabase, user, company } = await requireStaffAction();
    const input = sendAiChatSchema.parse({ conversationId, question });
    assertAiEnabled();

    const { data: conversation, error: conversationError } = await supabase.from("ai_conversations").select("id, month").eq("id", input.conversationId).maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) throw new ActionError("会話が見つかりません。");
    const month = conversation.month ? dateToMonth(conversation.month) : currentMonthJST();

    const [history, context] = await Promise.all([loadAiMessages(supabase, conversation.id), loadAiContext(supabase, company.id, month)]);
    const { model, content } = await requestChatReply({ context, history, question: input.question });

    const dataMonths = context.months.length;
    ensureNoError(
      await supabase.from("ai_messages").insert({
        company_id: company.id,
        conversation_id: conversation.id,
        role: "user",
        content: input.question,
        model: "",
        data_months: dataMonths,
        created_by: user.id,
      }),
    );
    ensureNoError(
      await supabase.from("ai_messages").insert({
        company_id: company.id,
        conversation_id: conversation.id,
        role: "assistant",
        content,
        model,
        data_months: dataMonths,
        created_by: user.id,
      }),
    );

    revalidateAi(conversation.id);
    return { conversationId: conversation.id, answer: content, model, dataMonths };
  });
}

/** 会話の名前を変える（staff） */
export async function renameAiConversationAction(id: string, title: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase } = await requireStaffAction();
    const input = renameAiConversationSchema.parse({ id, title });
    ensureNoError(await supabase.from("ai_conversations").update({ title: input.title }).eq("id", input.id));
    revalidateAi(input.id);
    return null;
  }, "会話の名前を変更しました");
}

/** 会話を削除する（作成者本人か admin 以上。発言は DB のカスケードで消える） */
export async function deleteAiConversationAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, user, profile } = await requireStaffAction();
    const input = deleteAiConversationSchema.parse({ id });
    const { data: conversation, error: conversationError } = await supabase.from("ai_conversations").select("id, created_by").eq("id", input.id).maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) throw new ActionError("会話が見つかりません。");
    if (conversation.created_by !== user.id && !canEdit(profile.role)) {
      throw new ActionError("この会話を削除できるのは、作成した本人か管理者だけです。");
    }
    ensureNoError(await supabase.from("ai_conversations").delete().eq("id", input.id));
    revalidateAi(input.id);
    return null;
  }, "会話を削除しました");
}

/* ------------------------------------------------------------ 月次の分析 */

export interface GenerateAnalysisResult {
  model: string;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
}

/**
 * 月次の分析と改善策（admin+）。
 * 目標 × 着地見込み × 実績の三面分析を Claude に依頼し、ai_insights（kind='monthly'）へ保存する。
 */
export async function generateAnalysisAction(month: string): Promise<ActionResult<GenerateAnalysisResult>> {
  return runAction(async () => {
    const { supabase, user, company } = await requireAdminAction();
    const input = generateAnalysisSchema.parse({ month });
    assertAiEnabled();

    const context = await loadAiContext(supabase, company.id, input.month);
    if (context.current.entry_count === 0 && context.drivers.length === 0) {
      throw new ActionError("この月には稼働データがないため分析できません。");
    }

    const { model, summary, findings, actions } = await requestMonthlyAnalysis(context);

    ensureNoError(
      await supabase.from("ai_insights").insert({
        company_id: company.id,
        month: monthToDate(input.month),
        kind: "monthly",
        model,
        summary,
        findings,
        actions,
        created_by: user.id,
      }),
    );

    revalidatePath("/dashboard");
    revalidateAi();
    return { model, summary, findings, actions };
  }, "AI 月次分析を保存しました。");
}

/* ------------------------------------------------------------ 文章を作る */

export interface GenerateDraftResult {
  model: string;
  text: string;
}

/** 文章を作る（admin+）。生成した文章を返すだけで保存はしない */
export async function generateDraftAction(kind: DraftKind, params: DraftParamsInput, month: string): Promise<ActionResult<GenerateDraftResult>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const input = generateDraftSchema.parse({ kind, params: params ?? {}, month });
    assertAiEnabled();

    const context = await loadAiContext(supabase, company.id, input.month);
    const { model, text } = await requestDraft(input.kind, input.params, context);
    return { model, text };
  }, "文章を作成しました");
}
