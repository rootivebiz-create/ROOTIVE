"use client";

import { useState } from "react";
import { CalendarCheck, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { decideDayOffAction } from "@/lib/actions/dispatch";
import { shortDateJa } from "@/lib/dispatch/board";
import type { DeskDayOff } from "@/lib/office/desk";
import { useRun } from "./use-run";

/** 休み希望に、その場で返事をする（1 件ずつ。返事は本人の予定画面に出る） */
export function DayOffsDialog({ dayOffs }: { dayOffs: DeskDayOff[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const decide = (id: string, approve: boolean) => run(() => decideDayOffAction({ id, approve, note: "" }), approve ? "休みを承認しました" : "休みを見送りました");

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={dayOffs.length === 0}>
        <CalendarCheck />
        返事をする
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>休み希望</DialogTitle>
            <DialogDescription>承認すると、その日の配車の自動割り当てから外れます。</DialogDescription>
          </DialogHeader>
          {dayOffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">返事待ちの休み希望はありません。</p>
          ) : (
            <ul className="divide-y">
              {dayOffs.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {shortDateJa(o.onDate)} {o.driverName}
                    </p>
                    {o.reason && <p className="text-xs text-muted-foreground">{o.reason}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => decide(o.id, false)} disabled={pending} aria-label={`${o.driverName}の休みを見送る`}>
                      <X />
                      見送る
                    </Button>
                    <Button size="sm" onClick={() => decide(o.id, true)} disabled={pending} aria-label={`${o.driverName}の休みを承認`}>
                      <Check />
                      承認
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
