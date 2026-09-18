"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, LineChart } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money, Pct, Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { ProjectTrendDialog } from "./project-trend-dialog";
import { judgeTarget, sortByMargin, sumProjectRows, toTrend, TARGET_JUDGEMENT_LABELS, type ProjectPlRow } from "./helpers";

function JudgementBadge({ row }: { row: ProjectPlRow }) {
  const j = judgeTarget(row);
  if (j === "none") return <span className="text-muted-foreground">{TARGET_JUDGEMENT_LABELS.none}</span>;
  return <Badge variant={j === "below" ? "destructive" : "success"}>{TARGET_JUDGEMENT_LABELS[j]}</Badge>;
}

export interface ProjectPlTableProps {
  /** 表示中の稼動月 "YYYY-MM" */
  month: string;
  /** その月の案件 × 月の採算（v_project_pl） */
  rows: ProjectPlRow[];
  /** 推移用：直近 12 か月の全案件分 */
  trendRows: ProjectPlRow[];
  /** 推移で並べる月（古い順） */
  trendMonths: string[];
}

/** 案件ごとの採算：PC は表、スマホはカード。利益率の高い順 */
export function ProjectPlTable({ month, rows, trendRows, trendMonths }: ProjectPlTableProps) {
  const [trendFor, setTrendFor] = useState<ProjectPlRow | null>(null);
  const sorted = useMemo(() => sortByMargin(rows), [rows]);
  const total = useMemo(() => sumProjectRows(rows), [rows]);
  const points = useMemo(() => (trendFor ? toTrend(trendRows, trendFor.projectId, trendMonths) : []), [trendFor, trendRows, trendMonths]);
  const belowNames = sorted.filter((r) => judgeTarget(r) === "below").map((r) => r.projectName);

  if (sorted.length === 0) {
    return <Empty title="案件ごとの採算はまだありません" description={`${formatMonthJa(month)} の稼働行と、案件に紐づけた経費がありません。`} />;
  }

  const trendButton = (r: ProjectPlRow, full?: boolean) => (
    <Button variant="outline" size="sm" className={cn(full && "w-full")} onClick={() => setTrendFor(r)} aria-label={`${r.projectName} の推移を見る`}>
      <LineChart className="h-4 w-4" /> 推移
    </Button>
  );

  return (
    <>
      {total.belowTargetCount > 0 && (
        <Alert variant="destructive" className="mb-3 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">目標利益率を下回っている案件が {total.belowTargetCount} 件あります</p>
            <p className="mt-0.5 text-xs">{belowNames.join("／")}（値上げ交渉・経費の見直し・撤退の検討）</p>
          </div>
        </Alert>
      )}

      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {sorted.map((r) => (
          <li key={r.projectId}>
            <Card className={cn("p-3", judgeTarget(r) === "below" && "border-destructive/40")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.projectName}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.clientName || "取引先なし"} ／ {r.entryCount} 件
                    {r.driverCount > 0 && ` ・ ${r.driverCount} 名`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-muted-foreground">案件利益</p>
                  <Money value={r.projectProfit} className="text-lg font-semibold" />
                  <p className="text-xs">
                    <Pct value={r.projectMargin} />
                  </p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">数量</dt>
                  <dd>
                    <Qty value={r.qtyTotal} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">売上</dt>
                  <dd>
                    <Money value={r.bill} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">直課経費</dt>
                  <dd>
                    <Money value={r.expenseDirect} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">目標</dt>
                  <dd>{r.targetMargin != null ? <Pct value={r.targetMargin} /> : <span className="text-muted-foreground">—</span>}</dd>
                </div>
              </dl>
              <div className="mt-2 flex items-center justify-between gap-2">
                <JudgementBadge row={r} />
                {trendButton(r)}
              </div>
            </Card>
          </li>
        ))}
        <li>
          <Card className="bg-muted/50 p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">合計（{total.projectCount} 案件）</p>
              <div className="text-right">
                <Money value={total.projectProfit} className="text-lg font-semibold" />
                <p className="text-xs">
                  <Pct value={total.projectMargin} />
                </p>
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">売上</dt>
                <dd>
                  <Money value={total.bill} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">直課経費</dt>
                <dd>
                  <Money value={total.expenseDirect} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">稼働の利益</dt>
                <dd>
                  <Money value={total.entryProfit} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">稼働件数</dt>
                <dd className="num">{total.entryCount}</dd>
              </div>
            </dl>
          </Card>
        </li>
      </ul>

      {/* PC：表 */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>案件</TableHead>
              <TableHead>取引先</TableHead>
              <TableHead className="text-right">稼働件数</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">売上</TableHead>
              <TableHead className="text-right">直課経費</TableHead>
              <TableHead className="text-right">案件利益</TableHead>
              <TableHead className="text-right">利益率</TableHead>
              <TableHead className="text-right">目標</TableHead>
              <TableHead>判定</TableHead>
              <TableHead className="text-right">推移</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.projectId} className={cn(judgeTarget(r) === "below" && "bg-destructive/5")}>
                <TableCell className="font-medium">{r.projectName}</TableCell>
                <TableCell className="text-muted-foreground">{r.clientName || "—"}</TableCell>
                <TableCell className="num">{r.entryCount}</TableCell>
                <TableCell className="text-right">
                  <Qty value={r.qtyTotal} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.bill} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.expenseDirect} showZeroAsDash />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.projectProfit} className="font-semibold" />
                </TableCell>
                <TableCell className="text-right">
                  <Pct value={r.projectMargin} />
                </TableCell>
                <TableCell className="text-right">{r.targetMargin != null ? <Pct value={r.targetMargin} /> : <span className="num text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <JudgementBadge row={r} />
                </TableCell>
                <TableCell className="text-right">{trendButton(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>合計（{total.projectCount} 案件）</TableCell>
              <TableCell className="num">{total.entryCount}</TableCell>
              <TableCell className="text-right">
                <Qty value={total.qtyTotal} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.bill} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.expenseDirect} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.projectProfit} />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={total.projectMargin} />
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <ProjectTrendDialog
        open={trendFor != null}
        onOpenChange={(open) => {
          if (!open) setTrendFor(null);
        }}
        projectName={trendFor?.projectName ?? ""}
        targetMargin={trendFor?.targetMargin ?? null}
        points={points}
      />
    </>
  );
}
