"use client";

import { Money, Pct } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumMoney } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { trendScale, type DriverTrendPoint } from "./helpers";

/** 売上・会社利益の横棒（幅は 12 か月の最大値を 100% とした割合。マイナスは赤） */
function Bar({ value, scale, tone }: { value: number; scale: number; tone: "bill" | "profit" }) {
  const ratio = scale > 0 ? Math.min(1, Math.abs(value) / scale) : 0;
  return (
    <span className="block h-1.5 w-full rounded-full bg-muted" aria-hidden>
      <span
        className={cn("block h-1.5 rounded-full", value < 0 ? "bg-destructive" : tone === "bill" ? "bg-primary/40" : "bg-primary")}
        style={{ width: `${Math.max(ratio * 100, value === 0 ? 0 : 2)}%` }}
      />
    </span>
  );
}

/** 選んだドライバーの 12 か月の推移（売上・会社利益・利益率）。スマホでも読めるよう表＋横棒で表す */
export function DriverTrend({ driverName, points }: { driverName: string; points: DriverTrendPoint[] }) {
  const scale = trendScale(points);
  const totalBill = sumMoney(points.map((p) => p.bill));
  const totalProfit = sumMoney(points.map((p) => p.profit));

  return (
    <Table>
      <caption className="sr-only">{driverName} の 12 か月の売上・会社利益・利益率の推移</caption>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 bg-card">稼動月</TableHead>
          <TableHead className="text-right">件数</TableHead>
          <TableHead className="min-w-24 text-right">売上</TableHead>
          <TableHead className="min-w-24 text-right">会社利益</TableHead>
          <TableHead className="text-right">利益率</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((p) => (
          <TableRow key={p.month} className={cn(!p.hasData && "text-muted-foreground")}>
            <TableCell className="sticky left-0 whitespace-nowrap bg-card font-medium">{formatMonthJa(p.month)}</TableCell>
            <TableCell className="num">{p.hasData ? p.entryCount : "—"}</TableCell>
            <TableCell className="text-right">
              {p.hasData ? (
                <>
                  <Money value={p.bill} />
                  <Bar value={p.bill} scale={scale} tone="bill" />
                </>
              ) : (
                <span className="num">—</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              {p.hasData ? (
                <>
                  <Money value={p.profit} className="font-semibold" />
                  <Bar value={p.profit} scale={scale} tone="profit" />
                </>
              ) : (
                <span className="num">—</span>
              )}
            </TableCell>
            <TableCell className="text-right">{p.hasData ? <Pct value={p.profitRate} /> : <span className="num">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="sticky left-0 whitespace-nowrap bg-muted/50">合計（12 か月）</TableCell>
          <TableCell className="num">{points.reduce((a, p) => a + p.entryCount, 0)}</TableCell>
          <TableCell className="text-right">
            <Money value={totalBill} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={totalProfit} />
          </TableCell>
          <TableCell className="text-right">
            <Pct value={totalBill !== 0 ? totalProfit / totalBill : 0} />
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
