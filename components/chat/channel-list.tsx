import { ChevronRight, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { MonthLink } from "@/components/layout/month-link";
import { ChannelDialog } from "./channel-dialog";
import { ChatUnreadBadge } from "./chat-unread-badge";
import { formatChatTime, summarizeBody, type ChatChannelItem } from "@/lib/chat/helpers";
import { cn } from "@/lib/utils";

/** 一覧に出す最終発言の長さ */
const SUMMARY_MAX = 40;

/**
 * ルームの一覧（最終発言・未読バッジ・発言数）
 * 1 タップでルームへ入れるよう、行全体をリンクにする。
 */
export function ChannelList({
  channels,
  canManage,
  now,
}: {
  channels: ChatChannelItem[];
  /** admin 以上ならルームを追加できる */
  canManage: boolean;
  /** 時刻表示の基準 */
  now: string;
}) {
  if (channels.length === 0) {
    return (
      <Empty title="ルームがありません" description={canManage ? "ルームを追加すると、社内のやりとりをここにまとめられます。" : "オーナー・管理者がルームを作ると、ここに表示されます。"}>
        {canManage && <ChannelDialog className="mt-2" />}
      </Empty>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card">
      {channels.map((c) => {
        const summary = summarizeBody(c.lastBody, SUMMARY_MAX);
        const unread = c.unreadCount > 0;
        return (
          <li key={c.id}>
            <MonthLink href={`/chat/${c.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-muted md:px-4">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <MessageSquare className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("truncate", unread ? "font-bold" : "font-medium")}>{c.name}</span>
                  {c.isDefault && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                      既定
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {summary !== "" ? (
                    <>
                      {c.lastAuthorName !== "" && <span className="font-medium text-foreground">{c.lastAuthorName}: </span>}
                      {summary}
                    </>
                  ) : c.description !== "" ? (
                    c.description
                  ) : (
                    "まだ発言がありません"
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  発言 {c.messageCount} 件{c.lastMessageAt ? ` ・ ${formatChatTime(c.lastMessageAt, now)}` : ""}
                </span>
              </span>
              <ChatUnreadBadge count={c.unreadCount} mentionCount={c.mentionCount} className="shrink-0" />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </MonthLink>
          </li>
        );
      })}
    </ul>
  );
}
