"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/ui/empty";
import { shortDateJa, type DispatchDriver } from "@/lib/dispatch/board";
import { decideDayOffAction, setWeeklyOffAction } from "@/lib/actions/dispatch";
import type { DayOffStatus } from "@/lib/db/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const STATUS_LABEL: Record<DayOffStatus, string> = { requested: "返事まち", approved: "承認", rejected: "見送り" };

export interface OffsTabProps {
  offs: { id: string; driverId: string; driverName: string; onDate: string; status: DayOffStatus; reason: string }[];
  drivers: DispatchDriver[];
  editable: boolean;
}

/** 休み希望への返事と、定休日（曜日）の設定 */
export function OffsTab({ offs, drivers, editable }: OffsTabProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weekly, setWeekly] = useState<Record<string, number[]>>(() => Object.fromEntries(drivers.map((d) => [d.id, d.weeklyOff])));
  // 続けて押したときに 1 つ前の状態から作ってしまわないよう、いまの値を ref でも持つ
  const weeklyRef = useRef(weekly);

  const decide = (id: string, approve: boolean) => {
    startTransition(async () => {
      const res = await decideDayOffAction({ id, approve, note: "" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  const toggleWeekly = (driverId: string, weekday: number, on: boolean) => {
    const cur = weeklyRef.current[driverId] ?? [];
    const next = (on ? [...cur, weekday] : cur.filter((w) => w !== weekday)).sort((a, b) => a - b);
    weeklyRef.current = { ...weeklyRef.current, [driverId]: next };
    setWeekly(weeklyRef.current);
    startTransition(async () => {
      const res = await setWeeklyOffAction({ driver_id: driverId, weekdays: next });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  const waiting = offs.filter((o) => o.status === "requested");
  const decided = offs.filter((o) => o.status !== "requested");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-medium">休み希望{waiting.length > 0 && <Badge variant="warning" className="ml-2">{waiting.length} 件</Badge>}</h3>
        {offs.length === 0 ? (
          <Empty title="休み希望はありません" description="ドライバーがポータルから申請すると、ここに出ます。" />
        ) : (
          <ul className="space-y-1">
            {[...waiting, ...decided].map((o) => (
              <li key={o.id} className="flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {shortDateJa(o.onDate)}　{o.driverName}
                  </span>
                  {o.reason && <span className="block truncate text-xs text-muted-foreground">{o.reason}</span>}
                </span>
                {o.status === "requested" ? (
                  editable ? (
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => decide(o.id, true)} disabled={pending}>
                        <Check /> 承認
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide(o.id, false)} disabled={pending}>
                        <X /> 見送り
                      </Button>
                    </span>
                  ) : (
                    <Badge variant="warning">{STATUS_LABEL[o.status]}</Badge>
                  )
                ) : (
                  <Badge variant={o.status === "approved" ? "success" : "secondary"}>{STATUS_LABEL[o.status]}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">定休日</h3>
        <p className="mb-2 text-sm text-muted-foreground">毎週決まった休みです。自動で埋めるときに避けます。</p>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">ドライバー</th>
                {WEEKDAYS.map((w, i) => (
                  <th key={w} className={`p-2 text-center font-medium ${i === 0 ? "text-destructive" : i === 6 ? "text-primary" : ""}`}>
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <th className="sticky left-0 z-10 max-w-[10rem] truncate bg-card p-2 text-left font-normal">{d.name}</th>
                  {WEEKDAYS.map((w, weekday) => (
                    <td key={weekday} className="p-2 text-center">
                      <Checkbox
                        checked={(weekly[d.id] ?? []).includes(weekday)}
                        disabled={!editable}
                        onCheckedChange={(v) => toggleWeekly(d.id, weekday, v === true)}
                        aria-label={`${d.name} の${w}曜日を定休日にする`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
