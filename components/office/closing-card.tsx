"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleAlert, CircleMinus, Lock, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { applyRecurringExpensesAction } from "@/lib/actions/expenses";
import { closeMonthAction } from "@/lib/actions/months";
import { setCloseCheckAction } from "@/lib/actions/office";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa, nextMonth, prevMonth } from "@/lib/month";
import { STEP_STATUS_LABELS, type ClosingProgress, type ClosingStep, type StepStatus } from "@/lib/office/desk";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

const STATUS_ICON: Record<StepStatus, { icon: typeof Circle; className: string }> = {
  done: { icon: CheckCircle2, className: "text-success" },
  todo: { icon: Circle, className: "text-muted-foreground" },
  warn: { icon: CircleAlert, className: "text-warning" },
  skip: { icon: CircleMinus, className: "text-muted-foreground/60" },
};

export interface ClosingCardProps {
  /** "YYYY-MM" */
  month: string;
  steps: ClosingStep[];
  progress: ClosingProgress;
  closedAt: string | null;
}

/**
 * 月締めの手順。上から順に進めれば締められる。
 * アプリが判定できる手順は自動で「済み」になり、判定できない手順（支払明細の送付・振込）は手でチェックする。
 */
export function ClosingCard({ month, steps, progress, closedAt }: ClosingCardProps) {
  const { pending, run } = useRun();
  const [closeOpen, setCloseOpen] = useState(false);
  const [note, setNote] = useState("");
  const closed = progress.closed;
  const remaining = steps.filter((s) => s.key !== "close" && s.status === "todo");
  const ratio = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const actionFor = (s: ClosingStep) => {
    if (closed) return null;
    if (s.action === "check") {
      return (
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
          <Checkbox
            checked={s.status === "done"}
            disabled={pending}
            onCheckedChange={(v) => run(() => setCloseCheckAction({ month, key: s.key, done: v === true }), v === true ? "チェックしました" : "チェックを外しました")}
            aria-label={s.title}
          />
          済み
        </label>
      );
    }
    if (s.action === "apply_recurring" && s.status === "todo") {
      return (
        <Button size="sm" onClick={() => run(() => applyRecurringExpensesAction(month), "計上しました")} disabled={pending} aria-busy={pending}>
          <Receipt />
          計上する
        </Button>
      );
    }
    if (s.action === "close_month" && s.status === "todo") {
      return (
        <Button size="sm" variant={progress.ready ? "default" : "outline"} onClick={() => { setNote(""); setCloseOpen(true); }} disabled={pending}>
          <Lock />
          締める…
        </Button>
      );
    }
    return null;
  };

  return (
    <Card id="closing">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {formatMonthJa(month)}の締め
          </CardTitle>
          <div className="flex items-center gap-1">
            <Link href={`/office?m=${prevMonth(month)}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label="前の月の締め">
              <ChevronLeft />
              前の月
            </Link>
            <Link href={`/office?m=${nextMonth(month)}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label="次の月の締め">
              次の月
              <ChevronRight />
            </Link>
          </div>
        </div>
        <CardDescription>
          {closed
            ? `締め済みです${closedAt ? `（${formatDateTimeJa(closedAt)}）` : ""}。稼働・管理費・調整は固定されています。`
            : "上から順に進めると締められます。自動で分かるものは「済み」になり、分からないものは手でチェックします。"}
        </CardDescription>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>進み具合</span>
            <span className="num" data-testid="closing-progress">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100} aria-label="月締めの進み具合">
            <div className={cn("h-full rounded-full transition-all", closed ? "bg-success" : "bg-primary")} style={{ width: `${ratio}%` }} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="-mx-2 divide-y">
          {steps.map((s, i) => {
            const { icon: Icon, className } = STATUS_ICON[s.status];
            return (
              <li key={s.key} className="flex flex-col gap-2 px-2 py-2.5 sm:flex-row sm:items-center" data-step={s.key} data-status={s.status}>
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} aria-hidden />
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium", s.status === "skip" && "text-muted-foreground")}>
                      <span className="num mr-1 text-muted-foreground">{i + 1}.</span>
                      {s.title}
                      <span className="sr-only">（{STEP_STATUS_LABELS[s.status]}）</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 pl-6 sm:pl-0">
                  {s.status === "warn" && <Badge variant="warning">確認</Badge>}
                  {actionFor(s)}
                  {s.href && s.key !== "close" && (
                    <Link href={s.href} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`${s.title}を開く`}>
                      開く
                      <ChevronRight />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{formatMonthJa(month)}を締めますか？</DialogTitle>
            <DialogDescription>締めると、その月の稼働・管理費・調整・経費は変えられなくなります。集計とバックアップを保存します（解除できるのはオーナーだけです）。</DialogDescription>
          </DialogHeader>
          {remaining.length > 0 && (
            <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm">
              <p className="font-medium">まだ終わっていない手順があります</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {remaining.map((s) => (
                  <li key={s.key}>{s.title}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="close-note">メモ（任意）</Label>
            <Textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="例：9/5 振込済み。A 社の請求は 9/10 に再発行" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button onClick={() => run(() => closeMonthAction(month, note.trim()), "締めました", () => setCloseOpen(false))} disabled={pending} aria-busy={pending}>
              <Lock />
              締める
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
