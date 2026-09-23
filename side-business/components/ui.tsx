/** 小さな UI 部品（Tailwind のみ）。ボタン・カード・入力欄・数値の表示 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "accent";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  accent: "bg-accent text-accent-foreground hover:opacity-90",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

/** リンクをボタンの見た目にするときのクラス */
export function buttonClass(variant: Variant = "primary", className?: string) {
  return cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold no-underline transition",
    VARIANT[variant],
    className,
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-card border border-border bg-card p-4", className)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-bold">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputBase =
  "block w-full min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground outline-none focus:border-foreground";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputBase, className)} {...props} />;
}

/** 数値の入力（スマホではテンキー）。値は文字列のまま扱い、確定時に parseAmount で数にする */
export function NumberInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input inputMode="decimal" autoComplete="off" className={cx(inputBase, "num text-right", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

/** 金額（等幅・右寄せ・マイナスは赤） */
export function Money({ value, className }: { value: number; className?: string }) {
  const v = Math.round(value);
  const text = `${v < 0 ? "-" : ""}¥${new Intl.NumberFormat("ja-JP").format(Math.abs(v))}`;
  return <span className={cx("num whitespace-nowrap", v < 0 && "text-danger", className)}>{text}</span>;
}

/** 横にはみ出す表を包む（スマホでは横スクロール） */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">{children}</div>;
}
