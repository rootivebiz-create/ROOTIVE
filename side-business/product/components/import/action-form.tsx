"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { ResultLine, useFormAction, type FormAction } from "~/components/form-field";

// 送り方・結果の出し方・入力欄の誤りは、製品の共通の部品（components/form-field.tsx）
export { ResultLine, useFormAction, type FormAction, type FormState } from "~/components/form-field";

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
