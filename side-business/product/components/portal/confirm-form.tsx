"use client";

import { useActionState } from "react";
import { confirmAction } from "~/app/s/actions";

/**
 * 「内容を確認しました」。押したときに出ていた版を一緒に送り、今の版と違えば記録しない（読み直してもらう）。
 */
export function ConfirmForm({
  token,
  version,
  confirmed,
  disabled,
}: {
  token: string;
  version: number;
  confirmed: { at: string; version: number } | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(confirmAction, undefined);
  const done = state?.ok && state.data ? state.data : confirmed;

  if (done) {
    return (
      <div className="rounded-card border-2 border-success bg-success/10 p-4 text-center" role="status">
        <p className="text-lg font-bold text-success">{done.at} に確認しました</p>
        <p className="mt-1 text-sm">版 {done.version} の内容です。ありがとうございました。</p>
        <p className="mt-1 text-xs text-muted-foreground">あとで気になるところが出てきたら、下の「質問」からいつでも送れます。</p>
      </div>
    );
  }

  const stale = state && !state.ok && state.error.includes("新しくなっています");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="version" value={version} />
      <p className="text-sm">
        振込額と中身を見て、合っていれば押してください。違うところがあれば押さずに、その行の「この行について質問する」からお知らせください。
      </p>
      <button
        type="submit"
        disabled={pending || disabled}
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-4 text-lg font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "送っています…" : "内容を確認しました"}
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
