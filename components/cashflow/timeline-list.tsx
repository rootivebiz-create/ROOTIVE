"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMonthDayJa, isWeekend, weekdayJa, type CashDay, type CashRow } from "./helpers";

type Variant = BadgeProps["variant"];

/** 種別のバッジ（入金・ドライバー支払・経費） */
const KIND_VARIANT: Record<string, Variant> = { invoice: "success", payout: "secondary", expense: "outline" };
/** 状態のバッジ（予定・確定・実績） */
const STATUS_VARIANT: Record<string, Variant> = { planned: "outline", confirmed: "default", done: "secondary" };

function KindBadge({ row }: { row: CashRow }) {
  return <Badge variant={KIND_VARIANT[row.kind] ?? "outline"}>{row.kindLabel}</Badge>;
}

function StatusBadge({ row }: { row: CashRow }) {
  return <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{row.statusLabel}</Badge>;
}

function DayLabel({ date }: { date: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="num font-medium">{formatMonthDayJa(date)}</span>
      <span className={cn("ml-1 text-xs", isWeekend(date) ? "text-destructive" : "text-muted-foreground")}>（{weekdayJa(date)}）</span>
    </span>
  );
}

export interface TimelineListProps {
  timeline: CashDay[];
  /** 日本時間の今日（これより前は薄く表示する） */
  today: string;
}

/** 予定の一覧：PC は表、スマホは日付ごとのカード */
export function TimelineList({ timeline, today }: TimelineListProps) {
  return (
    <>
      {/* PC：表 */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日付</TableHead>
              <TableHead>種別</TableHead>
              <TableHead>相手先</TableHead>
              <TableHead>内容</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">残高</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeline.map((day) => {
              const past = day.date < today;
              return day.events.map((e, i) => (
                <TableRow key={e.key} className={cn(past && "opacity-60", day.balance < 0 && "bg-destructive/5")}>
                  <TableCell className={cn(i > 0 && "text-transparent")}>{i === 0 ? <DayLabel date={day.date} /> : null}</TableCell>
                  <TableCell>
                    <KindBadge row={e} />
                  </TableCell>
                  <TableCell className="font-medium">{e.label || "—"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate text-muted-foreground" title={e.detail}>
                    {e.detail || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={e.amount} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge row={e} />
                  </TableCell>
                  <TableCell className="text-right">
                    {i === day.events.length - 1 ? <Money value={day.balance} className={cn(day.balance < 0 && "font-semibold")} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </Card>

      {/* スマホ：日付ごとのカード */}
      <div className="flex flex-col gap-2 md:hidden">
        {timeline.map((day) => {
          const past = day.date < today;
          return (
            <Card key={day.date} className={cn("p-3", past && "opacity-60", day.balance < 0 && "border-destructive/40 bg-destructive/5")}>
              <div className="flex items-baseline justify-between gap-2 border-b pb-2">
                <DayLabel date={day.date} />
                <span className="text-right">
                  <span className="mr-1 text-xs text-muted-foreground">残高</span>
                  <Money value={day.balance} className={cn("font-semibold", day.balance < 0 && "font-bold")} />
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {day.events.map((e) => (
                  <li key={e.key} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {e.amount >= 0 ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-success" /> : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="font-medium">{e.label || "—"}</span>
                        <KindBadge row={e} />
                        <StatusBadge row={e} />
                      </span>
                      {e.detail && <span className="mt-0.5 block break-words text-xs text-muted-foreground">{e.detail}</span>}
                    </span>
                    <span className="shrink-0 font-semibold">
                      <Money value={e.amount} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
