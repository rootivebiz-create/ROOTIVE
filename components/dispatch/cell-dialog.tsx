"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { parseNumberInput } from "@/lib/calc";
import { shortDateJa, type BoardItemDay, type DispatchDriver, type DispatchItem, type OffReason } from "@/lib/dispatch/board";
import { setDispatchAction } from "@/lib/actions/dispatch";
import { cn } from "@/lib/utils";

export interface CellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: DispatchItem | null;
  day: BoardItemDay | null;
  drivers: DispatchDriver[];
  /** その日の各ドライバーの状態（休み・他の案件に入っているか） */
  driverState: Record<string, { off: OffReason; otherLabels: string[] }>;
  /** 予定の数量の目安 */
  suggestQty: (itemId: string, driverId: string) => number;
}

const OFF_LABEL: Record<OffReason, string> = { none: "", weekly: "定休日", requested: "休み希望", approved: "休み" };

/** 1 つのマス（日 × 案件内容）に入る人を決めるダイアログ */
export function CellDialog({ open, onOpenChange, item, day, drivers, driverState, suggestQty }: CellDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Record<string, string>>({});

  // 開くたびに、いまの割り当てから作り直す
  useEffect(() => {
    if (!open || !day) return;
    const next: Record<string, string> = {};
    for (const d of day.drivers) next[d.driverId] = String(d.qtyPlan);
    setPicked(next);
  }, [open, day]);

  const initial = useMemo(() => new Set((day?.drivers ?? []).map((d) => d.driverId)), [day]);

  if (!item || !day) return null;

  const toggle = (driverId: string, on: boolean) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[driverId] = String(suggestQty(item.id, driverId));
      else delete next[driverId];
      return next;
    });
  };

  const save = () => {
    const rows = [
      // 選んだ人（数量つき）
      ...Object.entries(picked).map(([driverId, qty]) => ({
        on_date: day.date,
        driver_id: driverId,
        project_item_id: item.id,
        qty_plan: parseNumberInput(qty) ?? 1,
      })),
      // 外した人は数量 0 で送る（DB 側で行が消える）
      ...[...initial]
        .filter((id) => !(id in picked))
        .map((driverId) => ({ on_date: day.date, driver_id: driverId, project_item_id: item.id, qty_plan: 0 })),
    ];
    if (rows.length === 0) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const res = await setDispatchAction(rows);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      onOpenChange(false);
      router.refresh();
    });
  };

  const count = Object.keys(picked).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {shortDateJa(day.date)}　{item.label}
          </DialogTitle>
          <DialogDescription>
            必要 {day.need} 人／いま {count} 人。入る人を選んでください。
            {item.unit === "piece" && "（個数の案件は、予定の個数も入れられます）"}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {drivers.map((d) => {
            const state = driverState[d.id] ?? { off: "none" as OffReason, otherLabels: [] };
            const on = d.id in picked;
            const blocked = state.off === "approved" || state.off === "weekly";
            return (
              <li
                key={d.id}
                className={cn("flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 py-2", blocked && !on && "opacity-60")}
              >
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <Checkbox checked={on} onCheckedChange={(v) => toggle(d.id, v === true)} aria-label={`${d.name} を入れる`} />
                  <span className="truncate">{d.name}</span>
                  {state.off !== "none" && (
                    <Badge variant={state.off === "requested" ? "warning" : "secondary"}>{OFF_LABEL[state.off]}</Badge>
                  )}
                  {state.otherLabels.length > 0 && <Badge variant="secondary">{state.otherLabels.join("・")}</Badge>}
                </label>
                {on && (
                  <NumberInput
                    value={picked[d.id] ?? ""}
                    onChange={(e) => setPicked((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    className="w-20 text-right"
                    aria-label={`${d.name} の予定数量`}
                  />
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            やめる
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} 保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
