"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { FINANCE_TABS, type FinanceTab } from "@/lib/schemas/finance";

const LABELS: Record<FinanceTab, string> = {
  budget: "予算",
  loans: "借入",
  tax: "税務",
};

/**
 * 財務画面のタブ（?tab=budget|loans|tax）
 * ?m（稼動月）や ?y（対象年）など、ほかのパラメータはそのまま引き継ぐ
 */
export function FinanceTabs({ tab, badges = {} }: { tab: FinanceTab; badges?: Partial<Record<FinanceTab, number>> }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefOf = (key: FinanceTab) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", key);
    // 借入の選択はタブを移ると意味が無い
    sp.delete("loan");
    return `${pathname}?${sp.toString()}`;
  };

  return (
    <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex gap-1 rounded-md bg-muted p-1">
        {FINANCE_TABS.map((key) => (
          <Link
            key={key}
            href={hrefOf(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              tab === key && "bg-card text-foreground shadow",
            )}
          >
            {LABELS[key]}
            {(badges[key] ?? 0) > 0 && <span className="num rounded-full bg-warning px-1.5 text-xs font-semibold text-white">{badges[key]}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
