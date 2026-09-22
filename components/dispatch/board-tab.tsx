"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, Copy, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CellDialog } from "./cell-dialog";
import { autoAssign, shortDateJa, type BoardItemDay, type DispatchBoard, type DispatchDriver, type DispatchItem, type OffReason } from "@/lib/dispatch/board";
import { confirmDispatchAction, copyDispatchWeekAction, setDispatchAction } from "@/lib/actions/dispatch";
import { addDays } from "@/lib/daily/helpers";
import { cn } from "@/lib/utils";

export interface BoardTabProps {
  board: DispatchBoard;
  items: DispatchItem[];
  drivers: DispatchDriver[];
  weekStart: string;
  editable: boolean;
  recentQty: Record<string, number>;
  today: string;
}

/**
 * 予定の数量の目安（その人のその案件の直近の平均 → 案件の平均 → 1）。
 * 実績がまだ無いときは 1 にして、ダイアログで直してもらう。
 */
function makeSuggestQty(recentQty: Record<string, number>) {
  return (itemId: string, driverId: string): number => {
    const mine = recentQty[`${driverId}|${itemId}`];
    if (mine && mine > 0) return mine;
    const avg = recentQty[itemId];
    if (avg && avg > 0) return avg;
    return 1;
  };
}

export function BoardTab({ board, items, drivers, weekStart, editable, recentQty, today }: BoardTabProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cell, setCell] = useState<{ item: DispatchItem; day: BoardItemDay } | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);

  const suggestQty = useMemo(() => makeSuggestQty(recentQty), [recentQty]);

  /** その日のドライバーの状態（休み・ほかの案件） */
  const driverStateFor = (date: string): Record<string, { off: OffReason; otherLabels: string[] }> => {
    const out: Record<string, { off: OffReason; otherLabels: string[] }> = {};
    for (const row of board.drivers) {
      const day = row.days.find((d) => d.date === date);
      out[row.driver.id] = { off: day?.off ?? "none", otherLabels: (day?.items ?? []).map((i) => i.label) };
    }
    return out;
  };

  const proposals = useMemo(() => autoAssign(board, { qtyFor: suggestQty }), [board, suggestQty]);

  const runCopy = () => {
    startTransition(async () => {
      const res = await copyDispatchWeekAction(addDays(weekStart, -7), weekStart);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "写しました");
      router.refresh();
    });
  };

  const runAuto = () => {
    startTransition(async () => {
      const rows = proposals.proposals.map((p) => ({
        on_date: p.onDate,
        driver_id: p.driverId,
        project_item_id: p.projectItemId,
        qty_plan: p.qtyPlan,
      }));
      if (rows.length === 0) {
        toast.info("埋めるところがありません");
        setAutoOpen(false);
        return;
      }
      const res = await setDispatchAction(rows);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      setAutoOpen(false);
      router.refresh();
    });
  };

  const runConfirm = () => {
    startTransition(async () => {
      const res = await confirmDispatchAction(weekStart, addDays(weekStart, 6));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "確定しました");
      router.refresh();
    });
  };

  if (items.length === 0) {
    return <Empty title="案件がありません" description="設定 → 案件・単価 で案件を登録すると、配車を組めるようになります。" />;
  }

  return (
    <div className="space-y-3">
      {/* まとめ */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={board.totals.shortage > 0 ? "destructive" : "success"}>
          {board.totals.shortage > 0 ? `この週は ${board.totals.shortage} 人足りません` : "この週は足りています"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          必要 {board.totals.need} / 割り当て {board.totals.assigned}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">
          予定の売上 <Money value={board.totals.planBill} /> ／ 粗利 <Money value={board.totals.planMargin} />
        </span>
      </div>

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={runCopy} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Copy />} 前の週から写す
          </Button>
          <Button variant="outline" onClick={() => setAutoOpen(true)} disabled={pending || proposals.proposals.length === 0}>
            <Sparkles /> 自動で埋める{proposals.proposals.length > 0 ? `（${proposals.proposals.length}）` : ""}
          </Button>
          <Button onClick={runConfirm} disabled={pending}>
            <CalendarCheck /> この週を確定
          </Button>
        </div>
      )}

      {/* PC：案件 × 曜日の表 */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">案件</th>
              {board.dates.map((d) => (
                <th key={d} className={cn("p-2 text-center font-medium", d === today && "bg-primary/5")}>
                  {shortDateJa(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.items.map((row) => (
              <tr key={row.item.id} className="border-b last:border-0">
                <th className="sticky left-0 z-10 max-w-[12rem] truncate bg-card p-2 text-left font-normal" title={row.item.label}>
                  {row.item.label}
                </th>
                {row.days.map((day) => (
                  <td key={day.date} className={cn("p-1 align-top", day.date === today && "bg-primary/5")}>
                    <button
                      type="button"
                      disabled={!editable}
                      aria-label={`${shortDateJa(day.date)} ${row.item.label} の配車（${day.assigned}/${day.need}）`}
                      onClick={() => editable && setCell({ item: row.item, day })}
                      className={cn(
                        "min-h-16 w-full rounded-md border p-1.5 text-left transition",
                        editable && "hover:border-primary hover:bg-muted",
                        day.shortage > 0 && "border-destructive/50 bg-destructive/5",
                        day.need === 0 && day.assigned === 0 && "border-dashed opacity-60",
                      )}
                    >
                      <span className="flex items-center justify-between text-xs">
                        <span className={cn(day.shortage > 0 && "font-semibold text-destructive")}>
                          {day.assigned}/{day.need}
                        </span>
                        {day.excess > 0 && <span className="text-warning">＋{day.excess}</span>}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-0.5">
                        {day.drivers.map((d) => (
                          <span
                            key={d.driverId}
                            className={cn(
                              "rounded px-1 py-0.5 text-[11px] leading-tight",
                              d.status === "confirmed" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {d.driverName}
                          </span>
                        ))}
                      </span>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* スマホ：日ごとのカード */}
      <div className="space-y-2 md:hidden">
        {board.dates.map((date) => {
          const rows = board.items
            .map((row) => ({ item: row.item, day: row.days.find((d) => d.date === date)! }))
            .filter((r) => r.day.need > 0 || r.day.assigned > 0);
          return (
            <Card key={date} className={cn("p-3", date === today && "border-primary")}>
              <p className="mb-2 flex items-center gap-2 font-medium">
                {shortDateJa(date)}
                {date === today && <Badge variant="secondary">今日</Badge>}
              </p>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">予定はありません</p>
              ) : (
                <ul className="space-y-1">
                  {rows.map(({ item, day }) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={!editable}
                        aria-label={`${shortDateJa(day.date)} ${item.label} の配車（${day.assigned}/${day.need}）`}
                        onClick={() => editable && setCell({ item, day })}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
                          day.shortage > 0 && "border-destructive/50 bg-destructive/5",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {day.drivers.length > 0 ? day.drivers.map((d) => d.driverName).join("・") : "未定"}
                          </span>
                        </span>
                        <span className={cn("shrink-0 text-sm", day.shortage > 0 && "font-semibold text-destructive")}>
                          {day.assigned}/{day.need}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <CellDialog
        open={cell != null}
        onOpenChange={(open) => !open && setCell(null)}
        item={cell?.item ?? null}
        day={cell?.day ?? null}
        drivers={drivers}
        driverState={cell ? driverStateFor(cell.day.date) : {}}
        suggestQty={suggestQty}
      />

      {/* 自動で埋める：中身を見せてから保存する */}
      <Dialog open={autoOpen} onOpenChange={(open) => !pending && setAutoOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>自動で埋める</DialogTitle>
            <DialogDescription>
              休みの人と定休日を避けて、足りないところに入れます。保存する前にここで確認できます。
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[45vh] space-y-1 overflow-y-auto text-sm">
            {proposals.proposals.map((p, i) => (
              <li key={`${p.onDate}-${p.driverId}-${i}`} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
                <span className="truncate">
                  {shortDateJa(p.onDate)}　{p.label}
                </span>
                <span className="shrink-0 font-medium">{p.driverName}</span>
              </li>
            ))}
          </ul>
          {proposals.unfilled.length > 0 && (
            <p className="text-sm text-destructive">
              人が足りず {proposals.unfilled.reduce((s, u) => s + u.shortage, 0)} 人ぶんは埋められません。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button onClick={runAuto} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} {proposals.proposals.length} 件を入れる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
