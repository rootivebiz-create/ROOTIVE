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
import type { ReportMonthRow } from "./helpers";

interface ChartRow {
  month: string;
  label: string;
  bill: number;
  profit: number;
  expenseTotal: number;
  operatingProfit: number;
  operatingMargin: number;
  hasData: boolean;
}

function ReportTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  const items: [string, string][] = [
    ["売上", yen(row.bill)],
    ["会社利益", yen(row.profit)],
    ["経費", yen(row.expenseTotal)],
    ["営業利益", yen(row.operatingProfit)],
    ["営業利益率", pct(row.operatingMargin)],
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

/** 月次推移（売上・会社利益・経費・営業利益）。棒＝売上と経費、折れ線＝会社利益と営業利益 */
export function ReportChart({ rows }: { rows: ReportMonthRow[] }) {
  const data: ChartRow[] = rows.map((r) => ({
    month: r.month,
    label: `${Number(r.month.slice(5, 7))}月`,
    bill: r.bill,
    profit: r.profit,
    expenseTotal: r.expenseTotal,
    operatingProfit: r.operatingProfit,
    operatingMargin: r.operatingMargin,
    hasData: r.hasData,
  }));
  const hasNegative = data.some((r) => r.operatingProfit < 0 || r.profit < 0);
  const allZero = data.every((r) => r.bill === 0 && r.profit === 0 && r.expenseTotal === 0 && r.operatingProfit === 0);

  return (
    <div className="h-[260px] w-full" role="img" aria-label="月次の売上・会社利益・経費・営業利益の推移グラフ">
      <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 320, height: 260 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" minTickGap={2} />
          <YAxis
            width={44}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => compactYen(v)}
            domain={allZero ? [0, 1] : ["auto", "auto"]}
          />
          {hasNegative && <ReferenceLine y={0} stroke="var(--muted-foreground)" />}
          <Tooltip content={ReportTooltip} cursor={{ fill: "var(--muted)" }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar dataKey="bill" name="売上" fill="var(--chart-1)" fillOpacity={0.55} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expenseTotal" name="経費" fill="var(--chart-4)" fillOpacity={0.55} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line type="monotone" dataKey="profit" name="会社利益" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="operatingProfit" name="営業利益" stroke="var(--chart-5)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
