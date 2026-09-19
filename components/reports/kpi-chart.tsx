"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { compactYen } from "@/components/dashboard/profit-trend-chart";
import { formatMonthJa } from "@/lib/month";
import { pct, yen } from "@/lib/format";
import type { KpiTrendRow } from "@/lib/kpi/trend";

interface ChartRow {
  month: string;
  label: string;
  bill: number;
  breakEvenBill: number;
  /** % 表示（右軸）。計算できない月は null で線を切る */
  contributionRate: number | null;
  operatingMargin: number | null;
  breakEvenRatio: number | null;
  operatingProfit: number;
  hasData: boolean;
}

function KpiTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  const items: [string, string][] = [
    ["売上", yen(row.bill)],
    ["損益分岐点売上高", row.hasData ? yen(row.breakEvenBill) : "—"],
    ["限界利益率", row.contributionRate == null ? "—" : pct(row.contributionRate / 100)],
    ["営業利益率", row.operatingMargin == null ? "—" : pct(row.operatingMargin / 100)],
    ["損益分岐点比率", row.breakEvenRatio == null ? "—" : pct(row.breakEvenRatio / 100)],
    ["営業利益", yen(row.operatingProfit)],
  ];
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="mb-1 font-semibold">
        {formatMonthJa(row.month)}
        {!row.hasData && <span className="ml-1 font-normal text-muted-foreground">（データなし）</span>}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`num font-semibold ${v.startsWith("-") ? "neg" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 率は右軸に % の数値（0.152 → 15.2）で載せる */
function toPercentPoint(v: number | null, hasData: boolean): number | null {
  if (!hasData || v == null) return null;
  return Math.round(v * 1000) / 10;
}

/**
 * 経営指標の推移：棒＝売上、折れ線＝限界利益率・営業利益率・損益分岐点比率（右軸 %）
 * 損益分岐点比率の 100% に補助線を引き、これを超えた月が赤字だと分かるようにする。
 */
export function KpiTrendChart({ rows }: { rows: KpiTrendRow[] }) {
  const data: ChartRow[] = rows.map((r) => ({
    month: r.month,
    label: r.label,
    bill: r.bill,
    breakEvenBill: r.breakEvenBill,
    contributionRate: toPercentPoint(r.contributionRate, r.hasData && r.bill > 0),
    operatingMargin: toPercentPoint(r.operatingMargin, r.hasData && r.bill > 0),
    breakEvenRatio: toPercentPoint(r.breakEvenRatio, r.hasData),
    operatingProfit: r.operatingProfit,
    hasData: r.hasData,
  }));
  const allZero = data.every((r) => r.bill === 0);

  return (
    <div className="h-[280px] w-full" role="img" aria-label="売上・限界利益率・営業利益率・損益分岐点比率の推移グラフ">
      <ResponsiveContainer width="100%" height={280} initialDimension={{ width: 320, height: 280 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={2}
          />
          <YAxis
            yAxisId="money"
            width={44}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => compactYen(v)}
            domain={allZero ? [0, 1] : ["auto", "auto"]}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            width={40}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${Math.round(v)}%`}
          />
          <ReferenceLine yAxisId="rate" y={100} stroke="var(--destructive)" strokeDasharray="4 4" />
          <Tooltip content={KpiTooltip} cursor={{ fill: "var(--muted)" }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar yAxisId="money" dataKey="bill" name="売上" fill="var(--chart-1)" fillOpacity={0.45} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="rate" type="monotone" dataKey="contributionRate" name="限界利益率(%)" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
          <Line yAxisId="rate" type="monotone" dataKey="operatingMargin" name="営業利益率(%)" stroke="var(--chart-5)" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
          <Line yAxisId="rate" type="monotone" dataKey="breakEvenRatio" name="損益分岐点比率(%)" stroke="var(--chart-4)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
