"use client";

import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps, type TooltipContentProps } from "recharts";
import { formatMonthJa } from "@/lib/month";
import { yen, pct } from "@/lib/format";
import type { TrendPoint } from "@/lib/db/queries-dashboard";

type TrendRow = TrendPoint & { label: string };

/** Y 軸の目盛り：万円単位の短い表記 */
export function compactYen(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000)}万`;
  return `${sign}${Math.round(abs)}`;
}

function ProfitBar(props: BarShapeProps & { active?: boolean }) {
  const { x, y, width, height, active } = props;
  const row = props.payload as TrendRow | undefined;
  const profit = row?.profit ?? 0;
  const negative = profit < 0;
  const fill = negative ? "var(--destructive)" : "var(--chart-1)";
  const emphasized = Boolean(row?.isCurrent) || Boolean(active);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || height === 0) return null;
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      fillOpacity={emphasized ? 1 : 0.45}
      stroke={active ? "var(--foreground)" : "none"}
      strokeWidth={active ? 1 : 0}
      radius={negative ? [0, 0, 4, 4] : [4, 4, 0, 0]}
    />
  );
}

function TrendTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as TrendRow | undefined;
  if (!row) return null;
  const rows: [string, string][] = [
    ["会社売上", yen(row.bill)],
    ["会社利益", yen(row.profit)],
    ["支払合計", yen(row.payout)],
    ["利益率", pct(row.profitRate)],
  ];
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="mb-1 font-semibold">
        {formatMonthJa(row.month)}
        {row.isCurrent && <span className="ml-1 font-normal text-muted-foreground">（表示中）</span>}
        {!row.hasData && <span className="ml-1 font-normal text-muted-foreground">（データなし）</span>}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`num font-semibold ${v.startsWith("-") ? "neg" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 利益の推移（直近 12 か月）。当月を強調、マイナスは赤、ホバーで内訳 */
export function ProfitTrendChart({ data }: { data: TrendPoint[] }) {
  const rows: TrendRow[] = data.map((d) => ({ ...d, label: `${Number(d.month.slice(5, 7))}月` }));
  const hasNegative = rows.some((r) => r.profit < 0);
  const allZero = rows.every((r) => r.profit === 0);
  return (
    <div className="h-[220px] w-full" role="img" aria-label="直近 12 か月の会社利益の棒グラフ">
      <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 320, height: 220 }}>
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
          <YAxis
            width={44}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => compactYen(v)}
            domain={allZero ? [0, 1] : ["auto", "auto"]}
          />
          {hasNegative && <ReferenceLine y={0} stroke="var(--muted-foreground)" />}
          <Tooltip content={TrendTooltip} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="profit" name="会社利益" maxBarSize={24} shape={ProfitBar} activeBar={(p: BarShapeProps) => <ProfitBar {...p} active />} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
