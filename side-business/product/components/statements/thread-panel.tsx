"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui";
import { Badge, Notice } from "~/components/page";
import { markSentAction, replyAction, resolveAction, type ReplyState } from "~/app/(app)/statements/actions";
import type { ReplyShare, SendChannel } from "~/server/features/statements";
import { threadAnchor, type Thread } from "~/server/features/statements/threads";

const MAX = 1000;

/** 明細についてのやりとり（会社の側）。行ごとにまとめ、返事と「解決」ができる */
export function ThreadPanel({ statementId, threads, canEdit }: { statementId: string; threads: Thread[]; canEdit: boolean }) {
  const hasGeneral = threads.some((t) => t.lineKey === null);
  return (
    <div className="space-y-4">
      {threads.length === 0 && (
        <p className="text-sm text-muted-foreground">
          まだやりとりはありません。ドライバーが明細の行から質問すると、ここに届きます（行ごとにまとまります）。
        </p>
      )}
      {threads.map((t) => (
        <ThreadBox key={t.lineKey ?? "_all"} statementId={statementId} thread={t} canEdit={canEdit} />
      ))}
      {canEdit && !hasGeneral && (
        <div className="rounded-card border border-dashed border-border p-3">
          <p className="text-sm font-bold">ドライバーへ連絡する（明細全体について）</p>
          <p className="text-xs text-muted-foreground">明細を直したときのお知らせなどに。ドライバーは同じリンクで読めます（自動では届かないので、書いたら LINE などで知らせてください）。</p>
          <ReplyForm statementId={statementId} lineKey={null} placeholder="例：駐車場代の立替を足して作り直しました。もう一度ご確認ください。" />
        </div>
      )}
    </div>
  );
}

function ThreadBox({ statementId, thread: t, canEdit }: { statementId: string; thread: Thread; canEdit: boolean }) {
  const hasDriver = t.messages.some((m) => m.author === "driver");
  return (
    <section id={threadAnchor(t.lineKey)} className="rounded-card border border-border bg-card p-3" aria-label={`${t.label}についてのやりとり`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{t.label}について</h3>
        {hasDriver && (t.open > 0 ? <Badge tone="red">未解決 {t.open}</Badge> : <Badge tone="green">解決済み</Badge>)}
      </div>
      <ol className="mt-2 space-y-2">
        {t.messages.map((m) => (
          <li key={m.id} className={m.author === "driver" ? "mr-6 rounded-lg bg-muted p-2" : "ml-6 rounded-lg border border-border p-2"}>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{m.author === "driver" ? "ドライバー" : `会社${m.authorName ? `（${m.authorName}）` : ""}`}</span>
              <span>{m.at}</span>
              {m.author === "driver" && !m.read && <Badge tone="yellow">新着</Badge>}
              {m.author === "staff" && <span>{m.read ? "ドライバーが読みました" : "まだ読まれていません"}</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.body}</p>
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-3 space-y-2">
          <ReplyForm statementId={statementId} lineKey={t.lineKey} placeholder="返事を書く（ドライバーは同じリンクで読めます。書いたら LINE などで知らせてください）" />
          {hasDriver && <ResolveForm statementId={statementId} lineKey={t.lineKey} resolved={t.open === 0} />}
        </div>
      )}
    </section>
  );
}

/** 返事を書いて送る（明細の画面と、質問の一覧で使う） */
export function ReplyForm({ statementId, lineKey, placeholder }: { statementId: string; lineKey: string | null; placeholder: string }) {
  const [body, setBody] = useState("");
  const [state, action, pending] = useActionState(async (prev: ReplyState, fd: FormData) => {
    const r = await replyAction(prev, fd);
    if (r.ok) setBody("");
    return r;
  }, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={statementId} />
      <input type="hidden" name="lineKey" value={lineKey ?? ""} />
      <label className="block">
        <span className="sr-only">返事</span>
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX}
          rows={3}
          required
          placeholder={placeholder}
          className="block w-full rounded-lg border border-border bg-card p-3 text-base text-foreground focus:border-foreground"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {body.length} / {MAX} 文字
        </span>
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          {pending ? "送っています…" : "返事を送る"}
        </Button>
      </div>
      {state && (state.ok ? <Notice tone="ok">{state.message}</Notice> : <Notice tone="error">{state.error}</Notice>)}
      {state?.ok && state.data && <ReplyShareButtons statementId={statementId} share={state.data} />}
    </form>
  );
}

/**
 * 返事を書いたあとに、ドライバーへ知らせるボタン（返事は自動では届かない）。
 * 押すと、明細の「送った」記録もつける（前に送った日時は変わらない。送ったあとで中身が変わっていたときだけ今にする）
 */
export function ReplyShareButtons({ statementId, share }: { statementId: string; share: ReplyShare }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  function record(channel: SendChannel, doneText: string) {
    startTransition(async () => {
      const r = await markSentAction(statementId, channel);
      setNote(r.ok ? { tone: "ok", text: doneText } : { tone: "error", text: r.error });
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(share.message);
      record("copy", "知らせる文面をコピーしました。その人とのトークに貼って送ってください");
    } catch {
      setNote({ tone: "info", text: "自動でコピーできませんでした。下の文面を長押し（または右クリック）してコピーしてください" });
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" aria-label="返事を書いたことを知らせる">
      <p className="text-sm font-bold">ドライバーに返事を知らせる</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <a
          href={share.links.line}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("secondary")}
          onClick={() => record("line", "LINE を開きました。送る相手を選んで送ってください")}
        >
          LINE で返事を知らせる
        </a>
        <a
          href={share.links.sms}
          className={buttonClass("secondary")}
          onClick={() => record("sms", share.hasPhone ? "SMS を開きました。そのまま送ってください" : "SMS を開きました。宛先の電話番号を入れて送ってください")}
        >
          SMS で知らせる
        </a>
        <Button type="button" variant="secondary" onClick={copy} disabled={pending}>
          文面をコピー
        </Button>
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center">知らせる文面を見る</summary>
        <p className="whitespace-pre-wrap break-words pb-2 text-muted-foreground">{share.message}</p>
      </details>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
    </div>
  );
}

/** 解決にする／未解決に戻す（明細の画面と、質問の一覧で使う） */
export function ResolveForm({ statementId, lineKey, resolved }: { statementId: string; lineKey: string | null; resolved: boolean }) {
  const [state, action, pending] = useActionState(resolveAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={statementId} />
      <input type="hidden" name="lineKey" value={lineKey ?? ""} />
      <input type="hidden" name="resolved" value={resolved ? "0" : "1"} />
      <Button type="submit" variant={resolved ? "ghost" : "secondary"} disabled={pending}>
        {resolved ? "未解決に戻す" : "解決にする"}
      </Button>
      {state && !state.ok && <span className="text-sm text-danger">{state.error}</span>}
    </form>
  );
}
