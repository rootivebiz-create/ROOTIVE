/**
 * ダッシュボードに差し込むカード（props だけで動く。サーバー部品としてそのまま使える）
 * その月の稼働日数・承認待ち・点呼が無い日を出し、どちらも 0 なら「記録はそろっています」だけを出す。
 */
import { CheckCircle2, ChevronRight, ClipboardCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthLink } from "@/components/layout/month-link";
import { cn } from "@/lib/utils";

export interface DayStatusCardProps {
  /** 稼働の報告があった日数（v_day_status.work_day_count） */
  workDayCount: number;
  /** 承認待ちの件数（v_day_status.pending_count） */
  pendingCount: number;
  /** 業務前点呼が記録されていない日数（v_day_status.roll_call_missing_count） */
  rollCallMissingCount: number;
  /** カードの説明に出す月（例："2026年9月"） */
  monthLabel?: string;
  className?: string;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "destructive" }) {
  return (
    <div className="rounded-md bg-muted/50 p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("num mt-0.5 text-lg font-bold", value > 0 && tone === "warning" && "text-warning", value > 0 && tone === "destructive" && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}

/** 日報・点呼の状況カード */
export function DayStatusCard({ workDayCount, pendingCount, rollCallMissingCount, monthLabel, className }: DayStatusCardProps) {
  const clean = pendingCount === 0 && rollCallMissingCount === 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" /> 日報・点呼
        </CardTitle>
        <CardDescription>
          {monthLabel ? `${monthLabel} の` : ""}
          ドライバーの報告と点呼の記録の状況です。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="稼働日数" value={workDayCount} />
          <Stat label="承認待ち" value={pendingCount} tone="warning" />
          <Stat label="点呼が無い日" value={rollCallMissingCount} tone="destructive" />
        </div>

        {clean ? (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            記録はそろっています
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              {pendingCount > 0 && `承認待ちが ${pendingCount} 件あります。`}
              {rollCallMissingCount > 0 && `点呼の記録が無い日が ${rollCallMissingCount} 日あります。`}
            </span>
          </p>
        )}

        <MonthLink href="/daily" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-primary hover:bg-muted">
          <span>日報・点呼を確認する</span>
          <ChevronRight className="h-4 w-4" />
        </MonthLink>
      </CardContent>
    </Card>
  );
}
