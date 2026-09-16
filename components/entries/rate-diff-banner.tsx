"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RateDiff } from "@/lib/db/types";
import { formatMonthJa } from "@/lib/month";
import { applyMasterRatesAction } from "@/lib/actions/rates";
import { describeRateDiff, rateDiffLabel } from "./helpers";

export interface RateDiffBannerProps {
  month: string;
  /** その月の稼働行のうち、単価・率・端数処理が現在のマスタと異なる行（締め済み月は空） */
  diffs: RateDiff[];
  /** 更新ボタンを出す（owner/admin かつ未締め） */
  editable: boolean;
}

/**
 * 「現在のマスタと異なる稼働行」の警告バナー。編集可能なら選んだ行をまとめてマスタの値に更新できる
 * （applyMasterRatesAction → DB の apply_master_rates。締め済み月は DB が拒否する）
 */
export function RateDiffBanner({ month, diffs, editable }: RateDiffBannerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  if (diffs.length === 0) return null;

  const openDialog = () => {
    // 既定はすべて選択（意図して手入力した行は利用者が外す）
    setSelected(new Set(diffs.map((d) => d.entry_id)));
    setOpen(true);
  };
  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const allSelected = selected.size === diffs.length;

  const run = () => {
    const entryIds = diffs.map((d) => d.entry_id).filter((id) => selected.has(id));
    if (entryIds.length === 0) return;
    startTransition(async () => {
      const res = await applyMasterRatesAction({ month, entry_ids: entryIds });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "更新しました");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Alert variant="warning" className="mb-3" data-testid="rate-diff-banner">
        <AlertTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          単価・率が現在の設定と異なる稼働行が {diffs.length} 件あります
        </AlertTitle>
        <AlertDescription className="text-foreground">
          <p>ドライバー別単価や案件の単価を変更しても、入力済みの行は入力時点の値のままです。</p>
          {editable && (
            <Button variant="outline" size="sm" className="mt-2" onClick={openDialog}>
              <RefreshCw /> マスタの値に更新
            </Button>
          )}
        </AlertDescription>
      </Alert>

      {editable && (
        <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>マスタの値に更新</DialogTitle>
              <DialogDescription>
                {formatMonthJa(month)}の稼働行のうち、チェックした行の単価・率・端数処理を現在のマスタの値に書き換えます。意図して手入力した行はチェックを外してください。
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-2 text-sm">
              <p className="text-muted-foreground">
                {selected.size} / {diffs.length} 件を選択
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setSelected(allSelected ? new Set() : new Set(diffs.map((d) => d.entry_id)))}
              >
                {allSelected ? "すべて外す" : "すべて選択"}
              </Button>
            </div>

            <ul className="-mx-1 flex max-h-[45dvh] flex-col gap-0.5 overflow-y-auto" aria-label="更新する稼働行">
              {diffs.map((d) => {
                const label = rateDiffLabel(d);
                const changes = describeRateDiff(d);
                return (
                  <li key={d.entry_id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                      <Checkbox checked={selected.has(d.entry_id)} onCheckedChange={(v) => toggle(d.entry_id, v === true)} disabled={pending} className="mt-0.5" aria-label={label} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{label}</span>
                        <span className="block break-words text-xs tabular-nums text-muted-foreground">{changes.join("、")}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button type="button" onClick={run} disabled={pending || selected.size === 0}>
                {pending ? "更新中…" : `${selected.size} 行を更新する`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
