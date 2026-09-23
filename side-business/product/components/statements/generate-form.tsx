"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { Notice } from "~/components/page";
import { generateStatementsAction, type GenerateState } from "~/app/(app)/statements/actions";

/**
 * 「明細を作る・作り直す」。確認済みの人の明細が変わる・明細が消える人がいるときは、先に中身を見せてから押してもらう。
 */
export function GenerateForm({ month, label, warning }: { month: string; label: string; warning: string | null }) {
  const [state, action, pending] = useActionState(generateStatementsAction, undefined);
  // 確かめの箱は、開いたときの結果のままのあいだだけ出す（作り終わったら自然に閉じる）
  const [opened, setOpened] = useState<{ at: GenerateState } | null>(null);
  const confirming = !!warning && opened !== null && opened.at === state;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      {confirming ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alertdialog" aria-label="作り直す前の確認">
          <p className="font-bold text-warning">作り直す前にご確認ください</p>
          <p className="mt-1">{warning}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "作っています…" : "それでも作り直す"}
            </Button>
            <Button variant="secondary" onClick={() => setOpened(null)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : warning ? (
        <Button onClick={() => setOpened({ at: state })}>{label}</Button>
      ) : (
        <Button type="submit" disabled={pending}>
          {pending ? "作っています…" : label}
        </Button>
      )}
      {state && (state.ok ? <Notice tone="ok">{state.message}</Notice> : <Notice tone="error">{state.error}</Notice>)}
    </form>
  );
}
