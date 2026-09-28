"use client";

import { useActionState } from "react";
import { receiveTermsAction } from "~/app/t/actions";

/**
 * ドライバーの「受け取りました」。押したときに出ていた版を一緒に送り、最新の版でなければ記録しない。
 * 受け取ったことの記録であって、内容に同意したかどうかとは別（画面にもそう書く）。
 */
export function ReceiveForm({
  token,
  version,
  received,
  disabled,
}: {
  token: string;
  version: number;
  received: { at: string; version: number } | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(receiveTermsAction, undefined);
  const done = state?.ok && state.data ? state.data : received;

  if (done) {
    return (
      <div className="rounded-card border-2 border-success bg-success/10 p-4 text-center" role="status">
        <p className="text-lg font-bold text-success">{done.at} に受け取りました</p>
        <p className="mt-1 text-sm">版 {done.version} の書面です。ありがとうございました。</p>
        <p className="mt-1 text-xs text-muted-foreground">分からないところがあれば、会社にお尋ねください。</p>
      </div>
    );
  }

  const stale = state && !state.ok && (state.error.includes("古くなって") || state.error.includes("新しい版"));
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="version" value={version} />
      <p className="text-base">
        上の書面を読んだら、押してください。「受け取りました」は、この書面を受け取ったことの記録です（内容に同意したかどうかとは別です）。
      </p>
      <button
        type="submit"
        disabled={pending || disabled}
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-4 text-lg font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "送っています…" : "受け取りました"}
      </button>
      {state && !state.ok && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <p>{state.error}</p>
          {stale && (
            <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-11 rounded-lg border border-danger/40 px-3 font-bold">
              読み直す
            </button>
          )}
        </div>
      )}
    </form>
  );
}
