"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Landmark, Plus, TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LOAN_STATUS_LABELS, type LoanPaymentRow, type LoanRow, type LoanStatus } from "@/lib/db/types";
import { formatDateJa } from "@/lib/month";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loanProgress, loanSummary, monthlyPaymentOf, paymentDayLabel, sortLoans } from "@/lib/finance/loans";
import { LoanDialog } from "./loan-dialog";
import { LoanSchedule } from "./loan-schedule";

export interface LoansPanelProps {
  loans: LoanRow[];
  /** 今期の返済予定（要約カードに使う） */
  periodPayments: LoanPaymentRow[];
  /** 今期（lib/fiscal の periodDateRange ＋ 見出し「第3期（2025年10月〜2026年9月）」） */
  period: { from: string; to: string; title: string };
  /** ?loan= で選ばれている借入 */
  selectedLoanId: string | null;
  /** 選ばれている借入の返済予定（全期間） */
  schedule: LoanPaymentRow[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** owner / admin */
  canEdit: boolean;
}

const STATUS_VARIANT: Record<LoanStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  paid: "secondary",
  planned: "outline",
};

function StatusBadge({ status }: { status: LoanStatus | null }) {
  const s: LoanStatus = status ?? "active";
  return <Badge variant={STATUS_VARIANT[s]}>{LOAN_STATUS_LABELS[s]}</Badge>;
}

function dateText(date: string | null): string {
  return date ? formatDateJa(date) : "—";
}

export function LoansPanel({ loans, periodPayments, period, selectedLoanId, schedule, today, canEdit }: LoansPanelProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [editing, setEditing] = useState<LoanRow | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => sortLoans(loans) as LoanRow[], [loans]);
  const summary = useMemo(() => loanSummary(loans, periodPayments, today, period), [loans, periodPayments, today, period]);
  const selected = useMemo(() => loans.find((l) => l.id === selectedLoanId) ?? null, [loans, selectedLoanId]);

  /** 借入を選ぶ（?loan=）。ほかのパラメータは引き継ぐ */
  const loanHref = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", "loans");
    if (id) sp.set("loan", id);
    else sp.delete("loan");
    return `${pathname}?${sp.toString()}`;
  };

  const cards = [
    { label: "借入残高", value: summary.remainingTotal, hint: `返済中 ${summary.activeCount} 件` },
    { label: "今月の返済", value: summary.thisMonthTotal, hint: "期日が今月の合計" },
    { label: "今期の返済", value: summary.periodTotal, hint: `期日が${period.title}の合計` },
    { label: "支払利息の合計", value: summary.interestTotal, hint: "返済予定にある利息" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="p-3 md:p-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-4 md:pt-0">
              <p className="text-base font-semibold">
                <Money value={c.value} />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary.overdueCount > 0 && (
        <Alert variant="destructive">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4" />
            期日を過ぎた未返済が {summary.overdueCount} 件（<Money value={summary.overdueTotal} />）
          </p>
          <p className="mt-1">返済が済んでいれば、返済予定の「返済済み」を押して記録してください。</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          借入 <span className="num font-semibold text-foreground">{loans.length}</span> 件
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> 借入を追加
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty
          title="まだ借入が登録されていません"
          description={
            canEdit
              ? "「借入を追加」から、借入額・年利・返済回数を入れてください。元利均等の返済予定が自動で作られ、資金繰りにも反映されます。"
              : "管理者が登録すると、残高と返済予定がここに出ます。"
          }
        >
          <Landmark className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード表示 */}
          <ul className="space-y-2 md:hidden">
            {rows.map((l) => (
              <li key={l.id} className={cn("rounded-lg border border-border bg-card p-3 shadow-sm", l.id === selectedLoanId && "ring-2 ring-ring")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{l.name ?? ""}</p>
                    <p className="break-words text-sm text-muted-foreground">{l.lender || "借入先の記載なし"}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">借入額</dt>
                  <dd className="text-right">
                    <Money value={l.principal} />
                  </dd>
                  <dt className="text-muted-foreground">残高</dt>
                  <dd className="text-right">
                    <Money value={l.remaining_principal} />
                  </dd>
                  <dt className="text-muted-foreground">年利</dt>
                  <dd className="num text-right">{pct(l.annual_rate ?? 0)}</dd>
                  <dt className="text-muted-foreground">毎月の返済</dt>
                  <dd className="text-right">
                    <Money value={monthlyPaymentOf(l)} />
                  </dd>
                  <dt className="text-muted-foreground">次回</dt>
                  <dd className="num text-right">{dateText(l.next_due_on)}</dd>
                  <dt className="text-muted-foreground">完済予定</dt>
                  <dd className="num text-right">{dateText(l.final_due_on)}</dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={loanHref(l.id)} className="text-sm text-primary underline-offset-2 hover:underline">
                    返済予定を見る
                  </Link>
                  {canEdit && (
                    <button type="button" className="ml-auto text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(l)}>
                      編集
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* PC：表 */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">借入</TableHead>
                  <TableHead>借入先</TableHead>
                  <TableHead className="text-right">借入額</TableHead>
                  <TableHead className="text-right">年利</TableHead>
                  <TableHead className="text-right">残高</TableHead>
                  <TableHead className="text-right">次回返済</TableHead>
                  <TableHead className="text-right">完済予定</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id} className={cn(l.id === selectedLoanId && "bg-muted/60")}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{l.name ?? ""}</span>
                        <StatusBadge status={l.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        返済 {paymentDayLabel(l.payment_day)}・{l.months ?? 0} 回・進み {pct(loanProgress(l))}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.lender || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Money value={l.principal} />
                    </TableCell>
                    <TableCell className="num text-right">{pct(l.annual_rate ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <Money value={l.remaining_principal} />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-right">
                      {dateText(l.next_due_on)}
                      {l.next_total != null && l.next_due_on && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          <Money value={l.next_total} className="inline" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-right">{dateText(l.final_due_on)}</TableCell>
                    <TableCell className="whitespace-nowrap pr-4 text-right">
                      <Link href={loanHref(l.id)} className="text-sm text-primary underline-offset-2 hover:underline">
                        返済予定
                      </Link>
                      {canEdit && (
                        <button type="button" className="ml-3 text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(l)}>
                          編集
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {selected && <LoanSchedule loan={selected} payments={schedule} today={today} canEdit={canEdit} closeHref={loanHref(null)} />}

      {canEdit && (
        <>
          <LoanDialog open={creating} onOpenChange={setCreating} loan={null} today={today} />
          <LoanDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} loan={editing} today={today} />
        </>
      )}
    </div>
  );
}
