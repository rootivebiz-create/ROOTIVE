"use client";

import Link from "next/link";
import { CheckCircle2, ClipboardCheck, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { timeJa, type TodayReporters } from "@/lib/office/desk";
import { RemindButton } from "./remind-button";

/**
 * 今日の報告（点呼・稼働）。報告が要る人のうち、まだの人を上に出す。
 * 連絡手段が無い人（アプリも LINE も無い）は催促できないので「代わりに入力」へ。
 */
export function ReportersCard({ reporters }: { reporters: TodayReporters }) {
  const { expected, missing, remindTargets, reportedCount, basis } = reporters;
  const sorted = [...missing, ...expected.filter((r) => r.reported)];

  return (
    <Card id="reports">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            今日の報告
          </CardTitle>
          <CardDescription>
            {basis === "dispatch" ? "今日の配車に入っている人" : "定休日・休みの人を除いた全員"}の、点呼か稼働の報告です。
          </CardDescription>
        </div>
        <span className="num shrink-0 text-sm font-semibold">
          {reportedCount} / {expected.length} 人
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {expected.length === 0 ? (
          <p className="text-sm text-muted-foreground">今日報告が要る人はいません。</p>
        ) : missing.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            全員の報告が届いています。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <RemindButton targets={remindTargets} />
            {remindTargets.length === 0 && <p className="text-xs text-muted-foreground">まだの人は、今日すでに催促したか、連絡手段がありません。</p>}
          </div>
        )}
        {sorted.length > 0 && (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {sorted.map((r) => (
              <li key={r.driverId} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-reporter={r.name}>
                <span className="min-w-0 truncate font-medium">{r.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {r.reported ? (
                    <Badge variant="success">済み</Badge>
                  ) : r.remindedAt ? (
                    <Badge variant="secondary" title={r.remindedBy ? `${r.remindedBy}さんが催促` : undefined}>
                      催促済み {timeJa(r.remindedAt)}
                    </Badge>
                  ) : !r.reachable ? (
                    <>
                      <Badge variant="outline">連絡手段なし</Badge>
                      <Link href="/daily" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline" aria-label={`${r.name}の報告を代わりに入力`}>
                        <PencilLine className="h-3 w-3" />
                        代わりに入力
                      </Link>
                    </>
                  ) : (
                    <Badge variant="warning">まだ</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
