/**
 * 提案書（A4 横）の 1 枚。画面ではカードとして縦に並び、印刷では 1 枚 = 1 ページ（297×210mm）になる。
 * 印刷の寸法は app/kit/proposal/page.tsx の DECK_CSS（.kit-slide）が決める。
 */
import type { ReactNode } from "react";
import { SITE } from "@/site.config";
import { cx } from "./format";

export function Slide({
  id,
  n,
  total,
  kicker,
  title,
  children,
  className,
}: {
  id: string;
  n: number;
  total: number;
  kicker?: string;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : `${n}枚目`}
      className={cx(
        "kit-slide print-break mb-6 flex flex-col rounded-card border border-border bg-card p-5 shadow-sm sm:p-8 lg:aspect-[297/210] lg:p-10",
        className,
      )}
    >
      {title && (
        <header className="mb-4 lg:mb-5">
          {kicker && <p className="text-xs font-bold tracking-wide text-muted-foreground lg:text-sm">{kicker}</p>}
          <h2
            id={headingId}
            className="mt-1 text-[1.35rem] font-bold leading-snug [word-break:auto-phrase] sm:text-2xl lg:text-[1.75rem]"
          >
            {title}
          </h2>
          <span aria-hidden className="mt-2 block h-1 w-12 rounded-full bg-accent" />
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="font-bold">{SITE.name}</span>
        <span className="num">
          {n} / {total}
        </span>
      </footer>
    </section>
  );
}

/** デモの数字であることを示す札 */
export function DemoBadge({ children = "デモの架空データ" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-foreground px-2 py-0.5 text-xs font-bold leading-5">
      {children}
    </span>
  );
}

/** 小さな表（左は文字、右は数字） */
export function MiniTable({
  caption,
  head,
  rows,
  foot,
  dense = false,
  className,
}: {
  caption?: ReactNode;
  head: { label: string; num?: boolean }[];
  rows: ReactNode[][];
  foot?: ReactNode[];
  /** 行の上下を詰める（1 枚に収めたいとき） */
  dense?: boolean;
  className?: string;
}) {
  const align = (i: number) => (head[i]?.num ? "text-right num whitespace-nowrap" : "text-left");
  return (
    <table className={cx("w-full border-collapse text-[13px] leading-snug lg:text-sm", className)}>
      {caption && <caption className="mb-1 text-left text-sm font-bold lg:text-base">{caption}</caption>}
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h.label}
              scope="col"
              className={cx("border-b-2 border-foreground px-1.5 py-1 font-bold whitespace-nowrap", align(i))}
            >
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (
              <td key={ci} className={cx("border-b border-border px-1.5 py-1 align-top", !dense && "lg:py-1.5", align(ci))}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr>
            {foot.map((c, ci) => (
              <td key={ci} className={cx("border-t-2 border-foreground px-1.5 py-1 font-bold", align(ci))}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
