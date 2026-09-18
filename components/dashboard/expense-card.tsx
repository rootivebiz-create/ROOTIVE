import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, Pct } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { EXPENSE_KIND_LABELS } from "@/lib/db/types";
import { yen } from "@/lib/format";
import type { ExpenseBreakdown } from "./helpers";

/** 経費の内訳（カテゴリ別の上位 5 件）。/expenses へ遷移できる小さなカード */
export function ExpenseCard({ breakdown, fixed, variable }: { breakdown: ExpenseBreakdown; fixed: number; variable: number }) {
  const { rows, othersAmount, othersCount, total } = breakdown;

  return (
    <Card>
      <CardHeader>
        <CardTitle>経費の内訳</CardTitle>
        <CardDescription>
          {total === 0 ? "この月の経費はまだ登録されていません。" : `合計 ${yen(total)}（固定費 ${yen(fixed)} ／ 変動費 ${yen(variable)}、いずれも税抜）`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length > 0 && (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.categoryId} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {r.categoryName}
                    <span className="ml-1 text-xs text-muted-foreground">{EXPENSE_KIND_LABELS[r.kind]}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <Money value={r.amount} />
                    <Pct value={r.share} className="w-12 text-right text-xs text-muted-foreground" />
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(1, Math.max(0, r.share)) * 100}%`, background: "var(--chart-4)" }} />
                </div>
              </li>
            ))}
            {othersCount > 0 && (
              <li className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
                <span>ほか {othersCount} カテゴリ</span>
                <Money value={othersAmount} />
              </li>
            )}
          </ul>
        )}
        <MonthLink href="/expenses" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-primary hover:bg-muted">
          <span>経費を入力・確認する</span>
          <ChevronRight className="h-4 w-4" />
        </MonthLink>
      </CardContent>
    </Card>
  );
}
