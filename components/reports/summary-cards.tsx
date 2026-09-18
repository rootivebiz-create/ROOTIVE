import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, Pct } from "@/components/ui/money";
import { pct, yen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReportTotals, YearComparison, YearDelta } from "./helpers";

/** 年間サマリーのカード（金額は税抜。営業利益 ＝ 会社利益 − 経費） */
export function ReportSummaryCards({ year, totals }: { year: number; totals: ReportTotals }) {
  const cards: { key: string; label: string; node: React.ReactNode; note?: string }[] = [
    { key: "bill", label: "売上（税抜）", node: <Money value={totals.bill} />, note: `${totals.entryCount} 件の稼働行` },
    { key: "profit", label: "会社利益", node: <Money value={totals.profit} /> },
    { key: "expense", label: "経費", node: <Money value={totals.expenseTotal} />, note: `固定 ${yen(totals.expenseFixed)} ／ 変動 ${yen(totals.expenseVariable)}` },
    { key: "operating", label: "営業利益", node: <Money value={totals.operatingProfit} />, note: "会社利益 − 経費" },
    { key: "margin", label: "営業利益率", node: <Pct value={totals.operatingMargin} /> },
    { key: "payout", label: "ドライバー支払（税抜）", node: <Money value={totals.payout} />, note: `税込 ${yen(totals.payoutIncl)}` },
    { key: "tax", label: "消費税", node: <Money value={totals.tax} /> },
    { key: "drivers", label: "稼働ドライバー（ピーク）", node: <span className="num">{totals.peakActiveDriverCount} 名</span>, note: `データのある月：${totals.dataMonthCount} か月` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.key} className="min-w-0 p-3 md:p-4">
          <p className="text-xs text-muted-foreground md:text-sm">{c.label}</p>
          <p className="mt-1 text-lg font-semibold md:text-2xl">{c.node}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground md:text-xs">{c.note ?? `${year}年の合計`}</p>
        </Card>
      ))}
    </div>
  );
}

/** upIsGood: 増加を良い変化として色付けするか（経費は増加が悪い変化） */
function DeltaRow({ label, delta, upIsGood }: { label: string; delta: YearDelta; upIsGood: boolean }) {
  const tone = delta.diff === 0 ? "text-muted-foreground" : delta.diff > 0 === upIsGood ? "text-success" : "text-destructive";
  const Icon = delta.diff > 0 ? ArrowUpRight : delta.diff < 0 ? ArrowDownRight : ArrowRight;
  return (
    <div className="flex items-baseline justify-between gap-2 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("flex items-baseline gap-1.5 text-sm font-semibold", tone)}>
        <Icon className="h-4 w-4 self-center" aria-hidden />
        <span className="num">{delta.diff >= 0 ? `+${yen(delta.diff)}` : yen(delta.diff)}</span>
        <span className="num text-xs">（{delta.ratio == null ? "—" : `${delta.ratio >= 0 ? "+" : "-"}${pct(Math.abs(delta.ratio))}`}）</span>
      </span>
    </div>
  );
}

/** 前年比（前年のデータが無ければ「前年データなし」） */
export function YearComparisonCard({ year, comparison }: { year: number; comparison: YearComparison | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>前年比</CardTitle>
        <CardDescription>
          {comparison ? `${comparison.previousYear}年の合計との比較（${year}年 − ${comparison.previousYear}年）` : `${year - 1}年のデータがありません`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {comparison ? (
          <div>
            <DeltaRow label="売上" delta={comparison.bill} upIsGood />
            <DeltaRow label="会社利益" delta={comparison.profit} upIsGood />
            <DeltaRow label="経費" delta={comparison.expenseTotal} upIsGood={false} />
            <DeltaRow label="営業利益" delta={comparison.operatingProfit} upIsGood />
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">前年データなし</p>
        )}
      </CardContent>
    </Card>
  );
}
