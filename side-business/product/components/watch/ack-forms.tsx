"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui";
import { ackWatchAction, unackWatchAction, type WatchFormState } from "~/app/(app)/watch/actions";

type Key = { month: string; code: string; subjectId: string };

function Result({ state }: { state: WatchFormState }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        {state.fieldErrors?.note ?? state.error}
      </p>
    );
  }
  return state.message ? (
    <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
      {state.message}
    </p>
  ) : null;
}

function Hidden({ k }: { k: Key }) {
  return (
    <>
      <input type="hidden" name="month" value={k.month} />
      <input type="hidden" name="code" value={k.code} />
      <input type="hidden" name="subjectId" value={k.subjectId} />
    </>
  );
}

/**
 * 「確認済みにする」：何を確かめたかのメモを書いて付ける。
 * ふだんは畳んでおき（スマホで場所を取らない）、開くとメモの欄が出る。前の月のメモがあれば下書きに入れる。
 */
export function AckForm({ k, minLength, red, draftNote }: { k: Key; minLength: number; red: boolean; draftNote?: string | null }) {
  const [state, action, pending] = useActionState(ackWatchAction, undefined);
  const noteId = useId();
  // フォームの送信後に React が欄を空に戻すので、書いたメモは手元で持つ（失敗しても消えない）
  const [note, setNote] = useState(draftNote ?? "");
  return (
    <details className="group rounded-lg border border-border" open={state !== undefined && !state.ok ? true : undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold hover:bg-muted [&::-webkit-details-marker]:hidden">
        確認済みにする
        <span aria-hidden className="text-muted-foreground group-open:rotate-180">
          ▾
        </span>
      </summary>
      <form action={action} className="space-y-3 border-t border-border p-3">
        <Hidden k={k} />
        <label htmlFor={noteId} className="block text-sm font-bold">
          何を確かめたか（{minLength} 文字以上）
        </label>
        <textarea
          id={noteId}
          name="note"
          required
          minLength={minLength}
          maxLength={500}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="例：業務委託契約書（2026年4月1日）の第8条と、本人の署名を確認した"
          className="block min-h-24 w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground focus:border-foreground"
        />
        <p className="text-xs text-muted-foreground">
          {red
            ? "赤い指摘は、確認済みにすると締めを止めなくなります。何を見て、どう判断したかを具体的に書いてください。"
            : "確認済みにすると、この月の一覧で「確認済み」になります。"}
          メモと、誰がいつ付けたかは記録に残ります。
        </p>
        {draftNote && <p className="text-xs text-muted-foreground">前の月のメモを下書きに入れています。今月も同じか確かめてから保存してください。</p>}
        <Result state={state} />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          いま {note.trim().length} 文字
        </p>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending || note.trim().length < minLength}>
          {pending ? "保存しています…" : "確認済みにする"}
        </Button>
      </form>
    </details>
  );
}

/** 「確認済みを外す」：外すとまた指摘として数える（赤なら締めを止める） */
export function UnackForm({ k, red }: { k: Key; red: boolean }) {
  const [state, action, pending] = useActionState(unackWatchAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <Hidden k={k} />
      <Button type="submit" variant="secondary" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "外しています…" : "確認済みを外す"}
      </Button>
      {red && <p className="text-xs text-muted-foreground">外すと、赤い指摘として締めを止めるようになります。</p>}
      <Result state={state} />
    </form>
  );
}
