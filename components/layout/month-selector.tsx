"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMonth } from "@/lib/hooks/use-month";
import { addMonths, compareMonth, currentMonthJST, formatMonthJa, isFutureMonth } from "@/lib/month";
import { fiscalPeriod, fiscalPeriodOfMonth, summarizePeriod, type FiscalSettings } from "@/lib/fiscal";
import { yen, yenCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MonthOption {
  month: string; // YYYY-MM
  status: "open" | "closed";
  bill?: number | null;
  entry_count?: number | null;
}

/** 決算月の既定（会社の設定が渡されないとき）。12 月＝暦年と同じ区切り */
const CALENDAR: FiscalSettings = { fiscalMonth: 12, establishedOn: null };

/**
 * 稼動月の切り替え（ヘッダー）。
 * 前月・翌月の矢印に加え、押すと「期」ごとの 12 か月の表が開く（0030）。
 * 期の前後は上の矢印で移り、月をひと押しで選べる。締めた月・データのある月・今月が一目で分かる
 */
export function MonthSelector({ months, fiscal = CALENDAR }: { months: MonthOption[]; fiscal?: FiscalSettings }) {
  const { month, setMonth } = useMonth();
  const [open, setOpen] = useState(false);
  const info = months.find((m) => m.month === month);
  const closed = info?.status === "closed";
  const future = isFutureMonth(month);
  const current = fiscalPeriodOfMonth(month, fiscal);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="前月" onClick={() => setMonth(addMonths(month, -1))}>
        <ChevronLeft />
      </Button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center justify-center gap-1.5 truncate rounded-md px-2 py-1.5 text-base font-semibold hover:bg-muted sm:min-w-[7.5rem]"
        aria-label="稼動月を選択"
      >
        {closed && <Lock className="h-4 w-4 text-muted-foreground" aria-label="締め済み" />}
        <span className="num">{formatMonthJa(month)}</span>
        <span className="hidden text-xs font-normal text-muted-foreground lg:inline">{current.label}</span>
        {closed && <Badge variant="secondary">締め済み</Badge>}
        {future && !closed && <Badge variant="outline">予定</Badge>}
      </button>
      <Button variant="ghost" size="icon" aria-label="翌月" onClick={() => setMonth(addMonths(month, 1))}>
        <ChevronRight />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {/* 開くたびに、いま見ている月の期から始める */}
          {open && (
            <MonthPicker
              month={month}
              months={months}
              fiscal={fiscal}
              onSelect={(m) => {
                setMonth(m);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonthPicker({ month, months, fiscal, onSelect }: { month: string; months: MonthOption[]; fiscal: FiscalSettings; onSelect: (m: string) => void }) {
  const now = currentMonthJST();
  const [endYear, setEndYear] = useState(() => fiscalPeriodOfMonth(month, fiscal).endYear);
  const period = useMemo(() => fiscalPeriod(endYear, fiscal), [endYear, fiscal]);
  const byMonth = useMemo(() => new Map(months.map((m) => [m.month, m])), [months]);
  const summary = summarizePeriod(period, months);
  const nowPeriod = fiscalPeriodOfMonth(now, fiscal);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" /> 月を選ぶ
        </DialogTitle>
        <DialogDescription>期（事業年度）ごとに 12 か月を並べています。上の矢印で前の期・次の期へ移れます。</DialogDescription>
      </DialogHeader>

      {/* 期の切り替え */}
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-1">
        <Button variant="ghost" size="icon" aria-label="前の期" onClick={() => setEndYear((y) => y - 1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-0 text-center" aria-live="polite">
          <p className="font-semibold" data-testid="period-label">
            {period.label}
            {period.endYear === nowPeriod.endYear && <span className="ml-1.5 text-xs font-normal text-primary">今期</span>}
          </p>
          <p className="text-xs text-muted-foreground">{period.rangeLabel}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="次の期" onClick={() => setEndYear((y) => y + 1)}>
          <ChevronRight />
        </Button>
      </div>

      {/* 12 か月の表 */}
      <div role="grid" aria-label={`${period.label}の月`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {period.months.map((m, i) => {
          const info = byMonth.get(m);
          const selected = m === month;
          const isNow = m === now;
          const isClosed = info?.status === "closed";
          const hasData = Number(info?.entry_count ?? 0) > 0;
          const future = compareMonth(m, now) > 0;
          // 年が変わるところ（と最初の月）には年を出す
          const showYear = i === 0 || m.endsWith("-01");
          return (
            <button
              key={m}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={`${formatMonthJa(m)}${isClosed ? "（締め済み）" : ""}${isNow ? "（今月）" : ""}`}
              onClick={() => onSelect(m)}
              data-month={m}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 text-center transition-colors",
                selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                !selected && isNow && "border-primary ring-1 ring-primary",
                !selected && future && !hasData && "text-muted-foreground",
              )}
            >
              <span className={cn("h-3.5 text-[10px] leading-none", selected ? "opacity-90" : "text-muted-foreground")}>{showYear ? `${m.slice(0, 4)}年` : ""}</span>
              <span className="flex items-center gap-1 text-base font-semibold leading-none">
                {isClosed && <Lock className="h-3 w-3" aria-hidden="true" />}
                {Number(m.slice(5, 7))}月
              </span>
              <span className={cn("num h-3.5 text-[10px] leading-none", selected ? "opacity-90" : "text-muted-foreground")}>
                {hasData ? yenCompact(info?.bill ?? 0) : isNow ? "今月" : future ? "予定" : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* この期のまとめ */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          この期の売上（税抜）<span className="num ml-1 font-medium text-foreground">{yen(summary.bill)}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          締め済み {summary.closed}／{summary.total} か月
        </span>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {period.endYear !== nowPeriod.endYear && (
          <Button variant="outline" onClick={() => setEndYear(nowPeriod.endYear)}>
            今期へ
          </Button>
        )}
        <Button onClick={() => onSelect(now)}>今月を開く</Button>
      </div>
    </>
  );
}
