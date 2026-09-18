"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { compactYen } from "@/components/dashboard/profit-trend-chart";
import { yen } from "@/lib/format";
import { formatDateJa } from "@/lib/month";
import { gradientOffset, shortDate, weekdayJa, type CashDailyPoint } from "./helpers";

type ChartPoint = CashDailyPoint;

function BalanceTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartPoint | undefined;
  if (!row) return null;
  const items: [string, string][] = [["残高", yen(row.balance)]];
  if (row.inflow !== 0) items.push(["入金", yen(row.inflow)]);
  if (row.outflow !== 0) items.push(["支払", yen(-row.outflow)]);
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="mb-1 font-semibold">
        {formatDateJa(row.date)}（{weekdayJa(row.date)}）
        {!row.hasEvents && <span className="ml-1 font-normal text-muted-foreground">予定なし</span>}
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

/**
 * 残高の推移（日次）。マイナスの区間は赤で描く（0 円の位置でグラデーションを切り替える）。
 * 予定の無い日は前日の残高をそのまま引き継いだ点（fillDailyBalances）。
 */
export function BalanceChart({ points, today }: { points: CashDailyPoint[]; today: string }) {
  const data: ChartPoint[] = points;
  const balances = data.map((p) => p.balance);
  const offset = gradientOffset(balances);
  const hasNegative = balances.some((b) => b < 0);
  const allZero = balances.every((b) => b === 0);
  const showToday = data.some((p) => p.date === today);

  return (
    <div className="h-[240px] w-full" role="img" aria-label="日ごとの残高の推移グラフ">
      <ResponsiveContainer width="100%" height={240} initialDimension={{ width: 320, height: 240 }}>
        <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cash-balance-stroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={offset} stopColor="var(--chart-1)" />
              <stop offset={offset} stopColor="var(--destructive)" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => shortDate(v)}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            width={44}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => compactYen(v)}
            domain={allZero ? [0, 1] : ["auto", "auto"]}
          />
          {hasNegative && <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="3 3" />}
          {showToday && <ReferenceLine x={today} stroke="var(--muted-foreground)" strokeDasharray="2 4" label={{ value: "今日", position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }} />}
          <Tooltip content={BalanceTooltip} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey="balance"
            name="残高"
            stroke="url(#cash-balance-stroke)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "var(--chart-1)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
