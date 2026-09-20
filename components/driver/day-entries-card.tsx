"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudOff, Send, Truck } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { NumberInput } from "@/components/ui/input";
import { DAY_ENTRY_STATUS_LABELS, type DayEntryStatus, type DriverDayItem, type WorkDayEntryRow } from "@/lib/db/types";
import { submitWithOfflineFallback } from "@/lib/offline/sync";
import type { DayEntryRowInput } from "@/lib/schemas/daily";

const STATUS_BADGE: Record<DayEntryStatus, BadgeProps["variant"]> = {
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
};

export interface DayEntriesCardProps {
  date: string;
  /** 選べる案件内容（RPC driver_day_items。直近に使ったものが先） */
  items: DriverDayItem[];
  /** その日の報告済みの行 */
  entries: WorkDayEntryRow[];
  editable: boolean;
}

interface ItemRow {
  id: string;
  projectName: string;
  itemName: string;
  recent: boolean;
  entry: WorkDayEntryRow | null;
}

/** ② 今日の稼働（案件内容ごとの数量を送る） */
export function DayEntriesCard({ date, items, entries, editable }: DayEntriesCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const rows: ItemRow[] = useMemo(() => {
    const byItem = new Map<string, WorkDayEntryRow>();
    for (const e of entries) if (e.project_item_id) byItem.set(e.project_item_id, e);
    const base: ItemRow[] = items.map((i) => ({
      id: i.project_item_id,
      projectName: i.project_name,
      itemName: i.item_name,
      recent: i.recent,
      entry: byItem.get(i.project_item_id) ?? null,
    }));
    const known = new Set(items.map((i) => i.project_item_id));
    // 選択肢に無い内容（停止した案件・スタッフが代理入力したもの）も表示する
    const extra: ItemRow[] = entries
      .filter((e) => e.project_item_id && !known.has(e.project_item_id))
      .map((e) => ({ id: e.project_item_id as string, projectName: e.project_name ?? "", itemName: e.item_name ?? "", recent: true, entry: e }));
    return [...base, ...extra];
  }, [items, entries]);

  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const e of entries) if (e.project_item_id) init[e.project_item_id] = String(e.qty ?? 0);
    return init;
  });

  /** 電波が無くて端末に保存した（電波が戻ると自動で送る） */
  const [queued, setQueued] = useState(false);

  const openRows = rows.filter((r) => r.entry?.status !== "approved");
  const canSubmit = editable && openRows.length > 0;

  const submit = () => {
    const payload: DayEntryRowInput[] = openRows.map((r) => ({ project_item_id: r.id, qty: (qtys[r.id] ?? "").trim() === "" ? 0 : qtys[r.id] }));
    if (payload.length === 0) {
      toast.error("送信できる案件内容がありません。");
      return;
    }
    startTransition(async () => {
      // 電波が弱いときは端末に保存して、戻ったら自動で送る
      const out = await submitWithOfflineFallback({ kind: "day_entries", payload: { work_date: date, rows: payload } });
      if (out.status === "sent") {
        setQueued(false);
        toast.success(out.message);
        router.refresh();
      } else if (out.status === "queued") {
        setQueued(true);
        toast.success(out.message);
      } else {
        toast.error(out.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-4 w-4" /> ② 今日の稼働
        </CardTitle>
        <CardDescription>
          {queued ? (
            <span className="flex items-center gap-1 text-warning">
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
              端末に保存しました（未送信）。電波が戻ると自動で送信します。
            </span>
          ) : (
            "案件内容ごとに数量を入れて送信してください。0 のままの内容は送られません。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <Empty title="選べる案件内容がありません" description="担当する案件が登録されていない可能性があります。担当者にご連絡ください。" />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const status = r.entry?.status ?? null;
              const locked = !editable || status === "approved";
              return (
                <li key={r.id} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.itemName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.projectName}</p>
                    {status && (
                      <span className="mt-1 inline-flex flex-wrap items-center gap-1">
                        <Badge variant={STATUS_BADGE[status]}>{DAY_ENTRY_STATUS_LABELS[status]}</Badge>
                        {status === "rejected" && r.entry?.reject_reason && (
                          <span className="break-words text-xs text-destructive">{r.entry.reject_reason}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <NumberInput
                    aria-label={`${r.projectName} ${r.itemName} の数量`}
                    className="w-24 shrink-0 text-right"
                    value={qtys[r.id] ?? ""}
                    onChange={(e) => setQtys((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="0"
                    disabled={locked || pending}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {canSubmit && (
          <Button size="lg" className="w-full" onClick={submit} disabled={pending} aria-busy={pending}>
            <Send />
            {pending ? "送信中…" : "送信"}
          </Button>
        )}
        {editable && openRows.length === 0 && rows.length > 0 && <p className="text-sm text-muted-foreground">すべて承認済みです。変更が必要なときは担当者にご連絡ください。</p>}
      </CardContent>
    </Card>
  );
}
