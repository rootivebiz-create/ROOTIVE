"use client";

/** デモの画面で共通に使う小さな部品（数値の入力欄・開け閉めできるカード・インボイスの札・表のクラス） */
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Input, NumberInput } from "@/components/ui";
import { cx } from "@/lib/cx";
import type { AccountType } from "@/lib/payroll/types";
import { toZenginKana } from "@/lib/payroll/zengin";
import { normalizeMonth, parseNonNegative, readNumberDraft } from "./format";

/** 表のセル */
export const th = "border-b border-border px-2 py-2 sm:px-3 text-left text-xs font-bold text-muted-foreground whitespace-nowrap";
export const thNum = cx(th, "text-right");
export const td = "border-b border-border px-2 py-2 align-middle sm:px-3";
export const tdNum = cx(td, "num text-right whitespace-nowrap");

const plain = (v: number) => (v === 0 ? "" : String(v));

/**
 * 数値の入力欄。打っている間は文字のまま持ち、数として読めたときだけ onValue に渡す。
 * 読めない文字は枠を赤くし、欄を離れると保存されている値に戻す。空欄は emptyAs（既定 0）。
 */
export function NumberField({
  value,
  onValue,
  parse = parseNonNegative,
  display = plain,
  editText = plain,
  emptyAs = 0,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onFocus" | "onBlur"> & {
  value: number;
  onValue: (value: number) => void;
  parse?: (text: string) => number | null;
  /** 欄を離れているときの見せ方 */
  display?: (value: number) => string;
  /** 欄に入ったときの文字（既定は素の数字。% の欄なら 0.1 ではなく 10 にする） */
  editText?: (value: number) => string;
  emptyAs?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const read = (text: string) => readNumberDraft(text, parse, emptyAs);
  const invalid = draft !== null && read(draft) === null;
  return (
    <NumberInput
      {...props}
      value={draft ?? display(value)}
      aria-invalid={invalid || undefined}
      className={cx(invalid && "ring-2 ring-danger", className)}
      onFocus={() => setDraft(editText(value))}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = read(e.target.value);
        if (n !== null && n !== value) onValue(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * 対象の月の欄。月の欄（type=month）が使えないブラウザでは文字の欄になるので、打っている間は文字のまま持ち、
 * 月として読めたとき（2026-10・2026/10・2026年10月）だけ onValue に渡す。欄を離れると保存されている月に戻す。
 */
export function MonthField({
  value,
  onValue,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "type"> & {
  value: string;
  onValue: (month: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && draft.trim() !== "" && normalizeMonth(draft) === null;
  return (
    <Input
      {...props}
      type="month"
      value={draft ?? value}
      aria-invalid={invalid || undefined}
      className={cx(invalid && "ring-2 ring-danger", className)}
      onChange={(e) => {
        setDraft(e.target.value);
        const month = normalizeMonth(e.target.value);
        if (month && month !== value) onValue(month);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** 金額の表示（欄を離れているときはカンマ区切り。0 は空欄にして placeholder を見せる） */
export const commaDisplay = (v: number) => (v === 0 ? "" : new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(v));

/** 文字だけのボタン（リンク色・赤） */
export const textButton = (tone: "link" | "danger" = "link") =>
  cx(
    "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-bold hover:bg-muted disabled:opacity-50",
    tone === "link" ? "text-link" : "text-danger",
  );

/** 押すと中身が開くカード（見出しのボタンの中に操作できる部品を入れない） */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cx("rounded-card border border-border bg-card", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-3 rounded-card px-4 py-3 text-left text-foreground"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={cx("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        >
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={id} className="border-t border-border px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

/** インボイス登録の有無 */
export function InvoiceBadge({ registered }: { registered: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold leading-tight",
        registered ? "border-success text-success" : "border-warning text-warning",
      )}
    >
      インボイス{registered ? "登録済み" : "未登録"}
    </span>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("text-lg font-bold", className)}>{children}</h2>;
}

/** 入力の下に出す注意（赤字） */
export function Issues({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-danger">
      {messages.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "ordinary", label: "普通" },
  { value: "checking", label: "当座" },
];

/** カナの欄の下に「振込データではこう入ります」と、使えない文字を出す */
export function KanaPreview({ value }: { value: string }) {
  if (!value.trim()) return null;
  const { value: half, invalid } = toZenginKana(value);
  return (
    <span className="mt-1 block text-xs text-muted-foreground">
      データでは：<span className="font-mono text-foreground">{half || "（空）"}</span>
      {invalid.length > 0 && <span className="ml-2 text-danger">使えない文字：{invalid.join("")}</span>}
    </span>
  );
}
