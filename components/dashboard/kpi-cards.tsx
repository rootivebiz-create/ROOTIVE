import { Card } from "@/components/ui/card";
import { Money, Pct } from "@/components/ui/money";
import { yen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthSummary } from "@/lib/db/types";

type Kind = "money" | "rate";

interface KpiDef {
  key: string;
  label: string;
  kind: Kind;
  value: number;
  prev: number | null;
  /** 増加を良い変化として色付けするか（null＝中立） */
  upIsGood: boolean | null;
}

export interface KpiDelta {
  /** 差額（金額は "+¥12,345"、率は "+1.2pt"） */
  amount: string;
  /** 増減率（金額のみ。前月が 0 なら "—"） */
  ratio: string | null;
  direction: -1 | 0 | 1;
}

/** 前月比の差額と %（前月データが無ければ null） */
export function kpiDelta(kind: Kind, value: number, prev: number | null): KpiDelta | null {
  if (prev == null) return null;
  const d = value - prev;
  const direction: -1 | 0 | 1 = d > 0 ? 1 : d < 0 ? -1 : 0;
  if (kind === "rate") {
    const pt = d * 100;
    return { amount: `${pt >= 0 ? "+" : "-"}${Math.abs(pt).toFixed(1)}pt`, ratio: null, direction };
  }
  const amount = d >= 0 ? `+${yen(d)}` : yen(d);
  const ratio = prev !== 0 ? `${d >= 0 ? "+" : "-"}${(Math.abs(d / prev) * 100).toFixed(1)}%` : "—";
  return { amount, ratio, direction };
}

export function KpiCards({ summary, prev }: { summary: MonthSummary; prev: MonthSummary | null }) {
  const defs: KpiDef[] = [
    { key: "bill", label: "会社売上", kind: "money", value: Number(summary.bill ?? 0), prev: prev ? Number(prev.bill ?? 0) : null, upIsGood: true },
    { key: "profit", label: "会社利益", kind: "money", value: Number(summary.profit ?? 0), prev: prev ? Number(prev.profit ?? 0) : null, upIsGood: true },
    { key: "payout", label: "ドライバー支払合計", kind: "money", value: Number(summary.payout ?? 0), prev: prev ? Number(prev.payout ?? 0) : null, upIsGood: null },
    { key: "rate", label: "利益率", kind: "rate", value: Number(summary.profit_rate ?? 0), prev: prev ? Number(prev.profit_rate ?? 0) : null, upIsGood: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {defs.map((k) => {
        const delta = kpiDelta(k.kind, k.value, k.prev);
        const tone =
          !delta || delta.direction === 0 || k.upIsGood == null
            ? "text-muted-foreground"
            : delta.direction === 1 === k.upIsGood
              ? "text-success"
              : "text-destructive";
        return (
          <Card key={k.key} className="min-w-0 p-3 md:p-4">
            <p className="text-xs text-muted-foreground md:text-sm">{k.label}</p>
            <p className="mt-1 text-lg font-semibold md:text-2xl">
              {k.kind === "rate" ? <Pct value={k.value} /> : <Money value={k.value} />}
            </p>
            <p className={cn("mt-1 flex flex-wrap items-baseline gap-x-1 text-[11px] md:text-xs", tone)}>
              <span className="text-muted-foreground">前月比</span>
              {delta ? (
                <>
                  <span className="num">{delta.amount}</span>
                  {delta.ratio && <span className="num">（{delta.ratio}）</span>}
                </>
              ) : (
                <span className="num">—</span>
              )}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
