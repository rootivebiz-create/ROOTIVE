"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Download, Loader2, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MonthLink } from "@/components/layout/month-link";
import type { DailyReportRow, WorkDayEntryRow } from "@/lib/db/types";
import { applyDayEntriesAction, approveDayEntriesAction } from "@/lib/actions/daily";
import { pendingIds } from "@/lib/daily/helpers";
import { dailyCsvUrl } from "@/lib/exports/daily-csv";
import type { DayTab } from "@/lib/schemas/daily";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { EntryList } from "./entry-list";
import { ReportList } from "./report-list";
import type { DailyChoices } from "./roll-call-dialog";

const TABS: { key: DayTab; label: string }[] = [
  { key: "reports", label: "日報" },
  { key: "entries", label: "稼働報告" },
];

export interface DayStatusCounts {
  workDayCount: number;
  pendingCount: number;
  rollCallMissingCount: number;
}

export interface DailyViewProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  tab: DayTab;
  reports: DailyReportRow[];
  entries: WorkDayEntryRow[];
  status: DayStatusCounts;
  choices: DailyChoices;
  /** admin＋未締め月 */
  editable: boolean;
  /** 締め済み月 */
  closed: boolean;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warning" | "destructive" }) {
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("num mt-1 text-xl font-bold", value > 0 && tone === "warning" && "text-warning", value > 0 && tone === "destructive" && "text-destructive")}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/** 日報・点呼（スタッフ向け） */
export function DailyView({ month, tab, reports, entries, status, choices, editable, closed }: DailyViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingList = useMemo(() => pendingIds(entries), [entries]);

  const approveAll = () => {
    if (pendingList.length === 0) return;
    startTransition(async () => {
      const res = await approveDayEntriesAction(pendingList, true);
      if (res.ok) {
        toast.success(res.message ?? "承認しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const reapply = () => {
    startTransition(async () => {
      const res = await applyDayEntriesAction(month);
      if (res.ok) {
        toast.success(res.message ?? "反映しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div>
      <PageHeader
        title="日報・点呼"
        description={`${formatMonthJa(month)} の点呼の記録とドライバーからの稼働報告`}
        actions={
          <>
            <a
              href={dailyCsvUrl(month, tab === "entries" ? "entry" : "report")}
              download
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download className="h-4 w-4" />
              {tab === "entries" ? "稼働 CSV" : "点呼記録簿 CSV"}
            </a>
            {editable && (
              <>
                <Button size="sm" onClick={approveAll} disabled={pending || pendingList.length === 0} aria-busy={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                  承認待ちをまとめて承認
                  {pendingList.length > 0 && <span className="num">（{pendingList.length}）</span>}
                </Button>
                <Button size="sm" variant="outline" onClick={reapply} disabled={pending} aria-busy={pending}>
                  <RefreshCw />
                  月次に反映し直す
                </Button>
              </>
            )}
          </>
        }
      />

      {/* サマリー */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <StatCard label="稼働日数" value={status.workDayCount} />
        <StatCard label="承認待ち" value={status.pendingCount} tone="warning" />
        <StatCard label="点呼が無い日" value={status.rollCallMissingCount} tone="destructive" />
      </div>

      {closed && <Alert className="mb-3">この月は締め済みのため変更できません。</Alert>}

      {/* タブ（?tab=） */}
      <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex gap-1 rounded-md bg-muted p-1">
          {TABS.map((t) => (
            <MonthLink
              key={t.key}
              href={`/daily?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                tab === t.key && "bg-card text-foreground shadow",
              )}
            >
              {t.label}
              {t.key === "entries" && status.pendingCount > 0 && <span className="num text-xs">({status.pendingCount})</span>}
            </MonthLink>
          ))}
        </div>
      </div>

      {tab === "entries" ? <EntryList entries={entries} editable={editable} /> : <ReportList reports={reports} editable={editable} choices={choices} />}

      <p className="mt-3 text-xs text-muted-foreground">
        点呼の記録は 1 年間の保存が必要です。承認した稼働報告はその月の稼働（数量）へ自動で反映されます。
      </p>
    </div>
  );
}
