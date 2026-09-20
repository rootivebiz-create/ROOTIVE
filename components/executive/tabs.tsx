"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface ExecutiveTabItem {
  /** ?tab= の値。"" は既定のタブ（?tab= を付けない） */
  key: string;
  label: string;
  /** 件数のバッジ（0 のときは出さない） */
  count?: number;
}

/**
 * 代表の画面のタブ（?tab=…）
 *
 * 稼動月（?m）など、ほかのパラメータはそのまま引き継ぐ（CLAUDE.md §4）。
 * スマホでは横スクロールする。
 */
export function ExecutiveTabs({ tabs, current, className }: { tabs: ExecutiveTabItem[]; current: string; className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefOf = (key: string) => {
    const sp = new URLSearchParams(params.toString());
    if (key) sp.set("tab", key);
    else sp.delete("tab");
    const q = sp.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <div className={cn("mb-4 -mx-1 overflow-x-auto px-1 pb-1", className)}>
      <div className="inline-flex gap-1 rounded-md bg-muted p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={hrefOf(t.key)}
            aria-current={current === t.key ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              current === t.key && "bg-card text-foreground shadow",
            )}
          >
            {t.label}
            {(t.count ?? 0) > 0 && <span className="num text-xs">({t.count})</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
