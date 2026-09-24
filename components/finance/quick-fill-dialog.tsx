"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { parseNumberInput } from "@/lib/calc/parse";
import { sumMoney } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import {
  actualSeries,
  BUDGET_METRIC_LABELS,
  growValues,
  isMoneyMetric,
  sameValues,
  splitEvenly,
  type BudgetMetric,
  type BudgetRow,
} from "@/lib/finance/budget";
import type { BudgetRange } from "./budget-panel";

export interface QuickFillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** いま入力している指標 */
  metric: BudgetMetric;
  /** 期（または暦年）の名前と、ひとつ前の名前 */
  range: BudgetRange;
  /** その範囲の月（"YYYY-MM"。期の第1期は 12 か月より短いことがある） */
  months: string[];
  /** ひとつ前の範囲の同じ月 */
  prevRows: BudgetRow[];
  /** いまの入力値（月の数ぶん。プレビューに使う） */
  currentValues: number[];
  /** 月の数ぶんの値を入力欄へ反映する */
  onApply: (values: number[]) => void;
}

function Total({ metric, values }: { metric: BudgetMetric; values: number[] }) {
  if (isMoneyMetric(metric)) return <Money value={sumMoney(values)} />;
  const active = values.filter((v) => v > 0);
  const avg = active.length === 0 ? 0 : Math.round((active.reduce((a, b) => a + b, 0) / active.length) * 10) / 10;
  return <span className="num">{avg} 人</span>;
}

/**
 * かんたん入力：範囲（期・暦年）の月ぶんの目標をまとめて埋める
 * 入力欄に反映するだけで、保存は「まとめて保存」で 1 回だけ行う
 */
export function QuickFillDialog({ open, onOpenChange, metric, range, months, prevRows, currentValues, onApply }: QuickFillDialogProps) {
  const label = BUDGET_METRIC_LABELS[metric];
  const money = isMoneyMetric(metric);
  const prevValues = useMemo(() => actualSeries(prevRows, metric), [prevRows, metric]);
  const hasPrev = prevValues.some((v) => v > 0);
  const count = months.length;
  const lastMonth = months[count - 1];

  const [growth, setGrowth] = useState("10");
  const [same, setSame] = useState("");
  const [total, setTotal] = useState("");

  const growthPreview = useMemo(() => growValues(prevValues, parseNumberInput(growth) ?? 0), [prevValues, growth]);
  const samePreview = useMemo(() => sameValues(parseNumberInput(same) ?? 0, count), [same, count]);
  const totalPreview = useMemo(() => splitEvenly(parseNumberInput(total) ?? 0, count), [total, count]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>かんたん入力（{label}）</DialogTitle>
          <DialogDescription>
            {range.title}の {count} か月ぶんの{label}の目標をまとめて入力欄へ入れます。内容を確かめてから「まとめて保存」を押してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            いまの入力 <Total metric={metric} values={currentValues} />
          </p>

          {/* 1. 前期（前年）実績 ＋ ◯% */}
          <section className={cn("space-y-2 rounded-lg border p-3", !hasPrev && "opacity-60")}>
            <Label htmlFor="quick-growth">{range.prevName}実績 ＋ ◯%</Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id="quick-growth"
                value={growth}
                onChange={(e) => setGrowth(e.target.value)}
                placeholder="10"
                className="w-24 text-right"
                disabled={!hasPrev}
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => onApply(growthPreview)} disabled={!hasPrev}>
                入力する
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {hasPrev ? (
                <>
                  {range.prevLabel}の実績 <Total metric={metric} values={prevValues} /> → <Total metric={metric} values={growthPreview} />
                </>
              ) : (
                `${range.prevLabel}の実績がないため使えません。`
              )}
            </p>
          </section>

          {/* 2. 全月に同じ額 */}
          <section className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="quick-same">全月に同じ{money ? "額" : "人数"}</Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id="quick-same"
                decimal={money}
                value={same}
                onChange={(e) => setSame(e.target.value)}
                placeholder={money ? "1,000,000" : "10"}
                className="w-40 text-right"
              />
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => onApply(samePreview)}>
                入力する
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {count} か月すべてに同じ{money ? "額" : "人数"}を入れます（{money ? "合計 " : "月平均 "}
              <Total metric={metric} values={samePreview} />）。
            </p>
          </section>

          {/* 3. 合計から等分 */}
          <section className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="quick-total">{money ? `${range.label}の合計から等分` : `${range.label}の延べ人数から等分`}</Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id="quick-total"
                decimal={money}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder={money ? "12,000,000" : "120"}
                className="w-40 text-right"
              />
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => onApply(totalPreview)}>
                入力する
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {count} で割って各月に入れます。端数は最後の月（{lastMonth ? formatMonthJa(lastMonth) : "—"}）で調整するので、合計はきっちり合います。
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
