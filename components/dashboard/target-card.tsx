"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/ui/money";
import { pct, yen } from "@/lib/format";
import { parseNumberInput } from "@/lib/calc";
import { deleteMonthTargetAction, saveMonthTargetAction } from "@/lib/actions/targets";
import { cn } from "@/lib/utils";
import { hasTarget, targetProgress, type TargetProgress } from "./helpers";

export interface TargetCardProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  monthLabel: string;
  billTarget: number;
  profitTarget: number;
  memo: string;
  /** 実績（v_month_pl） */
  bill: number;
  operatingProfit: number;
  /** admin+ のみ編集できる（締め済み月でも目標は編集可） */
  canEdit: boolean;
}

function ProgressRow({ label, progress }: { label: string; progress: TargetProgress }) {
  if (progress.rate == null) {
    return (
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-sm text-muted-foreground">目標未設定</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted" />
        <p className="text-xs text-muted-foreground">
          実績 <Money value={progress.actual} className="text-xs" />
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("num text-sm font-semibold", progress.achieved ? "text-success" : undefined)}>{pct(progress.rate)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}の達成率 ${pct(progress.rate)}`}>
        <div className={cn("h-full rounded-full", progress.achieved ? "bg-success" : "bg-primary")} style={{ width: `${progress.barRatio * 100}%` }} />
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>
          実績 <Money value={progress.actual} className="text-xs" /> ／ 目標 <Money value={progress.target} className="text-xs" />
        </span>
        <span>{progress.achieved ? "達成" : `残り ${yen(progress.remaining)}`}</span>
      </p>
    </div>
  );
}

/** 月次目標カード（売上・営業利益の進捗）。admin+ は目標を編集できる */
export function TargetCard(props: TargetCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [billTarget, setBillTarget] = useState(props.billTarget ? String(props.billTarget) : "");
  const [profitTarget, setProfitTarget] = useState(props.profitTarget ? String(props.profitTarget) : "");
  const [memo, setMemo] = useState(props.memo);

  const set = hasTarget(props.billTarget, props.profitTarget);
  const billProgress = targetProgress(props.bill, props.billTarget);
  const profitProgress = targetProgress(props.operatingProfit, props.profitTarget);

  const handleOpenChange = (v: boolean) => {
    if (v) {
      setBillTarget(props.billTarget ? String(props.billTarget) : "");
      setProfitTarget(props.profitTarget ? String(props.profitTarget) : "");
      setMemo(props.memo);
    }
    setOpen(v);
  };

  const save = () => {
    if (billTarget.trim() !== "" && parseNumberInput(billTarget) == null) {
      toast.error("売上目標は数値で入力してください。");
      return;
    }
    if (profitTarget.trim() !== "" && parseNumberInput(profitTarget) == null) {
      toast.error("営業利益目標は数値で入力してください。");
      return;
    }
    startTransition(async () => {
      const res = await saveMonthTargetAction({ month: props.month, bill_target: billTarget, profit_target: profitTarget, memo });
      if (res.ok) {
        toast.success(res.message ?? "保存しました");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteMonthTargetAction(props.month);
      if (res.ok) {
        toast.success(res.message ?? "削除しました");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4" /> 月次目標
        </CardTitle>
        <CardDescription>
          {props.monthLabel} の売上・営業利益の目標と進捗{props.memo && `／${props.memo}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {set ? (
          <>
            <ProgressRow label="売上" progress={billProgress} />
            <ProgressRow label="営業利益" progress={profitProgress} />
            {props.canEdit && (
              <Button variant="outline" size="sm" onClick={() => handleOpenChange(true)}>
                目標を編集
              </Button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">{props.monthLabel} の目標は設定されていません。</p>
            {props.canEdit ? (
              <Button size="sm" onClick={() => handleOpenChange(true)}>
                <Target />
                目標を設定
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">目標の設定は管理者以上が行えます。</p>
            )}
          </div>
        )}
      </CardContent>

      {props.canEdit && (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>月次目標の設定</DialogTitle>
              <DialogDescription>{props.monthLabel} ／ 金額は税抜。空欄は「目標なし」として扱います。</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="target-bill">売上目標</Label>
                <NumberInput id="target-bill" value={billTarget} onChange={(e) => setBillTarget(e.target.value)} placeholder="例：2,600,000" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target-profit">営業利益目標</Label>
                <NumberInput id="target-profit" value={profitTarget} onChange={(e) => setProfitTarget(e.target.value)} placeholder="例：500,000" />
                <p className="text-xs text-muted-foreground">営業利益 ＝ 会社利益 − 経費</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target-memo">メモ（社内用）</Label>
                <Textarea id="target-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={2000} placeholder="例：新規案件の立ち上げ分を含む" />
              </div>
            </div>

            <DialogFooter>
              {set && (
                <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={remove} disabled={pending}>
                  <Trash2 />
                  目標を削除
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button type="button" onClick={save} disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
