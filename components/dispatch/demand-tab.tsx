"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/input";
import { parseNumberInput } from "@/lib/calc";
import { shortDateJa, type DispatchItem } from "@/lib/dispatch/board";
import { setProjectDemandAction, setProjectDemandDayAction } from "@/lib/actions/dispatch";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export interface DemandTabProps {
  items: DispatchItem[];
  /** 曜日ごとの必要人数 */
  patterns: { projectItemId: string; weekday: number; need: number }[];
  /** 特定の日だけの必要人数（これから先） */
  days: { projectItemId: string; onDate: string; need: number; note: string }[];
  editable: boolean;
}

/** 案件内容 × 曜日の必要人数を決めるタブ */
export function DemandTab({ items, patterns, days, editable }: DemandTabProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** 保存し終えた値（画面の再読み込みを待たずに「もう保存した」と分かるようにする） */
  const [saved, setSaved] = useState<Record<string, number>>({});

  const key = (itemId: string, weekday: number) => `${itemId}|${weekday}`;
  const current = (itemId: string, weekday: number): string => {
    const k = key(itemId, weekday);
    if (k in draft) return draft[k];
    const found = patterns.find((p) => p.projectItemId === itemId && p.weekday === weekday);
    return found ? String(found.need) : "";
  };

  const save = (itemId: string, weekday: number, raw: string) => {
    const k = key(itemId, weekday);
    const need = raw.trim() === "" ? 0 : Math.round(parseNumberInput(raw) ?? 0);
    // 直前に保存した値があればそれと比べる（router.refresh() を待つ間に隣のマスへ移っても取りこぼさない）
    const before = k in saved ? saved[k] : (patterns.find((p) => p.projectItemId === itemId && p.weekday === weekday)?.need ?? 0);
    if (need === before) return;
    setSaved((prev) => ({ ...prev, [k]: need }));
    startTransition(async () => {
      const res = await setProjectDemandAction({ project_item_id: itemId, weekday, need });
      if (!res.ok) {
        setSaved((prev) => {
          const next = { ...prev };
          delete next[k];
          return next;
        });
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  const clearDay = (itemId: string, onDate: string) => {
    startTransition(async () => {
      const res = await setProjectDemandDayAction({ project_item_id: itemId, on_date: onDate, need: null, note: "" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("特定日の指定をやめました");
      router.refresh();
    });
  };

  if (items.length === 0) {
    return <Empty title="案件がありません" description="設定 → 案件・単価 で案件を登録してください。" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        「毎週この曜日は何人要るか」を入れておくと、配車表に足りない日が出ます。空欄と 0 は「要らない」です。
      </p>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">案件</th>
              {WEEKDAYS.map((w, i) => (
                <th key={w} className={`p-2 text-center font-medium ${i === 0 ? "text-destructive" : i === 6 ? "text-primary" : ""}`}>
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b last:border-0">
                <th className="sticky left-0 z-10 max-w-[14rem] truncate bg-card p-2 text-left font-normal" title={item.label}>
                  {item.label}
                </th>
                {WEEKDAYS.map((_, weekday) => (
                  <td key={weekday} className="p-1">
                    <NumberInput
                      value={current(item.id, weekday)}
                      disabled={!editable}
                      decimal={false}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [key(item.id, weekday)]: e.target.value }))}
                      onBlur={(e) => save(item.id, weekday, e.target.value)}
                      className="w-14 text-center"
                      aria-label={`${item.label} の${WEEKDAYS[weekday]}曜日の必要人数`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-medium">特定の日だけ変える</h3>
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            ありません。配車表の日をタップして人数を変えると、その日だけの指定になります。
          </p>
        ) : (
          <ul className="space-y-1">
            {days.map((d) => (
              <li key={`${d.projectItemId}-${d.onDate}`} className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {shortDateJa(d.onDate)}　{items.find((i) => i.id === d.projectItemId)?.label ?? ""}　{d.need} 人
                  {d.note && <span className="text-muted-foreground">（{d.note}）</span>}
                </span>
                {editable && (
                  <Button variant="ghost" size="icon" onClick={() => clearDay(d.projectItemId, d.onDate)} disabled={pending} aria-label="この指定をやめる">
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
