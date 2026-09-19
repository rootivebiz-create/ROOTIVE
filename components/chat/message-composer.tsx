"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MentionPicker } from "./mention-picker";
import { insertMention, parseMentions, type ChatStaff } from "@/lib/chat/helpers";
import { chatBodySchema } from "@/lib/schemas/chat";
import { postChatMessageAction } from "@/lib/actions/chat";

const MAX_BODY = 4000;

/**
 * 発言の入力欄（閲覧者も発言できる）
 *
 * スマホでは画面の下に貼り付く（sticky）。下タブと重ならないよう、タブの高さ＋セーフエリアの分だけ浮かせる。
 * 送信は「送信」ボタンか Ctrl/⌘ + Enter（スマホの Enter は改行）。
 */
export function MessageComposer({
  channelId,
  staff,
  onPosted,
}: {
  channelId: string;
  /** メンション候補（v_staff） */
  staff: ChatStaff[];
  /** 送信できたとき（一番下までスクロールする） */
  onPosted?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const change = (value: string) => {
    setBody(value);
    resize(ref.current);
  };

  const addMention = (name: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? body.length;
    const next = insertMention(body, name, caret);
    setBody(next.text);
    // 差し込んだ直後にキャレットを戻す（入力欄へフォーカスも戻す）
    requestAnimationFrame(() => {
      const target = ref.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(next.caret, next.caret);
      resize(target);
    });
  };

  const submit = () => {
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "メッセージを入力してください");
      return;
    }
    const text = parsed.data;
    const mentions = parseMentions(text, staff);
    startTransition(async () => {
      const res = await postChatMessageAction(channelId, text, mentions);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody("");
      resize(ref.current);
      router.refresh();
      onPosted?.();
    });
  };

  const remaining = MAX_BODY - [...body].length;

  return (
    <div className="sticky bottom-[calc(3.5rem_+_max(env(safe-area-inset-bottom),0.5rem))] z-30 -mx-4 border-t bg-card px-4 pb-2 pt-2 md:bottom-0 md:mx-0 md:rounded-lg md:border">
      <div className="flex items-end gap-2">
        <MentionPicker staff={staff} onSelect={addMention} disabled={pending} />
        <Textarea
          ref={ref}
          value={body}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={MAX_BODY}
          placeholder="メッセージを入力（Ctrl + Enter で送信）"
          aria-label="メッセージ"
          disabled={pending}
          className="max-h-40 min-h-[2.75rem] flex-1 resize-none py-2.5"
        />
        <Button type="button" size="icon" className="h-10 w-10 shrink-0" onClick={submit} disabled={pending || body.trim() === ""} aria-label="送信">
          <SendHorizontal />
        </Button>
      </div>
      {remaining <= 200 && <p className="mt-1 text-right text-xs text-muted-foreground">残り {remaining} 文字</p>}
    </div>
  );
}
