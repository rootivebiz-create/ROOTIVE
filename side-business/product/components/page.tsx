import Link from "next/link";
import type { ReactNode } from "react";
import { monthLabelJa, monthParam, shiftMonth } from "~/server/month";

/** 画面の見出し。月を使う画面は month を渡すと、前後の月へ移れる */
export function PageHeader({
  title,
  description,
  month,
  basePath,
  actions,
}: {
  title: string;
  description?: ReactNode;
  month?: string;
  basePath?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {month && basePath && <MonthSwitcher month={month} basePath={basePath} />}
        {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function MonthSwitcher({ month, basePath }: { month: string; basePath: string }) {
  const prev = monthParam(shiftMonth(month, -1));
  const next = monthParam(shiftMonth(month, 1));
  const cls = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card text-foreground no-underline hover:bg-muted";
  return (
    <div className="flex items-center gap-1" aria-label="月の切り替え">
      <Link href={`${basePath}?m=${prev}`} className={cls} aria-label="前の月">
        ‹
      </Link>
      <span className="min-w-24 text-center font-bold">{monthLabelJa(month)}</span>
      <Link href={`${basePath}?m=${next}`} className={cls} aria-label="次の月">
        ›
      </Link>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-card p-6 text-center">
      <p className="font-bold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

const TONE = {
  red: "border-danger/40 bg-danger/10 text-danger",
  yellow: "border-warning/40 bg-warning/10 text-warning",
  green: "border-success/40 bg-success/10 text-success",
  gray: "border-border bg-muted text-muted-foreground",
} as const;

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${TONE[tone]}`}>{children}</span>;
}

/** 保存の結果（成功・失敗）を 1 行で出す */
export function Notice({ tone, children }: { tone: "ok" | "error" | "info"; children: ReactNode }) {
  const cls = tone === "ok" ? TONE.green : tone === "error" ? TONE.red : TONE.gray;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}
