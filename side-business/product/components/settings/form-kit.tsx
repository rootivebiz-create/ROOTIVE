"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ResultLine, useFormAction, type FormAction } from "~/components/form-field";

/** 設定の画面で使うフォームの小さな部品（送信・結果・入力欄の誤り・チェック） */

// 入力欄（誤りは赤・aria-invalid）・送り方（誤りのある欄へ移る）・結果（誤りの箇条書き）は、製品の共通の部品
export { F, ResultLine, useFormAction, type FormAction, type FormState } from "~/components/form-field";

/** チェック（押せる所を広く） */
export function Check({
  name,
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        name={name}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.currentTarget.checked) : undefined}
        disabled={disabled}
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** 選ぶ（ラジオ）。押せる所を広く、説明を 1 行ずつ */
export function Choice<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string; help?: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2" role="radiogroup">
      {options.map((o) => (
        <label
          key={o.id}
          className={cx(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-card p-3",
            value === o.id ? "border-foreground" : "border-border",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} disabled={disabled} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]" />
          <span className="min-w-0">
            <span className="block text-sm font-bold">{o.label}</span>
            {o.help && <span className="mt-0.5 block text-xs text-muted-foreground">{o.help}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** 見出しつきのまとまり */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 rounded-card border border-border bg-card p-4">
      <legend className="px-1 text-base font-bold">{title}</legend>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
      {children}
    </fieldset>
  );
}

/** 注意の帯（赤・黄・緑・灰） */
export function Callout({ tone, children }: { tone: "red" | "yellow" | "green" | "gray"; children: ReactNode }) {
  const cls = {
    red: "border-danger/40 bg-danger/10 text-danger",
    yellow: "border-warning/40 bg-warning/10 text-warning",
    green: "border-success/40 bg-success/10 text-success",
    gray: "border-border bg-muted text-muted-foreground",
  }[tone];
  return <div className={cx("rounded-lg border p-3 text-sm", cls)}>{children}</div>;
}

/**
 * ボタン 1 つで送る小さなフォーム。confirm を渡すと、押したあとに確かめてから送る（消す・止める など）。
 */
export function ActionButton({
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
  // うまくいったら確かめの枠を閉じる（同じ場所に次の操作のボタンが出たとき、確かめが開いたままにならないように）
  useEffect(() => {
    if (state?.ok) setAsking(false);
  }, [state]);
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
      ) : confirm ? (
        <Button variant={variant} className={danger ? "text-danger" : undefined} onClick={() => setAsking(true)}>
          {label}
        </Button>
      ) : (
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? pendingLabel : label}
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

/** 送るボタン（保存中の表示つき） */
export function SubmitRow({ pending, label, pendingLabel = "保存しています…", children }: { pending: boolean; label: string; pendingLabel?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? pendingLabel : label}
      </Button>
      {children}
    </div>
  );
}
