"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, Link2, ListTodo, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { autoMatchBankAction } from "@/lib/actions/bank";
import { confirmDispatchAction } from "@/lib/actions/dispatch";
import { INBOX_URGENCY_LABELS, type DeskDayOff, type DeskPendingEntry, type InboxItem, type Reporter } from "@/lib/office/desk";
import { cn } from "@/lib/utils";
import { DayOffsDialog } from "./day-offs-dialog";
import { PendingEntriesDialog } from "./pending-entries-dialog";
import { RemindButton } from "./remind-button";
import { useRun } from "./use-run";

export interface InboxCardProps {
  items: InboxItem[];
  pendingEntries: DeskPendingEntry[];
  pendingTotal: number;
  dayOffs: DeskDayOff[];
  remindTargets: Reporter[];
  /** 明日の日付（配車の確定に使う） */
  tomorrow: string | null;
}

const URGENCY_VARIANT = { now: "destructive", today: "warning", soon: "secondary" } as const;

/** 今日やること（急ぐ順）。その場でできるものはボタンで、できないものは該当の画面へ */
export function InboxCard({ items, pendingEntries, pendingTotal, dayOffs, remindTargets, tomorrow }: InboxCardProps) {
  const { pending, run } = useRun();

  const actionFor = (item: InboxItem) => {
    switch (item.action) {
      case "approve_entries":
        return <PendingEntriesDialog entries={pendingEntries} total={pendingTotal} />;
      case "decide_day_offs":
        return <DayOffsDialog dayOffs={dayOffs} />;
      case "remind":
        return remindTargets.length > 0 ? <RemindButton targets={remindTargets} /> : null;
      case "confirm_tomorrow":
        return tomorrow ? (
          <Button size="sm" onClick={() => run(() => confirmDispatchAction(tomorrow, tomorrow), "確定しました")} disabled={pending} aria-busy={pending}>
            <Send />
            確定する
          </Button>
        ) : null;
      case "auto_match":
        return (
          <Button size="sm" onClick={() => run(() => autoMatchBankAction(), "消し込みました")} disabled={pending} aria-busy={pending}>
            <Link2 />
            自動で消し込む
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <Card id="inbox">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-4 w-4" />
            今日やること
          </CardTitle>
          <CardDescription>急ぐものから並べています。その場でできるものはボタンで済みます。</CardDescription>
        </div>
        {items.length > 0 && <span className="num shrink-0 text-sm font-semibold">{items.length} 件</span>}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            今日やることはありません。
          </p>
        ) : (
          <ul className="-mx-2 divide-y">
            {items.map((item) => (
              <li key={item.kind} className="flex flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center" data-inbox={item.kind}>
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Badge variant={URGENCY_VARIANT[item.urgency]} className="mt-0.5 shrink-0">
                    {INBOX_URGENCY_LABELS[item.urgency]}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.title}</p>
                    {item.detail && <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>}
                  </div>
                </div>
                <div className={cn("flex shrink-0 flex-wrap items-center gap-2 pl-12 sm:pl-0")}>
                  {actionFor(item)}
                  <Link href={item.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    開く
                    <ChevronRight />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
