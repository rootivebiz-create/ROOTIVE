"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { buildInvoiceAction } from "@/lib/actions/invoices";
import type { InvoiceStatus } from "@/lib/db/types";
import { formatDateJa } from "@/lib/month";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";

export interface InvoiceRowInvoice {
  id: string;
  invoiceNo: string;
  status: InvoiceStatus;
  subtotal: number;
  total: number;
  dueDate: string | null;
  paidOn: string | null;
  itemCount: number;
}

export interface InvoiceListItem {
  clientId: string;
  clientName: string;
  honorific: string;
  isActive: boolean;
  /** 入金予定日のルール（例: 翌月末日） */
  paymentRule: string;
  /** その月の売上（税抜。取引先を設定した案件の稼働から） */
  bill: number;
  entryCount: number;
  invoice: InvoiceRowInvoice | null;
}

export function InvoicesTable({ rows, month, canEdit }: { rows: InvoiceListItem[]; month: string; canEdit: boolean }) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();
  const [rebuild, setRebuild] = useState<InvoiceListItem | null>(null);

  const detailHref = (id: string) => href(`/invoices/${id}`);

  const build = (clientId: string, opts: { openAfter?: boolean } = {}) =>
    startTransition(async () => {
      const res = await buildInvoiceAction({ client_id: clientId, month });
      setRebuild(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "請求書を作成しました");
      if (opts.openAfter) router.push(detailHref(res.data.id));
      else router.refresh();
    });

  const dueLabel = (r: InvoiceListItem) => (r.invoice?.dueDate ? formatDateJa(r.invoice.dueDate) : `${r.paymentRule}（予定）`);

  const actions = (r: InvoiceListItem) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {r.invoice ? (
        <>
          <Link href={detailHref(r.invoice.id)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            開く
          </Link>
          {canEdit && r.invoice.status === "draft" && (
            <Button variant="ghost" size="sm" onClick={() => setRebuild(r)} disabled={pending}>
              <RefreshCw /> 作り直す
            </Button>
          )}
        </>
      ) : canEdit ? (
        <Button size="sm" onClick={() => build(r.clientId, { openAfter: true })} disabled={pending}>
          <FilePlus2 /> 請求書を作成
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">未作成</span>
      )}
    </div>
  );

  return (
    <>
      {/* スマホ：カード */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <Card key={r.clientId} className={cn("p-3", !r.isActive && "bg-muted/40")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {r.clientName} <span className="text-xs font-normal text-muted-foreground">{r.honorific}</span>
              </span>
              {r.invoice ? <InvoiceStatusBadge status={r.invoice.status} /> : null}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">売上（税抜）</dt>
              <dd className="text-right">
                <Money value={r.bill} />
              </dd>
              <dt className="text-muted-foreground">請求書番号</dt>
              <dd className="text-right text-xs">{r.invoice?.invoiceNo ?? "—"}</dd>
              <dt className="text-muted-foreground">請求金額（税込）</dt>
              <dd className="text-right">{r.invoice ? <Money value={r.invoice.total} /> : <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">入金予定日</dt>
              <dd className="text-right text-xs">{dueLabel(r)}</dd>
              {r.invoice?.paidOn && (
                <>
                  <dt className="text-muted-foreground">入金日</dt>
                  <dd className="text-right text-xs">{formatDateJa(r.invoice.paidOn)}</dd>
                </>
              )}
            </dl>
            <div className="mt-2">{actions(r)}</div>
          </Card>
        ))}
      </div>

      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>取引先</TableHead>
              <TableHead className="text-right">売上（税抜）</TableHead>
              <TableHead>請求書番号</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">請求金額（税込）</TableHead>
              <TableHead>入金予定日</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.clientId} className={cn(!r.isActive && "bg-muted/40 text-muted-foreground")}>
                <TableCell>
                  <span className="font-medium">{r.clientName}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{r.honorific}</span>
                  {r.entryCount > 0 && <p className="mt-0.5 text-xs text-muted-foreground">稼働 {r.entryCount} 行</p>}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.bill} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{r.invoice?.invoiceNo ?? "—"}</TableCell>
                <TableCell>{r.invoice ? <InvoiceStatusBadge status={r.invoice.status} /> : <span className="text-xs text-muted-foreground">未作成</span>}</TableCell>
                <TableCell className="text-right">{r.invoice ? <Money value={r.invoice.total} /> : <span className="num text-muted-foreground">—</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {dueLabel(r)}
                  {r.invoice?.paidOn && <p className="text-xs text-muted-foreground">入金 {formatDateJa(r.invoice.paidOn)}</p>}
                </TableCell>
                <TableCell>{actions(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={rebuild != null} onOpenChange={(o) => !o && setRebuild(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>稼働から作り直しますか？</DialogTitle>
            <DialogDescription>
              「{rebuild?.clientName}」の請求明細をこの月の稼働から作り直します。手で追加・編集した明細は消えます。請求書番号・備考はそのままです。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRebuild(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={() => rebuild && build(rebuild.clientId)} disabled={pending}>
              {pending ? "作成中…" : "作り直す"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
