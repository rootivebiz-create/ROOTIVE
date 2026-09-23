"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { useRun } from "@/components/office/use-run";
import { sendStatementsAction } from "@/lib/actions/integrations";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import {
  TARGET_STATUS_LABELS,
  canReach,
  planStatementSend,
  sendPreviewText,
  sentCount,
  statementTargetStatus,
  type StatementTarget,
  type TargetStatus,
} from "@/lib/statements/delivery";

const STATUS_VARIANT: Record<TargetStatus, "success" | "warning" | "secondary" | "outline"> = {
  sent: "success",
  changed: "warning",
  ready: "secondary",
  no_contact: "outline",
};

/**
 * 支払明細の送付（締めた月だけ。0028）。
 * 1 人ずつの状態（送信済み・金額が変わった・まだ・連絡手段なし）を並べ、まとめて送る・選んで送り直す。
 */
export function StatementSendCard({ month, targets, lineEnabled, editable }: { month: string; targets: StatementTarget[]; lineEnabled: boolean; editable: boolean }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const sent = sentCount(targets);
  const unsent = planStatementSend(targets);

  // 選ぶダイアログの既定：まだの人（連絡できる人）と金額が変わった人
  const openPicker = () => {
    setPicked(new Set(unsent.send.map((t) => t.driverId)));
    setOpen(true);
  };
  const pickedPlan = useMemo(() => planStatementSend(targets, { driverIds: Array.from(picked), resend: true }), [targets, picked]);
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Card id="statements" className="mt-4">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            支払明細の送付
          </CardTitle>
          <span className="num text-sm text-muted-foreground" data-testid="statement-sent-count">
            {targets.length} 人中 {sent} 人に送信済み
          </span>
        </div>
        <CardDescription>
          {formatMonthJa(month)}の明細を、LINE と連携している人へは LINE で、アプリの通知を受け取る人へは通知で届けます。送ると事務の「月締めの手順」も自動で済みになります。
          {!lineEnabled && " LINE 連携が未設定のため、いまはアプリの通知だけで送ります（設定 → 外部連携）。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(() => sendStatementsAction({ month }), "送りました")} disabled={pending || unsent.send.length === 0} aria-busy={pending}>
              <Send />
              {unsent.send.length > 0 ? `まだの ${unsent.send.length} 人に送る` : "全員に送信済み"}
            </Button>
            <Button variant="outline" onClick={openPicker} disabled={pending}>
              選んで送る・送り直す…
            </Button>
          </div>
        )}
        <ul className="-mx-2 divide-y">
          {targets.map((t) => {
            const status = statementTargetStatus(t);
            return (
              <li key={t.driverId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-sm" data-statement={t.driverName} data-status={status}>
                <span className="min-w-0 flex-1 font-medium">{t.driverName}</span>
                <Money value={t.payoutIncl} className="text-sm" />
                <Badge variant={STATUS_VARIANT[status]}>
                  {status === "sent" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                  {TARGET_STATUS_LABELS[status]}
                </Badge>
                <span className="w-full text-xs text-muted-foreground sm:w-auto">
                  {t.sentAt
                    ? `${formatDateTimeJa(t.sentAt)}・${t.sentChannel === "push" ? "通知" : "LINE"}${t.sentByName ? `（${t.sentByName}）` : ""}`
                    : [t.lineReady ? "LINE" : "", t.pushReady ? "通知" : ""].filter(Boolean).join("・") || "PDF を渡してください"}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>送る人を選ぶ</DialogTitle>
            <DialogDescription>送信済みの人を選ぶと送り直します（金額を直したときなど）。連絡手段が無い人は選べません。</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
            {targets.map((t) => {
              const status = statementTargetStatus(t);
              const reach = canReach(t);
              return (
                <li key={t.driverId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <Checkbox checked={picked.has(t.driverId)} disabled={!reach} onCheckedChange={(v) => toggle(t.driverId, v === true)} aria-label={`${t.driverName}に送る`} />
                    <span className="min-w-0 flex-1">{t.driverName}</span>
                    <Badge variant={STATUS_VARIANT[status]}>{TARGET_STATUS_LABELS[status]}</Badge>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{sendPreviewText(pickedPlan)}</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button
              onClick={() => run(() => sendStatementsAction({ month, driverIds: Array.from(picked), resend: true }), "送りました", () => setOpen(false))}
              disabled={pending || pickedPlan.send.length === 0}
              aria-busy={pending}
            >
              <Send />
              {pickedPlan.send.length} 人に送る
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
