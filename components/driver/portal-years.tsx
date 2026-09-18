"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/utils";
import { formatMonthJa } from "@/lib/month";
import type { PortalYearSummary } from "./helpers";

/** 年間サマリー：年を選ぶと、その年の合計（税込お支払額）・締め済み月数・月別の内訳を表示する */
export function PortalYearsCard({ years }: { years: PortalYearSummary[] }) {
  const [selected, setSelected] = useState<number>(years[0]?.year ?? 0);
  if (years.length === 0) return null;
  const year = years.find((y) => y.year === selected) ?? years[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>年間サマリー</CardTitle>
        <CardDescription>締め済みの月の合計です。未締めの月は含みません。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="tablist" aria-label="年の選択" className="flex gap-1 whitespace-nowrap">
            {years.map((y) => (
              <button
                key={y.year}
                type="button"
                role="tab"
                aria-selected={y.year === year.year}
                onClick={() => setSelected(y.year)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium",
                  y.year === year.year ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <span className="num">{y.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">お支払額の合計（税込）</p>
            <Money value={year.totalPayoutIncl} className="text-lg font-semibold" />
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">締め済みの月数</p>
            <p className="num text-lg font-semibold">{year.closedCount} か月</p>
          </div>
        </div>

        {year.closedCount > 0 && (
          <ul className="divide-y rounded-md border">
            {year.months
              .filter((m) => m.status === "closed")
              .map((m) => (
                <li key={m.month} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="num">{formatMonthJa(m.month)}</span>
                  <Money value={m.payoutIncl} />
                </li>
              ))}
          </ul>
        )}

        {year.openCount > 0 && (
          <p className="text-xs text-muted-foreground">
            ※ 未締めの月が <span className="num">{year.openCount}</span> か月あります（合計には含みません）。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
