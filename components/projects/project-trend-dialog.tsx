"use client";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money, Pct } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumMoney } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import type { ProjectTrendPoint } from "./helpers";

/** 表の月表示："9月"（1 月だけは年も出す） */
export function trendMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  const n = Number(m);
  return n === 1 ? `${y.slice(2)}年1月` : `${n}月`;
}

/** 案件利益の棒の幅（%）。12 か月の最大額を 100% とする */
function barWidth(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((Math.abs(value) / max) * 100));
}

export interface ProjectTrendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** 目標利益率（0.2 = 20%）。null = 判定しない */
  targetMargin: number | null;
  /** 古い順の 12 か月（欠けている月は 0 埋め） */
  points: ProjectTrendPoint[];
}

/** 案件ごとの 12 か月の推移（売上・案件利益・利益率）。スマホは下から全幅シート */
export function ProjectTrendDialog({ open, onOpenChange, projectName, targetMargin, points }: ProjectTrendDialogProps) {
  const first = points[0]?.month;
  const last = points[points.length - 1]?.month;
  const max = points.reduce((a, p) => Math.max(a, Math.abs(p.projectProfit)), 0);
  const bill = sumMoney(points.map((p) => p.bill));
  const profit = sumMoney(points.map((p) => p.projectProfit));
  const rate = bill !== 0 ? profit / bill : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{projectName} の推移</DialogTitle>
          <DialogDescription>
            {first && last ? `${formatMonthJa(first)} 〜 ${formatMonthJa(last)} の売上・案件利益・利益率（案件利益 ＝ 稼働の利益 − 直課経費）` : "推移を表示できるデータがありません。"}
          </DialogDescription>
        </DialogHeader>

        {targetMargin != null && (
          <p className="text-xs text-muted-foreground">
            目標利益率 <Pct value={targetMargin} className="font-semibold" />
          </p>
        )}

        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">この案件の稼働・経費がまだありません。</p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>月</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">案件利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => {
                const below = targetMargin != null && p.hasData && p.bill !== 0 && p.projectMargin < targetMargin;
                return (
                  <TableRow key={p.month} className={cn(!p.hasData && "text-muted-foreground")}>
                    <TableCell className="whitespace-nowrap">{trendMonthLabel(p.month)}</TableCell>
                    <TableCell className="text-right">{p.hasData ? <Money value={p.bill} /> : <span className="num text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="relative text-right">
                      <span
                        aria-hidden
                        className={cn("absolute inset-y-1 right-0 rounded-sm opacity-20", p.projectProfit < 0 ? "bg-destructive" : "bg-chart-1")}
                        style={{ width: `${barWidth(p.projectProfit, max)}%` }}
                      />
                      <span className="relative">{p.hasData ? <Money value={p.projectProfit} className="font-semibold" /> : <span className="num text-muted-foreground">—</span>}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.hasData ? (
                        <span className="inline-flex items-center gap-1">
                          <Pct value={p.projectMargin} />
                          {below && <Badge variant="destructive">未達</Badge>}
                        </span>
                      ) : (
                        <span className="num text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>合計</TableCell>
                <TableCell className="text-right">
                  <Money value={bill} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={profit} />
                </TableCell>
                <TableCell className="text-right">
                  <Pct value={rate} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">※ 管理費・調整はドライバー単位のため案件には配賦していません。</p>
      </DialogContent>
    </Dialog>
  );
}
