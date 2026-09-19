"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Check, Loader2, Pencil, Send, Trash2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { deleteAiConversationAction, renameAiConversationAction, sendAiChatAction } from "@/lib/actions/ai";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";
import type { ChatMessageView } from "./helpers";

export interface AiChatViewProps {
  conversationId: string;
  title: string;
  /** この会話が参照している稼動月 "YYYY-MM"（未設定なら null） */
  month: string | null;
  messages: ChatMessageView[];
  /** ANTHROPIC_API_KEY が設定されている */
  aiEnabled: boolean;
  /** 削除できる（作成者本人か管理者） */
  canDelete: boolean;
}

function Bubble({ message }: { message: ChatMessageView }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground" aria-hidden>
          <Bot className="h-4 w-4" />
        </span>
      )}
      <div className={cn("min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-sm", isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <p className={cn("mt-1 text-[11px]", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>{formatDateTimeJa(message.createdAt)}</p>
      </div>
      {isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
          <User className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

/** 1 つの会話（吹き出し ＋ 追加の質問） */
export function AiChatView({ conversationId, title, month, messages, aiEnabled, canDelete }: AiChatViewProps) {
  const router = useRouter();
  const { href } = useMonth();
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    setAsking(q);
    startTransition(async () => {
      const res = await sendAiChatAction(conversationId, q);
      if (!res.ok) {
        toast.error(res.error);
        setDraft(q);
        setAsking(null);
        return;
      }
      router.refresh();
      setAsking(null);
    });
  };

  const rename = () => {
    const next = name.trim();
    if (!next) {
      toast.error("タイトルを入力してください。");
      return;
    }
    startTransition(async () => {
      const res = await renameAiConversationAction(conversationId, next);
      if (res.ok) {
        setEditing(false);
        toast.success(res.message ?? "会話の名前を変更しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!window.confirm("この相談を削除します。よろしいですか？")) return;
    startTransition(async () => {
      const res = await deleteAiConversationAction(conversationId);
      if (res.ok) {
        toast.success(res.message ?? "会話を削除しました");
        router.push(href("/ai"));
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="会話のタイトル" maxLength={200} className="h-9" />
              <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="タイトルを保存" disabled={pending} onClick={rename}>
                <Check />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                aria-label="タイトルの変更をやめる"
                disabled={pending}
                onClick={() => {
                  setName(title);
                  setEditing(false);
                }}
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <h1 className="min-w-0 truncate text-lg font-bold tracking-tight md:text-xl">{title}</h1>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label="タイトルを変更" onClick={() => setEditing(true)}>
                <Pencil />
              </Button>
            </div>
          )}
          {month && (
            <Badge variant="secondary" className="mt-1">
              {formatMonthJa(month)}のデータ
            </Badge>
          )}
        </div>
        {canDelete && (
          <Button size="sm" variant="outline" onClick={remove} disabled={pending}>
            <Trash2 /> 削除
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          {asking && (
            <>
              <Bubble message={{ id: "pending-user", role: "user", content: asking, model: "", createdAt: new Date().toISOString() }} />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground" aria-hidden>
                  <Bot className="h-4 w-4" />
                </span>
                <span className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> 考えています…
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="続けて質問する（例：その案件の単価を 500 円上げたら利益はどうなる？）"
            rows={3}
            disabled={!aiEnabled || pending}
            aria-label="追加の質問"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{aiEnabled ? "回答まで数十秒かかることがあります。" : "AI 機能を使うには ANTHROPIC_API_KEY の設定が必要です"}</p>
            <Button onClick={submit} disabled={!aiEnabled || pending || !draft.trim()} aria-busy={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" /> 考えています…
                </>
              ) : (
                <>
                  <Send /> 送信
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
