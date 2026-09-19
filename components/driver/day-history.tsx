"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWorkDate } from "@/lib/daily/helpers";
import { qty as qtyText } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 過去 7 日分の 1 日 */
export interface DayHistoryItem {
  date: string;
  /** 業務前点呼が記録されている */
  pre: boolean;
  /** 業務後点呼が記録されている */
  post: boolean;
  /** 稼働の合計（差戻しを除く） */
  qtyTotal: number;
  /** 報告した案件内容の件数 */
  itemCount: number;
}

function Mark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs", ok ? "text-success" : "text-muted-foreground")}>
      {ok ? <Check className="h-3 w-3" aria-hidden /> : <Minus className="h-3 w-3" aria-hidden />}
      {label}
    </span>
  );
}

/** 直近 7 日の報告の状況（済み／未済） */
export function DayHistory({ items, selected }: { items: DayHistoryItem[]; selected: string }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>直近 7 日</CardTitle>
        <CardDescription>日付を選ぶと、その日の報告を追加・修正できます。</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((d) => (
            <li key={d.date}>
              <Link
                href={`/driver/today?d=${d.date}`}
                className={cn("flex items-center justify-between gap-2 py-2 text-sm hover:bg-muted", d.date === selected && "font-semibold")}
              >
                <span className="w-20 shrink-0">{formatWorkDate(d.date)}</span>
                <span className="flex flex-1 flex-wrap items-center gap-2">
                  <Mark ok={d.pre} label="出発前" />
                  <Mark ok={d.itemCount > 0} label="稼働" />
                  <Mark ok={d.post} label="終了後" />
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">{d.itemCount > 0 ? qtyText(d.qtyTotal) : "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
