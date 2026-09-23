/**
 * /tools/payout の入力欄の小さな部品（ラベル・単位・説明つき）。
 * 数字は文字のまま受け渡し、読むのは state.tsx の toPayoutInput に任せる。
 */
import { useId, type ReactNode } from "react";
import { Button, Input, NumberInput, Select } from "@/components/ui";
import { cx } from "@/lib/cx";

export function NumField({
  label,
  value,
  onChange,
  suffix,
  hint,
  placeholder,
  integer,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 欄の右に出す単位（円・%・時間など） */
  suffix?: string;
  hint?: string;
  placeholder?: string;
  /** 小数を入れない欄（テンキーを数字だけにする） */
  integer?: boolean;
  className?: string;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
        {suffix && <span className="sr-only">（{suffix}）</span>}
      </label>
      <div className="relative mt-1">
        <NumberInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={integer ? "numeric" : "decimal"}
          enterKeyHint="done"
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          className={suffix ? (suffix.length > 1 ? "pr-14" : "pr-9") : undefined}
        />
        {suffix && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-describedby={hint ? hintId : undefined}
        className="mt-1"
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function DateField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <Select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
        aria-describedby={hint ? hintId : undefined}
        className="mt-1"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </Select>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span className="text-sm">
        <span className="font-bold">{children}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** 選択肢をカードで並べるラジオ（2〜3択） */
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
  hint,
  columns = 2,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; note?: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
  columns?: 2 | 3;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-bold">{legend}</legend>
      <div className={cx("mt-1 grid gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-checked:border-foreground has-checked:ring-1 has-checked:ring-foreground"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold">{o.label}</span>
              {o.note && <span className="block text-xs text-muted-foreground">{o.note}</span>}
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

/** 行を消すボタン（44px の押しやすさ） */
export function RemoveButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} aria-label={`${what}を消す`} className="shrink-0 px-3 text-danger">
      消す
    </Button>
  );
}

/** 行を足すボタン */
export function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick} disabled={disabled} className="w-full sm:w-auto">
      <span aria-hidden>＋</span>
      {children}
    </Button>
  );
}
