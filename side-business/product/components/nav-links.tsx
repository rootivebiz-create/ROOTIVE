"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/cx";
import { isCurrentNav, type NavItem } from "~/components/nav";

type Item = Pick<NavItem, "href" | "label" | "short">;

/** スマホの上の横スクロールのメニュー。いまの画面の項目に印を付け、見える所まで横に送る（右端はうすくして、続きがあることを見せる） */
export function MobileNav({ items }: { items: Item[] }) {
  const pathname = usePathname() ?? "/";
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    // 画面ごと動かさないように、メニューの中だけを横に送る（まん中あたりに）
    list.scrollLeft = Math.max(0, current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2);
  }, [pathname]);
  return (
    <div className="relative">
      <ul ref={listRef} className="flex gap-1 overflow-x-auto px-2 py-1 text-sm">
        {items.map((n) => {
          const current = isCurrentNav(pathname, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-foreground no-underline hover:bg-muted",
                  current && "bg-muted font-bold underline decoration-2 underline-offset-4",
                )}
              >
                {n.short}
              </Link>
            </li>
          );
        })}
      </ul>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-6" style={{ background: "linear-gradient(to left, var(--background), transparent)" }} />
    </div>
  );
}

/** パソコンの左のメニュー。いまの画面の項目に印を付ける */
export function SideNav({ items }: { items: Item[] }) {
  const pathname = usePathname() ?? "/";
  return (
    <ul className="sticky top-20 space-y-1 text-sm">
      {items.map((n) => {
        const current = isCurrentNav(pathname, n.href);
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              aria-current={current ? "page" : undefined}
              className={cx(
                "flex min-h-11 items-center rounded-md border-l-4 px-3 text-foreground no-underline hover:bg-muted",
                current ? "border-foreground bg-muted font-bold" : "border-transparent",
              )}
            >
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
