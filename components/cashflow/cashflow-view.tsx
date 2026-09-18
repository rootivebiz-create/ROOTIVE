"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Download, Landmark, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { exportUrls } from "@/lib/exports/urls";
import { formatDateJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import type { CashEvent } from "@/lib/db/types";
import { BalanceChart } from "./balance-chart";
import { SnapshotDialog } from "./snapshot-dialog";
import { TimelineList } from "./timeline-list";
import {
  activePresetKey,
  buildCashTimeline,
  cashSummary,
  fillDailyBalances,
  formatMonthDayJa,
  negativeBalanceMessage,
  presetRange,
  RANGE_PRESETS,
  type CashRange,
  type CashSnapshotRow,
  type OpeningBalance,
} from "./helpers";

export interface CashflowViewProps {
  range: CashRange;
  /** 日本時間の今日 */
  today: string;
  /** RPC cash_forecast の行（入金は ＋、支払は −） */
  events: CashEvent[];
  /** 期間開始日以前で一番新しい残高（未登録なら null） */
  opening: OpeningBalance | null;
  /** 登録済みの残高（新しい順。ダイアログで一覧・削除する） */
  snapshots: CashSnapshotRow[];
  /** 残高を登録できる（owner/admin） */
  editable: boolean;
}

/** 期間の切り替え（?from=&to= を書き換える。?m= などほかのパラメータは引き継ぐ） */
function RangeTabs({ range, today }: { range: CashRange; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = activePresetKey(range, today);

  const go = (key: string) => {
    const next = presetRange(key, today);
    const sp = new URLSearchParams(params.toString());
    sp.set("from", next.from);
    sp.set("to", next.to);
    router.push(`${pathname}?${sp.toString()}`);
  };

  return (
    <div className="flex items-center gap-1 rounded-md border bg-card p-0.5" role="group" aria-label="表示する期間">
      {RANGE_PRESETS.map((p) => (
        <Button
          key={p.key}
          size="sm"
          variant={active === p.key ? "default" : "ghost"}
          aria-pressed={active === p.key}
          className="px-2.5"
          onClick={() => go(p.key)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}

function SummaryCard({ title, children, note, className }: { title: string; children: React.ReactNode; note?: string; className?: string }) {
  return (
    <Card className={cn("min-w-0 p-3 md:p-4", className)}>
      <p className="text-xs text-muted-foreground md:text-sm">{title}</p>
      <p className="mt-1 text-lg font-semibold md:text-2xl">{children}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

export function CashflowView({ range, today, events, opening, snapshots, editable }: CashflowViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const openingBalance = opening?.balance ?? 0;
  const timeline = useMemo(
    () => buildCashTimeline({ events, openingBalance, from: range.from, to: range.to }),
    [events, openingBalance, range.from, range.to],
  );
  const summary = useMemo(() => cashSummary(timeline), [timeline]);
  const points = useMemo(() => fillDailyBalances(timeline, range.from, range.to, openingBalance), [timeline, range.from, range.to, openingBalance]);
  const warning = negativeBalanceMessage(summary);
  const endBalance = timeline.length > 0 ? timeline[timeline.length - 1].balance : openingBalance;
  const minBalance = summary.minBalance ?? openingBalance;

  return (
    <div className="space-y-4">
      <PageHeader
        title="資金繰り"
        description={`${formatDateJa(range.from)} 〜 ${formatDateJa(range.to)} の入金予定・ドライバーへの支払・経費（金額は税込）`}
        actions={
          <>
            <RangeTabs range={range} today={today} />
            {editable && (
              <Button variant={opening ? "outline" : "default"} onClick={() => setDialogOpen(true)}>
                {opening ? <RefreshCw /> : <Plus />} 残高を登録
              </Button>
            )}
            <a href={exportUrls.cashflowCsv(range.from, range.to)} download className={buttonVariants({ variant: "outline" })}>
              <Download /> CSV
            </a>
          </>
        }
      />

      {warning && (
        <Alert variant="destructive" className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-medium">{warning}</span>
        </Alert>
      )}

      {!opening && (
        <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-medium">現在の残高を登録してください。</span> 残高は未登録です（グラフは 0 円を起点にしています）。
            {!editable && " 登録はオーナー・管理者のみ可能です。"}
          </span>
          {editable && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Landmark /> 残高を登録
            </Button>
          )}
        </Alert>
      )}

      {/* サマリー：入金・支払・差引・最低残高 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard title="入金合計" note={`${summary.eventCount} 件の予定`}>
          <Money value={summary.inflow} />
        </SummaryCard>
        <SummaryCard title="支払合計">
          <Money value={-summary.outflow} />
        </SummaryCard>
        <SummaryCard title="差引" note="入金 − 支払">
          <Money value={summary.net} />
        </SummaryCard>
        <SummaryCard
          title="最低残高"
          className={minBalance < 0 ? "border-destructive/40 bg-destructive/5" : undefined}
          note={summary.minBalanceDate ? `${formatMonthDayJa(summary.minBalanceDate)}` : "予定なし"}
        >
          <Money value={minBalance} />
        </SummaryCard>
      </div>

      {/* 残高の推移 */}
      <Card>
        <CardHeader>
          <CardTitle>残高の推移</CardTitle>
          <CardDescription>
            {opening ? (
              <>
                起点は {formatDateJa(opening.asOf)} 時点の残高 <Money value={opening.balance} className="font-semibold" />
                {opening.memo && <span className="ml-1">（{opening.memo}）</span>}。
              </>
            ) : (
              <>残高は未登録です。0 円を起点に増減だけを表示しています。</>
            )}
            {" 期間末の見込み残高は "}
            <Money value={endBalance} className="font-semibold" />
            {" です。マイナスになる区間は赤で表示します。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BalanceChart points={points} today={today} />
        </CardContent>
      </Card>

      {/* 予定の一覧 */}
      {timeline.length === 0 ? (
        <Empty
          title="この期間に入金・支払の予定はありません"
          description="請求書の発行、ドライバーの支払予定日、毎月かかる経費の支払日を登録すると、この画面に並びます。期間を広げると先の予定も表示されます。"
        />
      ) : (
        <TimelineList timeline={timeline} today={today} />
      )}

      {editable && <SnapshotDialog open={dialogOpen} onOpenChange={setDialogOpen} today={today} snapshots={snapshots} />}
    </div>
  );
}
