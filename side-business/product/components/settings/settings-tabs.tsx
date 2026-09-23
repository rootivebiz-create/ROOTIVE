"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

export type SettingsTab = { href: string; label: string };

/** 設定の中の移動（スマホは横にすべらせる）。いまの画面に色を付ける */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="設定の項目" className="-mx-4 mb-5 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1 text-sm">
        {tabs.map((t) => {
          const current = t.href === "/settings" ? path === "/settings" : path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 no-underline",
                  current ? "border-foreground font-bold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
