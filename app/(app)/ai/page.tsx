import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadAiConversations } from "@/lib/db/queries";
import { isAiInsightsEnabled } from "@/lib/ai/config";
import { normalizeActions, normalizeInsightFindings } from "@/lib/ai/findings";
import { dateToMonth, formatMonthJa, monthFromParam, monthToDate } from "@/lib/month";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { AiWorkspace } from "@/components/ai/ai-workspace";
import type { AnalysisView, ConversationSummary } from "@/components/ai/helpers";

export const metadata = { title: "AI 経営分析" };
/** AI の Server Action は応答に数十秒かかることがある */
export const maxDuration = 60;

/** 最初に開くタブ（?tab=analysis / draft） */
function tabFromParam(param: string | string[] | undefined): "chat" | "analysis" | "draft" {
  const v = Array.isArray(param) ? param[0] : param;
  return v === "analysis" || v === "draft" ? v : "chat";
}

/**
 * AI の経営分析とチャット（/ai）
 * 稼動月は ?m=YYYY-MM。この月のデータパック（v_* ビューと RPC の結果）を Claude に渡す。
 */
export default async function AiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user, profile, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const aiEnabled = isAiInsightsEnabled();
  const canRun = canEdit(profile.role);

  const [conversations, insightRes] = await Promise.all([
    loadAiConversations(supabase, company.id),
    supabase
      .from("ai_insights")
      .select("*")
      .eq("company_id", company.id)
      .eq("month", monthToDate(month))
      .eq("kind", "monthly")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (insightRes.error) throw insightRes.error;

  const insight = insightRes.data;
  const analysis: AnalysisView | null = insight
    ? {
        model: insight.model,
        createdAt: insight.created_at,
        summary: insight.summary ?? "",
        findings: normalizeInsightFindings(insight.findings),
        actions: normalizeActions(insight.actions),
      }
    : null;

  const rows: ConversationSummary[] = conversations.map((c) => ({
    id: c.id ?? "",
    title: c.title ?? "相談",
    month: c.month ? dateToMonth(c.month) : null,
    messageCount: Number(c.message_count ?? 0),
    lastMessageAt: c.last_message_at ?? c.created_at ?? "",
    lastRole: c.last_role === "user" || c.last_role === "assistant" ? c.last_role : "",
    lastContent: c.last_content ?? "",
    canDelete: canRun || c.created_by === user.id,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title="AI 経営分析" description={`${formatMonthJa(month)} の数字をもとに、相談・月次の分析・文章の作成ができます`} />
      {!aiEnabled && (
        <Alert variant="warning">
          AI 機能を使うには ANTHROPIC_API_KEY の設定が必要です。設定 → 外部連携 の手順で登録すると、相談・分析・文章の作成が使えるようになります。
        </Alert>
      )}
      <AiWorkspace
        month={month}
        monthLabel={formatMonthJa(month)}
        aiEnabled={aiEnabled}
        canRun={canRun}
        conversations={rows}
        analysis={analysis}
        defaultTab={tabFromParam(sp.tab)}
      />
    </div>
  );
}
