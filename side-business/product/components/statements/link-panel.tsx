"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui";
import { Notice } from "~/components/page";
import { markSentAction, recreateLinkAction } from "~/app/(app)/statements/actions";
import type { SendChannel } from "~/server/features/statements";

type Note = { tone: "ok" | "error" | "info"; text: string } | null;

/**
 * ドライバーへ送る：リンクのコピー・LINE・SMS・メール（押すと「送った」記録がつく）と、リンクの作り直し。
 * リンクの値は会社の画面でだけ作る（見るだけの人には出さない）。
 */
export function LinkPanel({
  statementId,
  url,
  message,
  links,
  expiresText,
  hasPhone,
  hasEmail,
}: {
  statementId: string;
  url: string;
  message: string;
  links: { line: string; sms: string; mail: string };
  expiresText: string;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function record(channel: SendChannel, doneText: string) {
    startTransition(async () => {
      const r = await markSentAction(statementId, channel);
      setNote(r.ok ? { tone: "ok", text: doneText } : { tone: "error", text: r.error });
    });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      record("copy", `${what}をコピーしました。LINE やメールに貼り付けて送ってください（送った記録をつけました）`);
    } catch {
      inputRef.current?.select();
      setNote({ tone: "info", text: "自動でコピーできませんでした。上のリンクを長押し（または右クリック）してコピーしてください" });
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-sm font-bold">ドライバー用のリンク</span>
        <input
          ref={inputRef}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-muted px-3 font-mono text-xs text-foreground"
          aria-describedby="link-expiry"
        />
        <span id="link-expiry" className="mt-1 block text-xs text-muted-foreground">
          {expiresText} まで使えます。ログインもアプリも要りません。
        </span>
      </label>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button onClick={() => copy(url, "リンク")} disabled={pending}>
          リンクをコピー
        </Button>
        <Button variant="secondary" onClick={() => copy(message, "文面とリンク")} disabled={pending}>
          文面ごとコピー
        </Button>
        <a
          href={links.line}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("secondary")}
          onClick={() => record("line", "LINE を開きました。送る相手を選んで送ってください（送った記録をつけました）")}
        >
          LINE で送る
        </a>
        <a
          href={links.sms}
          className={buttonClass("secondary")}
          onClick={() => record("sms", hasPhone ? "SMS を開きました。そのまま送ってください（送った記録をつけました）" : "SMS を開きました。宛先の電話番号を入れて送ってください（送った記録をつけました）")}
        >
          SMS で送る
        </a>
        <a
          href={links.mail}
          className={buttonClass("secondary")}
          onClick={() => record("mail", hasEmail ? "メールを開きました。そのまま送ってください（送った記録をつけました）" : "メールを開きました。宛先を入れて送ってください（送った記録をつけました）")}
        >
          メールで送る
        </a>
        <Button variant="ghost" onClick={() => record("paper", "紙で渡した記録をつけました")} disabled={pending}>
          紙で渡した（送った記録だけつける）
        </Button>
      </div>
      {(!hasPhone || !hasEmail) && (
        <p className="text-xs text-muted-foreground">
          {!hasPhone && !hasEmail ? "電話番号とメールが台帳にありません" : !hasPhone ? "電話番号が台帳にありません" : "メールが台帳にありません"}
          。SMS・メールは、開いた画面で宛先を入れてください。
        </p>
      )}

      <details className="rounded-lg border border-border p-3 text-sm">
        <summary className="cursor-pointer font-bold">送る文面を見る</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{message}</p>
      </details>

      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      <RecreateLink statementId={statementId} />
    </div>
  );
}

function RecreateLink({ statementId }: { statementId: string }) {
  const [state, action, pending] = useActionState(recreateLinkAction, undefined);
  // 確かめの箱は、開いたときの結果のままのあいだだけ出す（作り直し終わったら閉じる）
  const [opened, setOpened] = useState<{ at: typeof state } | null>(null);
  const open = opened !== null && opened.at === state;
  const setOpen = (v: boolean) => setOpened(v ? { at: state } : null);
  return (
    <div className="border-t border-border pt-3">
      {!open ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          リンクを作り直す
        </Button>
      ) : (
        <form action={action} className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <input type="hidden" name="id" value={statementId} />
          <p className="font-bold text-warning">今までのリンクは使えなくなります</p>
          <p className="mt-1">
            間違った相手に送ったとき・リンクが人に知られたときに使います。送った・開いた記録は外れます（確認の記録は残ります）。作り直したら、新しいリンクを送り直してください。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "作り直しています…" : "作り直す"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </form>
      )}
      {state && <div className="mt-2">{state.ok ? <Notice tone="ok">{state.message}</Notice> : <Notice tone="error">{state.error}</Notice>}</div>}
    </div>
  );
}
