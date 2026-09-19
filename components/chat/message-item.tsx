"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatChatTime, renderMentionParts, type ChatMessageItem, type ChatStaff } from "@/lib/chat/helpers";
import { chatBodySchema } from "@/lib/schemas/chat";
import { deleteChatMessageAction, editChatMessageAction } from "@/lib/actions/chat";
import { cn } from "@/lib/utils";

/** 本文（@名前 を強調する。改行はそのまま） */
function MessageBody({ body, staff, mine }: { body: string; staff: ChatStaff[]; mine: boolean }) {
  const parts = renderMentionParts(body, staff);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <span
            key={i}
            className={cn("rounded px-0.5 font-semibold", mine ? "bg-primary-foreground/20 text-primary-foreground" : "bg-accent text-accent-foreground")}
          >
            {p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}

/**
 * 発言の 1 件
 * - 自分の発言は右寄せ・色を変える（is_mine）
 * - 自分宛の発言は左に縦線を出して目立たせる（is_mentioned）
 * - 自分の発言は編集・削除できる（owner は他人の発言も削除できる）
 */
export function MessageItem({
  message,
  staff,
  canDelete,
  now,
}: {
  message: ChatMessageItem;
  staff: ChatStaff[];
  /** 削除ボタンを出すか（本人 or owner） */
  canDelete: boolean;
  /** 時刻表示の基準（サーバーと画面で同じ値を使い、表示のズレを防ぐ） */
  now: string;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mine = message.isMine;

  return (
    <li className={cn("flex flex-col gap-1", message.isMentioned && "border-l-4 border-warning bg-warning/5 py-1 pl-2", mine ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-full items-center gap-1.5 text-xs text-muted-foreground", mine && "flex-row-reverse")}>
        <span className="truncate font-medium text-foreground">{mine ? "自分" : message.authorName}</span>
        {!mine && message.roleLabel !== "" && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
            {message.roleLabel}
          </Badge>
        )}
        <time dateTime={message.createdAt} className="tabular-nums">
          {formatChatTime(message.createdAt, now)}
        </time>
        {message.editedAt && <span>編集済み</span>}
      </div>

      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 shadow-sm md:max-w-[75%]",
          mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-card border",
        )}
      >
        <MessageBody body={message.body} staff={staff} mine={mine} />
      </div>

      {(mine || canDelete) && (
        <div className={cn("flex items-center gap-1", mine && "flex-row-reverse")}>
          {mine && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              編集
            </Button>
          )}
          {canDelete && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              削除
            </Button>
          )}
        </div>
      )}

      <EditDialog open={editing} onOpenChange={setEditing} message={message} />
      <DeleteDialog open={deleting} onOpenChange={setDeleting} message={message} />
    </li>
  );
}

function EditDialog({ open, onOpenChange, message }: { open: boolean; onOpenChange: (v: boolean) => void; message: ChatMessageItem }) {
  const router = useRouter();
  const [body, setBody] = useState(message.body);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "メッセージを入力してください");
      return;
    }
    startTransition(async () => {
      const res = await editChatMessageAction(message.id, parsed.data);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "編集しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setBody(message.body);
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>発言を編集</DialogTitle>
          <DialogDescription>編集すると「編集済み」と表示されます。</DialogDescription>
        </DialogHeader>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} disabled={pending} aria-label="メッセージ" autoFocus />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" onClick={submit} disabled={pending || body.trim() === ""}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ open, onOpenChange, message }: { open: boolean; onOpenChange: (v: boolean) => void; message: ChatMessageItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await deleteChatMessageAction(message.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-sm">
        <DialogHeader>
          <DialogTitle>発言を削除しますか？</DialogTitle>
          <DialogDescription>削除すると元に戻せません。</DialogDescription>
        </DialogHeader>
        <p className="line-clamp-4 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{message.body}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "削除中…" : "削除する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
