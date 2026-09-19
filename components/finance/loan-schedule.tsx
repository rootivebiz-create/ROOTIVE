"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { regenerateLoanScheduleAction, setLoanPaymentPaidAction } from "@/lib/actions/finance";
import { isOverduePayment, sortPayments } from "@/lib/finance/loans";
import type { LoanPaymentRow, LoanRow } from "@/lib/db/types";
import { formatDateJa } from "@/lib/month";
import { cn } from "@/lib/utils";

export interface LoanScheduleProps {
  loan: LoanRow;
  payments: LoanPaymentRow[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** owner / admin */
  canEdit: boolean;
  /** 「閉じる」のリンク先（?loan= を外した URL） */
  closeHref: string;
}

/** 選んだ借入の返済予定 */
export function LoanSchedule({ loan, payments, today, canEdit, closeHref }: LoanScheduleProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => sortPayments(payments) as LoanPaymentRow[], [payments]);

  const togglePaid = (p: LoanPaymentRow) => {
    if (!p.id) return;
    setBusyId(p.id);
    startTransition(async () => {
      const res = await setLoanPaymentPaidAction(p.id as string, p.paid_on ? null : today);
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "返済の記録を更新しました");
      router.refresh();
    });
  };

  const regenerate = () => {
    if (!loan.id) return;
    if (!window.confirm("未返済の回を作り直します。返済済みにした回はそのまま残ります。よろしいですか？")) return;
    startTransition(async () => {
      const res = await regenerateLoanScheduleAction(loan.id as string);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "返済予定を作り直しました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-sm">{loan.name ?? ""} の返済予定</CardTitle>
          <CardDescription>
            全 {loan.payment_count ?? 0} 回のうち {loan.paid_count ?? 0} 回が返済済みです。
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button size="sm" variant="outline" onClick={regenerate} disabled={pending}>
              <RefreshCw /> 作り直す
            </Button>
          )}
          <Link href={closeHref} aria-label="返済予定を閉じる" className="rounded-sm p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0 md:p-0">
        {rows.length === 0 ? (
          <Empty
            className="m-4"
            title="返済予定がありません"
            description={canEdit ? "「作り直す」を押すと、借入額・年利・回数から元利均等の返済予定を作ります。" : "管理者が作成すると表示されます。"}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">回</TableHead>
                <TableHead>返済日</TableHead>
                <TableHead className="text-right">元金</TableHead>
                <TableHead className="text-right">利息</TableHead>
                <TableHead className="text-right">合計</TableHead>
                <TableHead className="text-right">残高</TableHead>
                <TableHead className="pr-4 text-right">状態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const overdue = isOverduePayment(p, today);
                return (
                  <TableRow key={p.id} className={cn(overdue && "bg-destructive/5")}>
                    <TableCell className="num pl-4">{p.seq ?? 0}</TableCell>
                    <TableCell className={cn("num whitespace-nowrap", overdue && "text-destructive font-semibold")}>{p.due_on ? formatDateJa(p.due_on) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Money value={p.principal} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={p.interest} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <Money value={p.total} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={p.balance} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap pr-4 text-right">
                      {p.paid_on ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge variant="success">返済済み</Badge>
                          {canEdit && (
                            <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => togglePaid(p)} disabled={pending}>
                              戻す
                            </button>
                          )}
                        </span>
                      ) : canEdit ? (
                        <Button size="sm" variant="outline" onClick={() => togglePaid(p)} disabled={pending}>
                          {busyId === p.id ? "処理中…" : "返済済みにする"}
                        </Button>
                      ) : (
                        <Badge variant={overdue ? "destructive" : "secondary"}>{overdue ? "期限切れ" : "未返済"}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
