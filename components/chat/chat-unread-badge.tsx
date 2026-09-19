import { Badge } from "@/components/ui/badge";
import { mentionLabel, unreadLabel } from "@/lib/chat/helpers";
import { cn } from "@/lib/utils";

/**
 * 未読バッジ（件数を受け取って出すだけの部品）
 * ナビ・ルーム一覧のどちらからも使う。0 件のときは何も描画しない。
 */
export function ChatUnreadBadge({
  count,
  mentionCount = 0,
  className,
}: {
  /** 未読の件数（自分以外の発言のうち、最後に読んでからのもの） */
  count: number | null | undefined;
  /** そのうち自分宛（メンション）の件数 */
  mentionCount?: number | null;
  className?: string;
}) {
  const unread = unreadLabel(count);
  const mention = mentionLabel(mentionCount);
  if (unread === "" && mention === "") return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {mention !== "" && (
        <Badge variant="destructive" className="px-1.5 tabular-nums" aria-label={`自分宛の未読 ${mentionCount} 件`}>
          {mention}
        </Badge>
      )}
      {unread !== "" && (
        <Badge variant={mention === "" ? "default" : "secondary"} className="px-1.5 tabular-nums" aria-label={`未読 ${count} 件`}>
          {unread}
        </Badge>
      )}
    </span>
  );
}
