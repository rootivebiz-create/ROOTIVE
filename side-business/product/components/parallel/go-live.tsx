"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { goLiveAction, undoGoLiveAction, type GoLiveState } from "~/app/(app)/parallel/actions";
import type { GoLiveGate } from "~/server/features/parallel/gate";

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
 * 「本番に切り替える（Excel をやめて、しめ日ラボで締める）」（オーナーだけ）。
 * 比べた人が全員「一致」か「理由のメモあり」のときだけ押せる（サーバーでも同じ goLiveGate で確かめる）。
 * 押す前に、止めはしないが気をつけること（未入力の人・続けて一致の月の数）を並べて確かめてもらう。
 */
export function GoLiveButton({
  month,
  monthLabel,
  gate,
}: {
  month: string;
  monthLabel: string;
  gate: Pick<GoLiveGate, "ready" | "streak" | "streakOk" | "cautions" | "missingNotes" | "compared" | "matched">;
}) {
  const [state, action, pending] = useActionState<GoLiveState, FormData>(goLiveAction, undefined);
  const [asking, setAsking] = useState(false);
  const { ready, streak } = gate;
  if (!asking) {
    return (
      <div className="space-y-2">
        <Button onClick={() => setAsking(true)} disabled={!ready} className="w-full sm:w-auto">
          本番に切り替える（Excel をやめる）…
        </Button>
        {!ready && (
          <p className="text-xs text-muted-foreground">
            比べた人が全員「一致」か、差のある人全員に理由のメモがある状態になると押せます
            {gate.missingNotes.length > 0 ? `（あと ${gate.missingNotes.length}人のメモ）` : ""}。
          </p>
        )}
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
          {monthLabel}分は {gate.compared}人中 {gate.matched}人が一致{gate.compared > gate.matched ? `、ほかの ${gate.compared - gate.matched}人は理由のメモあり` : ""}です。
        </li>
        <li>
          続けて一致（または説明済み）の月は {streak} か月です。{gate.streakOk ? "目安の 2〜3 か月に届いています。" : "目安の 2〜3 か月に届いていません。もう 1 か月並べて締めると安心です。"}
        </li>
        {gate.cautions
          .filter((c) => !c.startsWith("続けて一致"))
          .map((c) => (
            <li key={c}>{c}</li>
          ))}
        <li>記録は操作の記録に残ります（差のあった人とメモも一緒に）。あとから取り消せます（Excel と比べる画面は、いつでも使えます）。</li>
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

/** 切り替えの記録を取り消す（オーナーだけ）。押す前に、何が変わるかを見せて確かめる */
export function UndoGoLiveButton() {
  const [state, action, pending] = useActionState<GoLiveState, FormData>(undoGoLiveAction, undefined);
  const [asking, setAsking] = useState(false);
  if (!asking || state?.ok) {
    return (
      <div className="space-y-1">
        <Button variant="ghost" onClick={() => setAsking(true)} disabled={pending}>
          切り替えの記録を取り消す…
        </Button>
        <Result state={state} />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-bold">切り替えの記録を取り消しますか？</p>
      <p>ホームの「本番に切り替えた月」が「まだです」に戻り、Excel と並べて締める進め方に戻ります。明細・振込・締めの記録は変わりません。</p>
      <p className="text-muted-foreground">もう一度切り替えるときは、そのときの比べ合わせで条件（差のある人全員に理由のメモ）を確かめます。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "取り消しています…" : "取り消す"}
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)} disabled={pending}>
          やめる
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
