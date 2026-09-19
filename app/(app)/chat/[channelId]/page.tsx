import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { loadChatMessages, loadStaff } from "@/lib/db/queries";
import { uuidSchema } from "@/lib/schemas/common";
import { toChannelItem, toChatStaff, toMessageItems } from "@/lib/chat/helpers";
import { ChatView } from "@/components/chat/chat-view";

export const metadata = { title: "チャット" };

/** 一度に読み込む発言の件数（古い順に並べ替えて表示する） */
const MESSAGE_LIMIT = 100;

/**
 * ルームの中身（/chat/[channelId]）
 * 発言の一覧（直近 100 件）と入力欄。既読は画面側の effect で記録する。
 */
export default async function ChatChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  if (!uuidSchema.safeParse(channelId).success) notFound();
  const { supabase, profile, company } = await requireStaff();

  const channelRes = await supabase.from("v_chat_channel_list").select("*").eq("id", channelId).eq("company_id", company.id).maybeSingle();
  if (channelRes.error) throw channelRes.error;
  const channel = channelRes.data ? toChannelItem(channelRes.data) : null;
  if (!channel) notFound();

  const [messageRows, staffRows] = await Promise.all([loadChatMessages(supabase, channel.id, MESSAGE_LIMIT), loadStaff(supabase, { activeOnly: true })]);

  return (
    <ChatView
      channel={channel}
      messages={toMessageItems(messageRows)}
      staff={toChatStaff(staffRows)}
      role={profile.role}
      now={new Date().toISOString()}
    />
  );
}
