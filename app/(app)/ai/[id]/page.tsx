import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadAiMessages } from "@/lib/db/queries";
import { isAiInsightsEnabled } from "@/lib/ai/config";
import { dateToMonth, monthFromParam } from "@/lib/month";
import { buttonVariants } from "@/components/ui/button";
import { AiChatView } from "@/components/ai/ai-chat-view";
import type { ChatMessageView } from "@/components/ai/helpers";

export const metadata = { title: "AI への相談" };
/** AI の Server Action は応答に数十秒かかることがある */
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 1 つの相談（/ai/<id>） */
export default async function AiConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, user, profile } = await requireStaff();
  const { data: conversation, error } = await supabase.from("ai_conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!conversation) notFound();

  const messages = await loadAiMessages(supabase, conversation.id);
  const rows: ChatMessageView[] = messages.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    model: m.model,
    createdAt: m.created_at,
  }));
  const month = monthFromParam(sp.m);

  return (
    <div className="space-y-3">
      <Link href={`/ai?m=${month}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft /> AI 経営分析へ戻る
      </Link>
      <AiChatView
        conversationId={conversation.id}
        title={conversation.title}
        month={conversation.month ? dateToMonth(conversation.month) : null}
        messages={rows}
        aiEnabled={isAiInsightsEnabled()}
        canDelete={canEdit(profile.role) || conversation.created_by === user.id}
      />
    </div>
  );
}
