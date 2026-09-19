"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Sparkles, Target } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { NumberInput } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseNumberInput } from "@/lib/calc/parse";
import { formatMonthJa } from "@/lib/month";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveYearTargetsAction } from "@/lib/actions/finance";
import type { YearTargetRowInput } from "@/lib/schemas/finance";
import {
  BUDGET_METRICS,
  BUDGET_METRIC_HINTS,
  BUDGET_METRIC_LABELS,
  budgetTotalCompare,
  compareBudget,
  diffLabel,
  hasAnyTarget,
  isMoneyMetric,
  totalLabel,
  type BudgetLevel,
  type BudgetMetric,
  type BudgetRow,
} from "@/lib/finance/budget";
import { FinanceYearSelector } from "./year-selector";
import { QuickFillDialog } from "./quick-fill-dialog";

export interface BudgetPanelProps {
  year: number;
  years: number[];
  /** その年の 12 か月（目標と実績） */
  rows: BudgetRow[];
  /** 前年の 12 か月（「前年実績 ＋ ◯%」に使う） */
  prevRows: BudgetRow[];
  /** owner / admin */
  canEdit: boolean;
}

/** 入力欄の中身（月 → 指標 → 文字列） */
type Draft = Record<string, Record<BudgetMetric, string>>;

const LEVEL_TEXT: Record<BudgetLevel, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  none: "text-muted-foreground",
};

function numberText(v: number): string {
  return v === 0 ? "" : String(v);
}

function toDraft(rows: BudgetRow[]): Draft {
  const draft: Draft = {};
  for (const r of rows) {
    draft[r.month] = {
      bill: numberText(r.target.bill),
      profit: numberText(r.target.profit),
      expense: numberText(r.target.expense),
      driver: numberText(r.target.driver),
    };
  }
  return draft;
}

function draftValue(draft: Draft, month: string, metric: BudgetMetric): number {
  return parseNumberInput(draft[month]?.[metric] ?? "") ?? 0;
}

/** 指標に合わせた値の表示 */
function Value({ metric, value, className }: { metric: BudgetMetric; value: number; className?: string }) {
  if (isMoneyMetric(metric)) return <Money value={value} className={className} showZeroAsDash />;
  return <span className={cn("num", value === 0 && "text-muted-foreground", className)}>{value === 0 ? "—" : `${value} 人`}</span>;
}

/** 差の表示（プラスは ＋ を付ける） */
function DiffValue({ metric, value }: { metric: BudgetMetric; value: number }) {
  if (value === 0) return <span className="num text-muted-foreground">±0</span>;
  if (isMoneyMetric(metric)) {
    return (
      <span className="num">
        {value > 0 ? "+" : ""}
        <Money value={value} className="inline" />
      </span>
    );
  }
  return <span className={cn("num", value < 0 && "neg")}>{`${value > 0 ? "+" : ""}${value} 人`}</span>;
}

