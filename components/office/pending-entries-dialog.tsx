"use client";

import { useMemo, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveDayEntriesAction } from "@/lib/actions/daily";
import { shortDateJa } from "@/lib/dispatch/board";
import { qty } from "@/lib/format";
import type { DeskPendingEntry } from "@/lib/office/desk";
import { useRun } from "./use-run";

/**
 * 承認待ちの稼働報告を、その場で確かめて承認・差し戻す。
 * 最初は全部に印が付いている（ほとんどはそのまま承認するため）。外したものは残る。
 * 差し戻しは理由が要る（ドライバー本人へ理由ごと知らせる）。
 */
export function PendingEntriesDialog({ entries, total }: { entries: DeskPendingEntry[]; total: number }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useRun();

  // 日 → ドライバー の順にまとめる（届いた順ではなく、確かめやすい順）
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; workDate: string; driverName: string; rows: DeskPendingEntry[] }>();
    for (const e of entries) {
      const key = `${e.workDate}|${e.driverId}`;
      const g = map.get(key) ?? { key, workDate: e.workDate, driverName: e.driverName, rows: [] };
      g.rows.push(e);
      map.set(key, g);
    }
    return [...map.values()];
  }, [entries]);

  const openDialog = () => {
    setSelected(new Set(entries.map((e) => e.id)));
    setRejecting(false);
    setReason("");
    setOpen(true);
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const ids = [...selected];
  const decide = (approve: boolean) =>
    run(() => approveDayEntriesAction(ids, approve, approve ? undefined : reason.trim()), approve ? "承認しました" : "差し戻しました", () => setOpen(false));

  return (
    <>
      <Button size="sm" onClick={openDialog} disabled={entries.length === 0}>
        <Check />
        確かめて承認
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>稼働報告の承認</DialogTitle>
            <DialogDescription>
              印の付いた {ids.length} 件をまとめて承認します。承認すると月の稼働に入り、本人へ知らせます。
              {total > entries.length && `（古い順に ${entries.length} 件を表示。残り ${total - entries.length} 件は承認後に出ます）`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setSelected(new Set(entries.map((e) => e.id)))}>
                全部に印
              </button>
              <button type="button" className="text-primary hover:underline" onClick={() => setSelected(new Set())}>
                全部外す
              </button>
            </div>
            {groups.map((g) => (
              <div key={g.key} className="rounded-md border p-2">
                <p className="text-sm font-medium">
                  {shortDateJa(g.workDate)} {g.driverName}
                </p>
                <ul className="mt-1 space-y-1">
                  {g.rows.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <Checkbox id={`pe-${e.id}`} checked={selected.has(e.id)} onCheckedChange={(v) => toggle(e.id, v === true)} aria-label={`${g.driverName} ${e.projectName} ${e.itemName}`} />
                      <Label htmlFor={`pe-${e.id}`} className="flex min-w-0 flex-1 justify-between gap-2 font-normal">
                        <span className="truncate">
                          {e.projectName}
                          {e.itemName && e.itemName !== "標準" ? `／${e.itemName}` : ""}
                          {e.memo ? <span className="text-muted-foreground">（{e.memo}）</span> : null}
                        </span>
                        <span className="num shrink-0">
                          {qty(e.qty)}
                          {e.unit === "day" ? "日" : "個"}
                        </span>
                      </Label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {rejecting && (
              <div className="space-y-1.5">
                <Label htmlFor="pe-reason">差し戻す理由（本人に届きます）</Label>
                <Textarea id="pe-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="例：数量が配車と違います。確認して出し直してください" />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {rejecting ? (
              <>
                <Button variant="outline" onClick={() => setRejecting(false)} disabled={pending}>
                  やめる
                </Button>
                <Button variant="destructive" onClick={() => decide(false)} disabled={pending || ids.length === 0 || reason.trim() === ""} aria-busy={pending}>
                  <Undo2 />
                  {ids.length} 件を差し戻す
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={pending || ids.length === 0}>
                  <Undo2 />
                  差し戻す…
                </Button>
                <Button onClick={() => decide(true)} disabled={pending || ids.length === 0} aria-busy={pending}>
                  <Check />
                  {ids.length} 件を承認
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
