"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Info, Plus, Settings2, Wand2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { ensureTaxTasksAction, setTaxTaskStatusAction } from "@/lib/actions/finance";
import { TAX_TASK_STATUS_LABELS, TAX_URGENCY_LABELS } from "@/lib/db/types";
import { fiscalMonthLabel, fiscalYearEnd } from "@/lib/finance/date";
import { daysLeftLabel, groupTaxTasks, taxCounts, taxYearLabel, TAX_URGENCIES, TAX_URGENCY_DESCRIPTIONS, type TaxTaskView, type TaxUrgency } from "@/lib/finance/tax";
import { fiscalPeriod, type FiscalSettings } from "@/lib/fiscal";
import { formatDateJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { FinanceYearSelector } from "./year-selector";
import { TaxTaskDialog } from "./tax-task-dialog";

export interface TaxPanelProps {
  year: number;
  years: number[];
  tasks: TaxTaskView[];
  /** 会社設定の決算月と設立日（どの期の決算かを出す。0030） */
  fiscal: FiscalSettings;
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** owner / admin */
  canEdit: boolean;
  /** 会社設定を開けるのはオーナーだけ */
  isOwner: boolean;
}

const URGENCY_VARIANT: Record<TaxUrgency, "destructive" | "warning" | "outline" | "secondary"> = {
  overdue: "destructive",
  soon: "warning",
  future: "outline",
  done: "secondary",
};

export function TaxPanel({ year, years, tasks, fiscal, today, canEdit, isOwner }: TaxPanelProps) {
  const fiscalMonth = fiscal.fiscalMonth;
  const period = fiscalPeriod(year, fiscal);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<TaxTaskView | null>(null);
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => groupTaxTasks(tasks), [tasks]);
  const counts = useMemo(() => taxCounts(tasks), [tasks]);

  const setStatus = (task: TaxTaskView, status: "todo" | "done" | "skipped") => {
    startTransition(async () => {
      const res = await setTaxTaskStatusAction(task.id, status);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "状態を変更しました");
      router.refresh();
    });
  };

  const generate = () => {
    startTransition(async () => {
      const res = await ensureTaxTasksAction(year);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.data.created > 0 ? `${year}年の期限を ${res.data.created} 件作りました` : "新しく作る期限はありませんでした");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* 目安であることの注記（必ず出す） */}
      <Alert>
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            ここに出る期限は<strong>目安</strong>です。特例の有無や提出先によって実際の期限は変わります。
            正確な期限と納付額は必ず顧問税理士に確認してください。
          </span>
        </p>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FinanceYearSelector year={year} years={years} optionLabel={(y) => taxYearLabel(y, fiscal)} />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={generate} disabled={pending}>
              <Wand2 /> この年の期限をまとめて作る
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
              <Plus /> 期限を追加
            </Button>
          </div>
        )}
      </div>

      {/* 決算月 */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <p className="text-sm font-medium">
              決算月：<span className="num">{fiscalMonthLabel(fiscalMonth)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {year}年に決算を迎えるのは{period.label}（{period.rangeLabel}）で、決算日は {formatDateJa(fiscalYearEnd(year, fiscalMonth))} です。期限はこの決算日から組み立てています。
            </p>
          </div>
          {isOwner ? (
            <MonthLink href="/settings/company" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
              <Settings2 className="h-4 w-4" />
              会社設定で変更
            </MonthLink>
          ) : (
            <p className="text-xs text-muted-foreground">決算月の変更はオーナーに依頼してください。</p>
          )}
        </CardContent>
      </Card>

      {/* 件数 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: "未対応", value: `${counts.todo} 件`, tone: "" },
          { label: "期限切れ", value: `${counts.overdue} 件`, tone: counts.overdue > 0 ? "text-destructive" : "" },
          { label: "まもなく", value: `${counts.soon} 件`, tone: counts.soon > 0 ? "text-warning" : "" },
          { label: "済", value: `${counts.done} 件`, tone: "" },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="p-3 md:p-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
              <p className={cn("num text-base font-semibold", c.tone)}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {tasks.length === 0 ? (
        <Empty
          title={`${year}年の期限がまだありません`}
          description={
            canEdit
              ? "「この年の期限をまとめて作る」を押すと、会社設定の決算月から法人税・消費税・源泉所得税などの期限（目安）を作ります。"
              : "管理者が作成すると、決算・税務の期限がここに出ます。"
          }
        >
          <CalendarClock className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        TAX_URGENCIES.filter((u) => groups[u].length > 0).map((u) => (
          <section key={u} className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={URGENCY_VARIANT[u]}>{TAX_URGENCY_LABELS[u] ?? u}</Badge>
              <span className="num text-sm text-muted-foreground">{groups[u].length} 件</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{TAX_URGENCY_DESCRIPTIONS[u]}</span>
            </div>
            <ul className="space-y-2">
              {groups[u].map((t) => (
                <li key={t.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={cn("break-words font-medium", t.status !== "todo" && "text-muted-foreground line-through")}>{t.title}</p>
                      <p className="num mt-0.5 text-sm text-muted-foreground">
                        {formatDateJa(t.dueOn)}
                        <span className={cn("ml-2", t.urgency === "overdue" && "text-destructive", t.urgency === "soon" && "text-warning")}>{daysLeftLabel(t)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={t.status === "todo" ? "outline" : "secondary"}>{TAX_TASK_STATUS_LABELS[t.status]}</Badge>
                      {!t.isGenerated && <span className="text-xs text-muted-foreground">自分で追加</span>}
                    </div>
                  </div>

                  {t.detail && <p className="mt-1.5 break-words text-xs text-muted-foreground">{t.detail}</p>}

                  {(t.amount != null || t.memo) && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      {t.amount != null && (
                        <>
                          <dt className="text-muted-foreground">納付額</dt>
                          <dd className="text-right">
                            <Money value={t.amount} />
                          </dd>
                        </>
                      )}
                      {t.memo && (
                        <>
                          <dt className="text-muted-foreground">メモ</dt>
                          <dd className="break-words text-right">{t.memo}</dd>
                        </>
                      )}
                    </dl>
                  )}

                  {canEdit && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={t.status === "done"}
                          disabled={pending}
                          onCheckedChange={(v) => setStatus(t, v === true ? "done" : "todo")}
                          aria-label={`${t.title}を対応済みにする`}
                        />
                        対応済み
                      </label>
                      <button
                        type="button"
                        className="text-sm text-primary underline-offset-2 hover:underline"
                        onClick={() => setStatus(t, t.status === "skipped" ? "todo" : "skipped")}
                        disabled={pending}
                      >
                        {t.status === "skipped" ? "未対応に戻す" : "対象外にする"}
                      </button>
                      <button type="button" className="ml-auto text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(t)} disabled={pending}>
                        金額・メモを編集
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {canEdit && (
        <>
          <TaxTaskDialog open={creating} onOpenChange={setCreating} task={null} today={today} />
          <TaxTaskDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} task={editing} today={today} />
        </>
      )}
    </div>
  );
}
