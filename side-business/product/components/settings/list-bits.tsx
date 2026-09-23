import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import { cx } from "@/lib/cx";

/** 一覧の上の検索（送るとページを読み直す。JavaScript が無くても動く） */
export function SearchBox({
  action,
  q,
  placeholder,
  hidden = {},
  children,
}: {
  action: string;
  q: string;
  placeholder: string;
  hidden?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <form action={action} method="get" role="search" className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden)
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label className="min-w-0 flex-1 basis-48">
        <span className="sr-only">探す</span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          className="block min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground"
        />
      </label>
      {children}
      <button type="submit" className={buttonClass("secondary")}>
        探す
      </button>
    </form>
  );
}

/** 絞り込みの切り替え（件数つき） */
export function FilterChips({ items }: { items: { href: string; label: string; count?: number; current: boolean; tone?: "red" | "yellow" }[] }) {
  return (
    <ul className="flex flex-wrap gap-2 text-sm" aria-label="絞り込み">
      {items.map((i) => (
        <li key={i.href}>
          <Link
            href={i.href}
            aria-current={i.current ? "true" : undefined}
            className={cx(
              "inline-flex min-h-11 items-center gap-1 rounded-full border px-3 no-underline",
              i.current ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {i.label}
            {i.count !== undefined && (
              <span className={cx("num font-bold", !i.current && i.count > 0 && i.tone === "red" && "text-danger", !i.current && i.count > 0 && i.tone === "yellow" && "text-warning")}>
                {i.count}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 開いて直す（スマホでも同じ場所で） */
export function Expand({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="group rounded-lg border border-border" open={open}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold">
        <span>{summary}</span>
        <span aria-hidden className="text-muted-foreground transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-3">{children}</div>
    </details>
  );
}
