"use client";

import { Fragment, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Empty } from "@/components/ui/empty";
import { MonthLink } from "@/components/layout/month-link";
import { MessageComposer } from "./message-composer";
import { MessageItem } from "./message-item";
import { ChannelDialog } from "./channel-dialog";
import { chatDateLabel, isSameChatDay, type ChatChannelItem, type ChatMessageItem, type ChatStaff } from "@/lib/chat/helpers";
import { markChatReadAction } from "@/lib/actions/chat";
import type { Role } from "@/lib/db/types";

/** 新しい発言を取りに行く間隔（画面を見ているときだけ） */
const REFRESH_MS = 15_000;

/**
 * ルームの中身（発言の一覧 ＋ 入力欄）
 *
 * - 開いたとき・新しい発言が届いたときに既読にする
 * - 画面が表示されている間だけ 15 秒ごとに router.refresh() で取り直す
 * - 閲覧者も発言できる（権限は Server Action と RLS が判定する）
 */
export function ChatView({
  channel,
  messages,
  staff,
  role,
  now,
}: {
  channel: ChatChannelItem;
  /** 古い順（直近 100 件） */
  messages: ChatMessageItem[];
  staff: ChatStaff[];
  role: Role;
  /** 時刻表示の基準（サーバーが渡す） */
  now: string;
}) {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const readRef = useRef("");
  const scrolledRef = useRef("");
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : "";
  const canManage = role === "owner" || role === "admin" || role === "clerk";

  // 開いたとき・新しい発言が増えたときに既読にする（同じ状態では 1 回だけ）
  useEffect(() => {
    const key = `${channel.id}:${lastId}`;
    if (readRef.current === key) return;
    readRef.current = key;
    void markChatReadAction(channel.id);
  }, [channel.id, lastId]);

  // 一番下へスクロール（初回と新しい発言が来たとき）
  useEffect(() => {
    if (scrolledRef.current === lastId) return;
    const first = scrolledRef.current === "";
    scrolledRef.current = lastId;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: first ? "auto" : "smooth" });
  }, [lastId]);

  // 新しい発言を取りに行く（画面を見ているときだけ）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <MonthLink href="/chat" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            ルーム一覧
          </MonthLink>
          <h1 className="mt-1 truncate text-xl font-bold tracking-tight md:text-2xl">{channel.name}</h1>
          {channel.description !== "" && <p className="mt-0.5 text-sm text-muted-foreground">{channel.description}</p>}
        </div>
        {canManage && <ChannelDialog channel={channel} size="sm" />}
      </div>

      {messages.length === 0 ? (
        <Empty title="まだ発言がありません" description="最初のメッセージを送ってみましょう。" className="my-6" />
      ) : (
        <ul className="flex flex-1 flex-col gap-3 py-2">
          {messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const newDay = !prev || !isSameChatDay(prev.createdAt, m.createdAt);
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <li className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    <span>{chatDateLabel(m.createdAt, now)}</span>
                    <span className="h-px flex-1 bg-border" />
                  </li>
                )}
                <MessageItem message={m} staff={staff} canDelete={m.isMine || role === "owner"} now={now} />
              </Fragment>
            );
          })}
        </ul>
      )}
      <div ref={bottomRef} aria-hidden />

      <MessageComposer channelId={channel.id} staff={staff} onPosted={() => bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })} />
    </div>
  );
}
