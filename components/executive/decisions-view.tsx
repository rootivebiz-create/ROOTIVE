"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Pencil, Plus, Stamp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { DECISION_STATUS_LABELS, type Decision } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { DECISION_STATUS_BADGE, dateText } from "./helpers";
import { DecisionDialog } from "./decision-dialog";

export interface DecisionsViewProps {
  /** 決めた日の新しい順（loadDecisions の並び） */
  decisions: Decision[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
}

/** 見直し日が来ているか（status='open' かつ review_on <= 今日） */
function isDueForReview(d: Decision, today: string): boolean {
  return d.status === "open" && !!d.review_on && d.review_on <= today;
}

export function DecisionsView({ decisions, today }: DecisionsViewProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Decision | null>(null);

  const due = useMemo(() => decisions.filter((d) => isDueForReview(d, today)), [decisions, today]);
  const rest = useMemo(() => decisions.filter((d) => !isDueForReview(d, today)), [decisions, today]);

  const card = (d: Decision) => (
    <li key={d.id}>
      <Card className={cn(isDueForReview(d, today) && "border-warning/40 bg-warning/5")}>
        <CardContent className="space-y-2 p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={DECISION_STATUS_BADGE[d.status] ?? "secondary"}>{DECISION_STATUS_LABELS[d.status]}</Badge>
            {d.approval_id && (
              <Badge variant="outline" className="inline-flex items-center gap-1">
                <Stamp className="h-3 w-3" />
                決裁から作成
              </Badge>
            )}
            <span className="num text-xs text-muted-foreground">{dateText(d.decided_on)}に決定</span>
          </div>

          <Link href={`/executive/decisions/${d.id}`} className="block break-words font-medium leading-snug hover:underline">
            {d.title}
          </Link>

          {d.decision && <p className="break-words text-sm text-muted-foreground">{d.decision}</p>}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {d.amount != null && (
              <>
                <dt className="text-muted-foreground">金額</dt>
                <dd className="text-right">
                  <Money value={d.amount} />
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">見直し日</dt>
            <dd className={cn("num text-right", isDueForReview(d, today) && "font-semibold text-warning")}>{dateText(d.review_on)}</dd>
            {d.outcome_on && (
              <>
                <dt className="text-muted-foreground">振り返り</dt>
                <dd className="num text-right">{dateText(d.outcome_on)}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link href={`/executive/decisions/${d.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
              {isDueForReview(d, today) ? "結果を書く" : "くわしく見る"}
            </Link>
            <button type="button" className="ml-auto inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(d)}>
              <Pencil className="h-3.5 w-3.5" />
              編集
            </button>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </li>
  );

  return (
    <div>
      <PageHeader
        title="意思決定ログ"
        description="何を、なぜ決めたかを残します。見直し日が来たものから結果を書いて振り返ります。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> 意思決定を残す
          </Button>
        }
      />

      {decisions.length === 0 ? (
        <Empty
          title="まだ意思決定がありません"
          description="「意思決定を残す」から、決めたことと理由を書いてください。決裁の画面で「意思決定として残す」を選んでも下書きが作られます。"
        >
          <BookOpen className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <div className="space-y-5">
          {due.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-semibold">
                見直し日が来ています <span className="num text-sm font-normal text-muted-foreground">（{due.length} 件）</span>
              </h2>
              <ul className="space-y-2">{due.map(card)}</ul>
            </section>
          )}

          <section>
            {due.length > 0 && <h2 className="mb-2 text-base font-semibold">これまでの意思決定</h2>}
            {rest.length === 0 ? (
              <p className="text-sm text-muted-foreground">ほかの意思決定はありません。</p>
            ) : (
              <ul className="space-y-2">{rest.map(card)}</ul>
            )}
          </section>
        </div>
      )}

      <DecisionDialog open={creating} onOpenChange={setCreating} decision={null} today={today} />
      <DecisionDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} decision={editing} today={today} />
    </div>
  );
}
