import { en } from "@/lib/engine/types";
import type { OtherStatement } from "~/server/features/portal";
import { jpDateWithWeekday } from "~/server/features/statements/view";

/** ドライバーの画面の「ほかの月の明細」：同じ人の、締めた月か会社が送った明細だけ（リンクは明細ごとに作ってある） */
export function OtherStatements({ items }: { items: OtherStatement[] }) {
  return (
    <section className="rounded-card border border-border bg-card p-4" aria-label="ほかの月の明細">
      <h2 className="font-bold">ほかの月の明細</h2>
      <p className="mt-1 text-xs text-muted-foreground">あなたの明細だけが並びます（前後 12 か月。締めた月と、会社から届いた明細）。</p>
      <ul className="mt-2 divide-y divide-border">
        {items.map((o) => (
          <li key={o.month}>
            <a href={o.href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-foreground no-underline">
              <span className="min-w-0">
                <span className="block font-bold">{o.label}分</span>
                <span className="block text-xs text-muted-foreground">
                  振込予定日 {jpDateWithWeekday(o.payDate)}
                  {o.confirmed ? "・確認済み" : ""}
                </span>
              </span>
              <span className="num whitespace-nowrap font-bold">{en(o.total)} →</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
