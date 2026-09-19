"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { deleteAiConversationAction } from "@/lib/actions/ai";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { useMonth } from "@/lib/hooks/use-month";
import { preview, type ConversationSummary } from "./helpers";

export interface ConversationListProps {
  conversations: ConversationSummary[];
}

/** これまでの相談の一覧 */
export function ConversationList({ conversations }: ConversationListProps) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();

  const remove = (id: string, title: string) => {
    if (!window.confirm(`「${title}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteAiConversationAction(id);
      if (res.ok) {
        toast.success(res.message ?? "会話を削除しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">これまでの相談</CardTitle>
      </CardHeader>
      <CardContent>
        {conversations.length === 0 ? (
          <Empty title="まだ相談はありません" description="上の入力欄から質問すると、ここに残ります。" />
        ) : (
          <ul className="divide-y">
            {conversations.map((c) => (
              <li key={c.id} className="flex items-start gap-2 py-2.5 first:pt-0 last:pb-0">
                <Link href={href(`/ai/${c.id}`)} className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="flex items-center gap-1.5 font-medium">
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{c.title}</span>
                  </p>
                  {c.lastContent && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{preview(c.lastContent, 80)}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.month ? `${formatMonthJa(c.month)}のデータ・` : ""}
                    {c.messageCount} 件・{formatDateTimeJa(c.lastMessageAt)}
                  </p>
                </Link>
                {c.canDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    aria-label={`${c.title} を削除`}
                    disabled={pending}
                    onClick={() => remove(c.id, c.title)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
