"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { goLiveAction, undoGoLiveAction, type GoLiveState } from "~/app/(app)/parallel/actions";

function Result({ state }: { state: GoLiveState }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="text-sm text-success">
      {state.message}
    </p>
  ) : (
    <p role="alert" className="text-sm text-danger">
      {state.error}
    </p>
  );
}

/**
 * 「Excel をやめて、しめ日ラボで締める」（オーナーだけ）。
 * 比べた人が全員「一致」か「理由のメモあり」のときだけ押せる（サーバーでも同じ確かめをする）。
 */
export function GoLiveButton({ month, monthLabel, ready, streak }: { month: string; monthLabel: string; ready: boolean; streak: number }) {
  const [state, action, pending] = useActionState<GoLiveState, FormData>(goLiveAction, undefined);
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div className="space-y-2">
        <Button onClick={() => setAsking(true)} disabled={!ready} className="w-full sm:w-auto">
          Excel をやめて、しめ日ラボで締める…
        </Button>
        {!ready && <p className="text-xs text-muted-foreground">比べた人が全員「一致」か、差の理由のメモがある状態になると押せます。</p>}
        <Result state={state} />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-lg border-2 border-foreground p-3 text-sm">
      <input type="hidden" name="month" value={month} />
      <p className="font-bold">{monthLabel}分から、しめ日ラボで締めると記録します。よろしいですか？</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          続けて一致（または説明済み）の月は {streak} か月です。{streak < 2 ? "目安の 2〜3 か月に届いていません。もう 1 か月並べて締めると安心です。" : "目安の 2〜3 か月に届いています。"}
        </li>
        <li>記録は操作の記録に残ります。あとから取り消せます（Excel と比べる画面は、いつでも使えます）。</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "記録しています…" : "記録する"}
        </Button>
        <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
          やめる
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

/** 切り替えの記録を取り消す（オーナーだけ） */
export function UndoGoLiveButton() {
  const [state, action, pending] = useActionState<GoLiveState, FormData>(undoGoLiveAction, undefined);
  return (
    <form action={action} className="space-y-1">
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "取り消しています…" : "切り替えの記録を取り消す"}
      </Button>
      <Result state={state} />
    </form>
  );
}