export function BudgetPanel({ year, years, rows, prevRows, canEdit }: BudgetPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [metric, setMetric] = useState<BudgetMetric>("bill");
  const [initial, setInitial] = useState<Draft>(() => toDraft(rows));
  const [draft, setDraft] = useState<Draft>(() => toDraft(rows));
  const [quickOpen, setQuickOpen] = useState(false);

  // 入力中の目標をそのまま予実対比に反映する（保存前でも差と達成率が見える）
  const liveRows = useMemo<BudgetRow[]>(
    () =>
      rows.map((r) => ({
        ...r,
        target: {
          bill: draftValue(draft, r.month, "bill"),
          profit: draftValue(draft, r.month, "profit"),
          expense: draftValue(draft, r.month, "expense"),
          driver: draftValue(draft, r.month, "driver"),
        },
      })),
    [rows, draft],
  );

  const dirty = useMemo(() => JSON.stringify(initial) !== JSON.stringify(draft), [initial, draft]);
  const totals = useMemo(() => BUDGET_METRICS.map((m) => ({ metric: m, compare: budgetTotalCompare(liveRows, m) })), [liveRows]);
  const totalCompare = useMemo(() => budgetTotalCompare(liveRows, metric), [liveRows, metric]);
  const empty = !hasAnyTarget(liveRows);

  const setCell = (month: string, m: BudgetMetric, value: string) => {
    setDraft((d) => ({ ...d, [month]: { ...d[month], [m]: value } }));
  };

  /** かんたん入力：選んでいる指標の 12 か月ぶんをまとめて入れ替える */
  const applySeries = (values: number[]) => {
    setDraft((d) => {
      const next: Draft = { ...d };
      rows.forEach((r, i) => {
        next[r.month] = { ...next[r.month], [metric]: numberText(values[i] ?? 0) };
      });
      return next;
    });
    setQuickOpen(false);
    toast.success(`${BUDGET_METRIC_LABELS[metric]}の目標を入力しました。内容を確かめて保存してください。`);
  };

  const save = () => {
    const input: YearTargetRowInput[] = rows.map((r) => ({
      month: r.month,
      bill_target: draftValue(draft, r.month, "bill"),
      profit_target: draftValue(draft, r.month, "profit"),
      expense_target: draftValue(draft, r.month, "expense"),
      driver_target: draftValue(draft, r.month, "driver"),
    }));
    startTransition(async () => {
      const res = await saveYearTargetsAction({ year, rows: input });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setInitial(draft);
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  const reset = () => setDraft(initial);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FinanceYearSelector year={year} years={years} />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setQuickOpen(true)} disabled={pending}>
              <Sparkles /> かんたん入力
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
                取り消す
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={pending || !dirty}>
              <Save /> {pending ? "保存中…" : "まとめて保存"}
            </Button>
          </div>
        )}
      </div>

      {/* 年間の予実（4 指標） */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {totals.map(({ metric: m, compare }) => (
          <Card
            key={m}
            role="button"
            tabIndex={0}
            aria-pressed={m === metric}
            className={cn("cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", m === metric && "ring-2 ring-ring")}
            onClick={() => setMetric(m)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMetric(m);
              }
            }}
          >
            <CardHeader className="p-3 md:p-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {BUDGET_METRIC_LABELS[m]}（{totalLabel(m)}）
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
              <p className="text-base font-semibold">
                <Value metric={m} value={compare.actual} />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                目標 <Value metric={m} value={compare.target} />
              </p>
              <p className={cn("mt-0.5 text-xs font-semibold", LEVEL_TEXT[compare.level])}>
                {compare.achievement == null ? "目標なし" : `達成率 ${pct(compare.achievement)}`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 入力する指標 */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex gap-1 rounded-md bg-muted p-1">
          {BUDGET_METRICS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={m === metric}
              className={cn(
                "whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                m === metric && "bg-card text-foreground shadow",
              )}
            >
              {BUDGET_METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{BUDGET_METRIC_HINTS[metric]}</p>

      {empty && (
        <Empty
          title={`${year}年の予算がまだ入っていません`}
          description={
            canEdit
              ? "下の表に月ごとの目標を入れて「まとめて保存」を押してください。「かんたん入力」を使うと、前年実績や年間合計から 12 か月ぶんを一度に埋められます。"
              : "管理者が予算を入れると、ここで予実の対比が見られます。"
          }
        >
          <Target className="h-6 w-6 text-muted-foreground" />
        </Empty>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {year}年の{BUDGET_METRIC_LABELS[metric]}（目標と実績）
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">月</TableHead>
                <TableHead className="text-right">目標</TableHead>
                <TableHead className="text-right">実績</TableHead>
                <TableHead className="text-right">差</TableHead>
                <TableHead className="pr-4 text-right">達成率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveRows.map((r) => {
                const c = compareBudget(metric, r.target[metric], r.actual[metric]);
                return (
                  <TableRow key={r.month}>
                    <TableCell className="whitespace-nowrap pl-4 font-medium">
                      {formatMonthJa(r.month).replace(`${year}年`, "")}
                      {r.closed && <span className="ml-1 text-xs text-muted-foreground">締</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit ? (
                        <NumberInput
                          aria-label={`${formatMonthJa(r.month)}の${BUDGET_METRIC_LABELS[metric]}の目標`}
                          decimal={isMoneyMetric(metric)}
                          value={draft[r.month]?.[metric] ?? ""}
                          onChange={(e) => setCell(r.month, metric, e.target.value)}
                          placeholder="0"
                          disabled={pending}
                          className="h-9 w-28 text-right"
                        />
                      ) : (
                        <Value metric={metric} value={c.target} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Value metric={metric} value={c.actual} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <DiffValue metric={metric} value={c.diff} />
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap pr-4 text-right font-semibold", LEVEL_TEXT[c.level])}>
                      {c.achievement == null ? "—" : pct(c.achievement)}
                      {c.achievement != null && <span className="ml-1 text-xs font-normal">{diffLabel(c)}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="whitespace-nowrap pl-4">{totalLabel(metric)}</TableCell>
                <TableCell className="text-right">
                  <Value metric={metric} value={totalCompare.target} />
                </TableCell>
                <TableCell className="text-right">
                  <Value metric={metric} value={totalCompare.actual} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <DiffValue metric={metric} value={totalCompare.diff} />
                </TableCell>
                <TableCell className={cn("whitespace-nowrap pr-4 text-right", LEVEL_TEXT[totalCompare.level])}>
                  {totalCompare.achievement == null ? "—" : pct(totalCompare.achievement)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {canEdit && dirty && (
        <Alert variant="warning">
          <p>入力した目標はまだ保存されていません。「まとめて保存」を押すと 12 か月ぶんをまとめて保存します。</p>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        実績は月次の集計（売上・営業利益・経費・稼働ドライバー数）です。締め済みの月にも目標は入れられます。
      </p>

      {canEdit && (
        <QuickFillDialog
          open={quickOpen}
          onOpenChange={setQuickOpen}
          metric={metric}
          year={year}
          prevRows={prevRows}
          currentValues={rows.map((r) => draftValue(draft, r.month, metric))}
          onApply={applySeries}
        />
      )}
    </div>
  );
}
