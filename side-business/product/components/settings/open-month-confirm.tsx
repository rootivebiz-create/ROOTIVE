"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { cx } from "@/lib/cx";
import { messageKey, OPEN_MONTHS_FIELD } from "~/server/features/settings/open-months-key";
import { ResultLine, useFormAction, type FormAction, type FormState } from "./form-kit";

/**
 * 単価・控除の変更で、まだ締めていない月の明細（見込み）が変わるとき：サーバーが変わる月と額を返したら、
 * 「上の月の明細にも反映する」の印の欄を出す（フォームの中に置く）。印の値は、画面に出た説明の文から作る
 * （画面で見たあとに影響が変わっていれば、サーバーが保存しない。server/features/settings/open-months.ts）。
 */
export function OpenMonthConfirm({ state }: { state: FormState }) {
  if (!state || state.ok || !state.fieldErrors?.[OPEN_MONTHS_FIELD]) return null;
  const key = messageKey(state.error);
  return (
    <label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <input type="checkbox" name={OPEN_MONTHS_FIELD} value={key} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0 text-sm">
        <span className="block font-bold">上の月の明細にも反映する</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">変わる月と額を確かめました。印を付けて、もう一度押すと保存します。</span>
      </span>
    </label>
  );
}

/**
 * ボタン 1 つで送る小さなフォーム（form-kit の ActionButton と同じ使い方）。
 * 控除を止める・消す、人ごとの単価を消す など、まだ締めていない月の明細が変わる操作で使う（「反映する」の印の欄つき）。
 */
export function OpenMonthActionButton({
  action,
  hidden,
  label,
  pendingLabel = "送っています…",
  variant = "secondary",
  confirm,
  confirmLabel = "はい",
  danger,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "accent";
  confirm?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (state?.ok) setAsking(false);
  }, [state]);
  const needsMark = !!state && !state.ok && !!state.fieldErrors?.[OPEN_MONTHS_FIELD];
  return (
    <form onSubmit={onSubmit} className="min-w-0">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {confirm && asking ? (
        <div className={cx("space-y-2 rounded-lg border p-3 text-sm", danger ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10")}>
          <div>{confirm}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : confirm && !needsMark ? (
        <Button variant={variant} className={danger ? "text-danger" : undefined} onClick={() => setAsking(true)}>
          {label}
        </Button>
      ) : (
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? pendingLabel : label}
        </Button>
      )}
      {state && (
        <div className="mt-2 space-y-2">
          <ResultLine state={state} />
          <OpenMonthConfirm state={state} />
        </div>
      )}
    </form>
  );
}
