"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { DAY_ENTRY_STATUS_LABELS, ENTRY_SOURCE_LABELS, type DayEntryStatus, type WorkDayEntryRow } from "@/lib/db/types";
import { approveDayEntriesAction } from "@/lib/actions/daily";
import { formatWorkDate, pendingIds } from "@/lib/daily/helpers";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<DayEntryStatus, BadgeProps["variant"]> = {
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
};

export interface EntryListProps {
  entries: WorkDayEntryRow[];
  /** admin＋未締め月のときだけ承認・差戻しができる */
  editable: boolean;
}

/** 日別の稼働報告の一覧（承認・差戻し） */
export function EntryList({ entries, editable }: EntryListProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [rejectIds, setRejectIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const pendingList = useMemo(() => pendingIds(entries), [entries]);
  const selectedPending = selected.filter((id) => pendingList.includes(id));
  const allSelected = pendingList.length > 0 && selectedPending.length === pendingList.length;

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () => setSelected(allSelected ? [] : pendingList);

  const run = (ids: string[], approve: boolean, why = "") => {
    if (ids.length === 0) {
      toast.error("対象を選択してください。");
      return;
    }
    startTransition(async () => {
      const res = await approveDayEntriesAction(ids, approve, why);
      if (res.ok) {
        toast.success(res.message ?? "更新しました");
        setSelected([]);
        setRejectIds([]);
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const openReject = (ids: string[]) => {
    if (ids.length === 0) {
      toast.error("対象を選択してください。");
      return;
    }
    setReason("");
    setRejectIds(ids);
  };

  if (entries.length === 0) {
    return <Empty title="この月の稼働報告はまだありません" description="ドライバーが「今日の報告」を送ると、ここに表示されます。" />;
  }

  return (
    <div className="space-y-3">
      {editable && pendingList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="承認待ちをすべて選択" />
            承認待ちをすべて選択（{pendingList.length} 件）
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run(selectedPending, true)} disabled={pending || selectedPending.length === 0}>
              <Check />
              選択した {selectedPending.length} 件を承認
            </Button>
            <Button size="sm" variant="outline" onClick={() => openReject(selectedPending)} disabled={pending || selectedPending.length === 0}>
              <Undo2 />
              差戻し
            </Button>
          </div>
        </div>
      )}

      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {editable && <TableHead className="w-8" />}
              <TableHead>日付</TableHead>
              <TableHead>ドライバー</TableHead>
              <TableHead>案件 / 内容</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead>入力元</TableHead>
              <TableHead>状態</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => {
              const id = e.id ?? "";
              const status = e.status ?? "submitted";
              return (
                <TableRow key={id || `${e.work_date}-${e.driver_id}-${e.project_item_id}`}>
                  {editable && (
                    <TableCell>
                      {status === "submitted" && (
                        <Checkbox checked={selected.includes(id)} onCheckedChange={() => toggle(id)} aria-label={`${e.driver_name} の報告を選択`} />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">{formatWorkDate(e.work_date ?? "")}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.driver_name || "—"}</TableCell>
                  <TableCell className="min-w-40">
                    <span className="block truncate">{e.project_name || "—"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{e.item_name || ""}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Qty value={e.qty} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{e.source ? ENTRY_SOURCE_LABELS[e.source] : ""}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[status]}>{DAY_ENTRY_STATUS_LABELS[status]}</Badge>
                    {status === "rejected" && e.reject_reason && <p className="mt-1 max-w-48 break-words text-xs text-muted-foreground">{e.reject_reason}</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable && status === "submitted" && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => run([id], true)} disabled={pending}>
                          承認
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openReject([id])} disabled={pending}>
                          差戻し
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {entries.map((e) => {
          const id = e.id ?? "";
          const status = e.status ?? "submitted";
          return (
            <li key={id || `${e.work_date}-${e.driver_id}-${e.project_item_id}`}>
              <Card className={cn(status === "rejected" && "border-destructive/40")}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {formatWorkDate(e.work_date ?? "")} <span className="ml-1">{e.driver_name || "—"}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.project_name || "—"} ／ {e.item_name || ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Qty value={e.qty} className="text-lg font-semibold" />
                      <p className="text-[11px] text-muted-foreground">{e.source ? ENTRY_SOURCE_LABELS[e.source] : ""}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_BADGE[status]}>{DAY_ENTRY_STATUS_LABELS[status]}</Badge>
                    {status === "rejected" && e.reject_reason && <span className="break-words text-xs text-muted-foreground">{e.reject_reason}</span>}
                  </div>
                  {editable && status === "submitted" && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => run([id], true)} disabled={pending}>
                        <Check />
                        承認
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openReject([id])} disabled={pending}>
                        <Undo2 />
                        差戻し
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {/* 差戻しの理由 */}
      <Dialog open={rejectIds.length > 0} onOpenChange={(v) => !v && setRejectIds([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>差戻しの理由</DialogTitle>
            <DialogDescription>{rejectIds.length} 件を差し戻します。理由はドライバーの画面に表示されます。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">理由</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              rows={3}
              maxLength={500}
              placeholder="例：件数が伝票と合いません。確認して再送してください。"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectIds([])} disabled={pending}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" onClick={() => run(rejectIds, false, reason)} disabled={pending || reason.trim() === ""}>
              {pending ? "処理中…" : "差し戻す"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
