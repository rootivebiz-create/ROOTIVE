import { Money } from "@/components/ui/money";
import { yen, pct } from "@/lib/format";
import { subMoney, sumMoney } from "@/lib/calc/money";
import type { MonthSummary } from "@/lib/db/types";

/**
 * 売上の内訳バー（§4.1）
 * 会社売上 ＝ 支払 ＋ 単価差額利益 ＋ ロイヤリティ ＋ 管理費 ＋ 調整（利益計上分）
 * 各区分の幅は金額比率（負の区分はバーでは 0 扱い、凡例には負の金額を表示）
 */
const SEGMENTS = [
  { key: "payout", label: "支払", color: "var(--chart-1)" },
  { key: "margin", label: "単価差額利益", color: "var(--chart-2)" },
  { key: "royalty", label: "ロイヤリティ", color: "var(--chart-3)" },
  { key: "mgmt_fee", label: "管理費", color: "var(--chart-4)" },
  { key: "adj_profit", label: "調整", color: "var(--chart-5)" },
] as const;

export function RevenueBreakdown({ summary }: { summary: MonthSummary }) {
  const bill = Number(summary.bill ?? 0);
  const values = SEGMENTS.map((s) => ({ ...s, value: Number(summary[s.key] ?? 0) }));
  const segmentSum = sumMoney(values.map((v) => v.value));
  const diff = subMoney(segmentSum, bill);
  const positives = values.filter((v) => v.value > 0);
  const hasData = bill !== 0 || positives.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">会社売上</span>
        <Money value={bill} className="text-lg font-semibold" />
      </div>

      {hasData ? (
        <div
          className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md bg-muted"
          role="img"
          aria-label={values.map((v) => `${v.label} ${yen(v.value)}`).join("、")}
        >
          {positives.map((v) => (
            <div key={v.key} style={{ flex: `${v.value} 1 0%`, background: v.color }} title={`${v.label} ${yen(v.value)}`} />
          ))}
        </div>
      ) : (
        <div className="flex h-6 w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">この月の稼働データはまだありません</div>
      )}

      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {values.map((v) => (
          <li key={v.key} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: v.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {v.label}
              {v.key === "adj_profit" && v.value < 0 && <span className="ml-1 text-xs text-muted-foreground">（バーでは 0 扱い）</span>}
            </span>
            <Money value={v.value} />
            <span className="num w-12 text-xs text-muted-foreground">{bill !== 0 ? pct(v.value / bill) : "—"}</span>
          </li>
        ))}
      </ul>

      {Math.abs(diff) >= 0.005 && (
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          区分の合計 <span className="num">{yen(segmentSum)}</span> は会社売上と <span className="num">{diff > 0 ? `+${yen(diff)}` : yen(diff)}</span> ずれています。
          会社利益に計上しない調整（立替精算など）は支払額に含まれますが会社売上には含まれないためです。
        </p>
      )}
    </div>
  );
}
