"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildInvoiceAction, deleteInvoiceAction, setInvoiceStatusAction } from "@/lib/actions/invoices";
import type { InvoiceData } from "@/lib/invoice";
import { useMonth } from "@/lib/hooks/use-month";

/** 日本時間の今日（YYYY-MM-DD） */
function todayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 状態変更・作り直し・削除（admin 以上） */
export function InvoiceStatusActions({ invoice }: { invoice: InvoiceData }) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(invoice.paidOn ?? todayJST());
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isDraft = invoice.status === "draft";

  const changeStatus = (status: InvoiceData["status"], date?: string) =>
    startTransition(async () => {
      const res = await setInvoiceStatusAction({ id: invoice.id, status, paid_on: date ?? null });
      setPayOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "状態を変更しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  const rebuild = () =>
    startTransition(async () => {
      const res = await buildInvoiceAction({ client_id: invoice.client.id, month: invoice.month });
      setRebuildOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "稼働から作り直しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteInvoiceAction(invoice.id);
      setDeleteOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "削除しました");
        router.push(href("/invoices"));
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>操作</CardTitle>
          <CardDescription>
            {isDraft
              ? "下書きです。稼働から作り直したり、明細を手で直したりできます。内容が確定したら「発行済みにする」。"
              : "発行済みです。明細を直すときは「下書きに戻す」。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {isDraft && (
            <Button variant="outline" onClick={() => setRebuildOpen(true)} disabled={pending}>
              <RefreshCw /> 稼働から作り直す
            </Button>
          )}
          {isDraft && (
            <Button onClick={() => changeStatus("issued")} disabled={pending}>
              <Send /> 発行済みにする
            </Button>
          )}
          {invoice.status !== "paid" && (
            <Button variant={isDraft ? "outline" : "default"} onClick={() => setPayOpen(true)} disabled={pending}>
              <CheckCircle2 /> 入金済みにする
            </Button>
          )}
          {!isDraft && (
            <Button variant="outline" onClick={() => changeStatus("draft")} disabled={pending}>
              <Undo2 /> 下書きに戻す
            </Button>
          )}
          {isDraft && (
            <Button variant="ghost" className="text-destructive" onClick={() => setDeleteOpen(true)} disabled={pending}>
              <Trash2 /> 削除
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 入金済みにする（入金日を選ぶ） */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>入金済みにしますか？</DialogTitle>
            <DialogDescription>
              {invoice.client.name} {invoice.client.honorific} / {invoice.invoiceNo}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-paid-on">入金日</Label>
            <Input id="invoice-paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} disabled={pending} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={() => changeStatus("paid", paidOn)} disabled={pending}>
              {pending ? "変更中…" : "入金済みにする"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 稼働から作り直す */}
      <Dialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>稼働から作り直しますか？</DialogTitle>
            <DialogDescription>{invoice.monthLabel} の稼働から請求明細を作り直します。手で追加・編集した明細は消えます。請求書番号・備考はそのままです。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRebuildOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={rebuild} disabled={pending}>
              {pending ? "作成中…" : "作り直す"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>請求書を削除しますか？</DialogTitle>
            <DialogDescription>
              {invoice.invoiceNo}（{invoice.client.name} {invoice.client.honorific}）と明細を削除します。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
