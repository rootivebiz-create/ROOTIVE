"use client";

import { useActionState, useState } from "react";
import { askAction, type AskState } from "~/app/s/actions";

const MAX = 1000;

/** 質問を書いて送る（行ごと・明細全体）。送れたら閉じて、お礼の一言を出す */
function AskForm({
  token,
  lineKey,
  label,
  onClose,
  disabled,
}: {
  token: string;
  lineKey: string | null;
  label: string;
  onClose?: () => void;
  disabled: boolean;
}) {
  const [body, setBody] = useState("");
  const [state, action, pending] = useActionState(async (prev: AskState, fd: FormData) => {
    const r = await askAction(prev, fd);
    if (r.ok) setBody("");
    return r;
  }, undefined);

  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg border border-border bg-muted p-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lineKey" value={lineKey ?? ""} />
      <label className="block">
        <span className="block text-sm font-bold">{label}についての質問</span>
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX}
          rows={4}
          required
          placeholder="例：個数は 2,350 個だと思います。確認をお願いします。"
          className="mt-1 block w-full rounded-lg border border-border bg-card p-3 text-base text-foreground focus:border-foreground"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {body.length} / {MAX} 文字。会社の方が読んで、このページに返事を書きます。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || disabled || body.trim().length === 0}
          className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "送っています…" : "送る"}
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-bold">
            閉じる
          </button>
        )}
      </div>
      {state &&
        (state.ok ? (
          <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-2 text-sm text-success">
            {state.message}
          </p>
        ) : (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">
            {state.error}
          </p>
        ))}
    </form>
  );
}

/** 明細の行の下に出す「この行について質問する」 */
export function AskButton({
  token,
  lineKey,
  label,
  count,
  disabled,
  compact = false,
}: {
  token: string;
  lineKey: string;
  label: string;
  count: number;
  disabled: boolean;
  /** 日ごとの数量の 1 行など、狭い所に出すとき（短い言葉にする） */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={compact ? "" : "mt-1"}>
      <div className={`flex flex-wrap items-center gap-x-4 ${compact ? "justify-end" : ""}`}>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 text-sm text-link underline underline-offset-2"
            disabled={disabled}
            aria-label={compact ? `${label}について質問する` : undefined}
          >
            {compact ? "この日について質問する" : "この行について質問する"}
          </button>
        )}
        {count > 0 && (
          <a href={`#thread-${lineKey}`} className="inline-flex min-h-11 items-center text-sm">
            {compact ? `この日のやりとり ${count}件` : `この行のやりとり ${count}件`}
          </a>
        )}
      </div>
      {open && <AskForm token={token} lineKey={lineKey} label={label} onClose={() => setOpen(false)} disabled={disabled} />}
    </div>
  );
}

/** 明細全体についての質問 */
export function GeneralAskForm({ token, disabled }: { token: string; disabled: boolean }) {
  return <AskForm token={token} lineKey={null} label="明細全体" disabled={disabled} />;
}
