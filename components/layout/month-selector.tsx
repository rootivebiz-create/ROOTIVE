"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMonth } from "@/lib/hooks/use-month";
import { addMonths, currentMonthJST, formatMonthJa, isFutureMonth } from "@/lib/month";
import { yen } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MonthOption {
  month: string; // YYYY-MM
  status: "open" | "closed";
  bill?: number | null;
  entry_count?: number | null;
}

export function MonthSelector({ months }: { months: MonthOption[] }) {
  const { month, setMonth } = useMonth();
  const [open, setOpen] = useState(false);
  const info = months.find((m) => m.month === month);
  const closed = info?.status === "closed";
  const future = isFutureMonth(month);
  const now = currentMonthJST();

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
        {closed && <Badge variant="secondary">締め済み</Badge>}
        {future && !closed && <Badge variant="outline">予定</Badge>}
      </button>
      <Button variant="ghost" size="icon" aria-label="翌月" onClick={() => setMonth(addMonths(month, 1))}>
        <ChevronRight />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" /> 稼動月を選択
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <input
              type="month"
              className="h-11 flex-1 rounded-md border border-input bg-card px-3"
              defaultValue={month}
              onChange={(e) => {
                if (/^\d{4}-\d{2}$/.test(e.target.value)) {
                  setMonth(e.target.value);
                  setOpen(false);
                }
              }}
              aria-label="稼動月"
            />
            <Button
              variant="outline"
              onClick={() => {
                setMonth(now);
                setOpen(false);
              }}
            >
              今月
            </Button>
          </div>
          <div className="max-h-[50dvh] overflow-y-auto rounded-md border">
            {months.length === 0 && <p className="p-4 text-sm text-muted-foreground">まだデータがある月はありません。</p>}
            <ul className="divide-y">
              {months.map((m) => (
                <li key={m.month}>
                  <button
                    type="button"
                    onClick={() => {
                      setMonth(m.month);
                      setOpen(false);
                    }}
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted", m.month === month && "bg-accent")}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {m.status === "closed" ? <Lock className="h-4 w-4 text-muted-foreground" /> : <span className="inline-block h-4 w-4" />}
                      {formatMonthJa(m.month)}
                    </span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {m.entry_count != null && <span>{m.entry_count} 件</span>}
                      {m.bill != null && <span className="num">{yen(m.bill)}</span>}
                      <Badge variant={m.status === "closed" ? "secondary" : "outline"}>{m.status === "closed" ? "締め済み" : "未締め"}</Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
