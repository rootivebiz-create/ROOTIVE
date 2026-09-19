import { MessageSquare } from "lucide-react";
import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadChatChannels } from "@/lib/db/queries";
import { pickDefaultChannel, toChannelItems, unreadLabel } from "@/lib/chat/helpers";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { ChannelDialog } from "@/components/chat/channel-dialog";
import { ChannelList } from "@/components/chat/channel-list";
import { cn } from "@/lib/utils";

export const metadata = { title: "チャット" };

/**
 * 社内チャットのルーム一覧（/chat）
 * 閲覧者を含むスタッフ全員が読めて発言できる。ルームの追加は admin 以上。
 */
export default async function ChatPage() {
  const { supabase, profile, company } = await requireStaff();
  const channels = toChannelItems(await loadChatChannels(supabase, company.id));
  const manage = canEdit(profile.role);
  const now = new Date().toISOString();
  const defaultChannel = pickDefaultChannel(channels);
  const unreadTotal = channels.reduce((sum, c) => sum + c.unreadCount, 0);
  const totalLabel = unreadLabel(unreadTotal);

  return (
    <>
      <PageHeader
        title="チャット"
        description={totalLabel === "" ? "社内の連絡をルームごとにまとめます。閲覧者も発言できます。" : `未読が ${totalLabel} 件あります。`}
        actions={
          <>
            {defaultChannel && (
              <MonthLink href={`/chat/${defaultChannel.id}`} className={cn(buttonVariants({ variant: "outline" }))}>
                <MessageSquare />
                「{defaultChannel.name}」を開く
              </MonthLink>
            )}
            {manage && <ChannelDialog />}
          </>
        }
      />
      <ChannelList channels={channels} canManage={manage} now={now} />
    </>
  );
}
