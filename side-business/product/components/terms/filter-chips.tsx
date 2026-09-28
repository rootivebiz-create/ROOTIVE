import Link from "next/link";

const TONE = {
  red: "border-danger/40 text-danger",
  yellow: "border-warning/40 text-warning",
  gray: "border-border text-foreground",
} as const;

/** 絞り込み（押せる所は 44px 以上。今の絞り込みは塗りつぶし） */
export function TermsFilterChips({ items }: { items: { href: string; label: string; count?: number; current: boolean; tone?: keyof typeof TONE }[] }) {
  return (
    <nav aria-label="絞り込み" className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-sm font-bold no-underline ${
            it.current ? "border-foreground bg-foreground text-background" : `bg-card ${TONE[it.tone ?? "gray"]}`
          }`}
        >
          {it.label}
          {it.count !== undefined && <span className="num">{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
