"use client";

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "~/server/action";

export type FormState = ActionResult<unknown> | undefined;
export type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

/**
 * フォームを Server Action で送る。form の action に直接渡すと、React が送ったあとに入力を空に戻すため、
 * 入力の誤りを直すときに打ち直しになる。ここでは onSubmit から送り、入力はそのまま残す。
 */
export function useFormAction(action: FormAction) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}

/** 結果（うまくいった・だめだった）を 1 行で出す */
export function ResultLine({ state }: { state: FormState }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (!state.message) return null;
  return (
    <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
      {state.message}
    </p>
  );
}

/**
 * ボタン 1 つで送る小さなフォーム（隠した値は children で渡す）。
 * confirm を渡すと、押したあとに「本当に？」を出してから送る（消す・取り消すなど）。
 */
export function ActionForm({
  action,
  children,
  submit,
  pendingText = "送っています…",
  variant = "secondary",
  confirm,
  confirmSubmit,
  className,
  buttonClassName,
}: {
  action: FormAction;
  children?: ReactNode;
  submit: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "accent";
  confirm?: ReactNode;
  confirmSubmit?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [asking, setAsking] = useState(false);
  return (
    <form onSubmit={onSubmit} className={className}>
      {children}
      {confirm && !asking ? (
        <Button variant={variant} className={buttonClassName} onClick={() => setAsking(true)}>
          {submit}
        </Button>
      ) : confirm ? (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <div>{confirm}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? pendingText : (confirmSubmit ?? "はい")}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant={variant} className={buttonClassName} disabled={pending}>
          {pending ? pendingText : submit}
        </Button>
      )}
      {state && (
        <div className="mt-2">
          <ResultLine state={state} />
        </div>
      )}
    </form>
  );
}
