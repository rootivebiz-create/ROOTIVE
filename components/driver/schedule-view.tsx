"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Qty } from "@/components/ui/money";
import { shortDateJa } from "@/lib/dispatch/board";
import { requestDayOffAction } from "@/lib/actions/dispatch";
import type { DayOffStatus } from "@/lib/db/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<DayOffStatus, string> = { requested: "返事まち", approved: "休み", rejected: "見送り" };

export interface ScheduleDay {
  date: string;
  items: { label: string; qtyPlan: number; unitSuffix: string; confirmed: boolean }[];
  off: { status: DayOffStatus; reason: string } | null;
}

export interface ScheduleViewProps {
  days: ScheduleDay[];
  today: string;
}

/** ドライバー本人の予定と、休みの申請 */
export function ScheduleView({ days, today }: ScheduleViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  const request = () => {
    startTransition(async () => {
      const res = await requestDayOffAction({ on_date: date, reason });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "申請しました");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  };

  const withWork = days.filter((d) => d.items.length > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">これから 2 週間で {withWork} 日</Badge>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => {
            setDate(today);
            setOpen(true);
          }}
        >
          <CalendarOff /> 休みを申請する
        </Button>
      </div>

      {days.length === 0 ? (
        <Empty title="予定はまだありません" description="配車が決まると、ここに出ます。" />
      ) : (
        <ul className="space-y-2">
          {days.map((d) => (
            <li key={d.date}>
              <Card className={cn("flex items-center justify-between gap-3 p-3", d.date === today && "border-primary")}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {shortDateJa(d.date)}
                    {d.date === today && <Badge variant="secondary">今日</Badge>}
                    {d.off && <Badge variant={d.off.status === "approved" ? "success" : d.off.status === "requested" ? "warning" : "secondary"}>{STATUS_LABEL[d.off.status]}</Badge>}
                  </p>
                  {d.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{d.off?.status === "approved" ? "お休みです" : "予定はありません"}</p>
                  ) : (
                    <ul className="text-sm">
                      {d.items.map((it, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="truncate">{it.label}</span>
                          <span className="shrink-0 text-muted-foreground">
                            <Qty value={it.qtyPlan} />
                            {it.unitSuffix}
                          </span>
                          {!it.confirmed && <Badge variant="secondary">仮</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>休みを申請する</DialogTitle>
            <DialogDescription>会社が返事をすると、この画面に出ます。決まるまでは配車が入ることがあります。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="off-date">休みたい日</Label>
              <Input id="off-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="off-reason">理由（任意）</Label>
              <Input id="off-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="通院・私用など" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button onClick={request} disabled={pending || !date}>
              {pending ? <Loader2 className="animate-spin" /> : null} 申請する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
