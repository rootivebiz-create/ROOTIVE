"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveInvoiceAction } from "@/lib/actions/invoices";
import type { InvoiceData } from "@/lib/invoice";
import type { InvoiceFormInput } from "@/lib/schemas/invoices";

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

/** 請求書番号・発行日・入金予定日・備考の編集（発行済みでも変更できる） */
export function InvoiceMetaForm({ invoice, canEdit }: { invoice: InvoiceData; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [f, setF] = useState({
    invoice_no: invoice.invoiceNo,
    issue_date: invoice.issueDate,
    due_date: invoice.dueDate ?? "",
    note: invoice.note,
  });
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const submit = () => {
    const input: InvoiceFormInput = { id: invoice.id, ...f };
    startTransition(async () => {
      const res = await saveInvoiceAction(input);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>請求書の情報</CardTitle>
          <CardDescription>閲覧のみです（編集権限がありません）。</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">請求書番号</dt>
            <dd>{invoice.invoiceNo}</dd>
            <dt className="text-muted-foreground">発行日</dt>
            <dd>{invoice.issueDateLabel}</dd>
            <dt className="text-muted-foreground">入金予定日</dt>
            <dd>{invoice.dueDateLabel ?? "—"}</dd>
          </dl>
          {invoice.note && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{invoice.note}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>請求書の情報</CardTitle>
        <CardDescription>備考は PDF・印刷の下部に出ます（振込先など）。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {errors._ && <Alert variant="destructive">{errors._[0]}</Alert>}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-no">請求書番号</Label>
              <Input id="invoice-no" value={f.invoice_no} onChange={(e) => set({ invoice_no: e.target.value })} disabled={pending} maxLength={50} autoComplete="off" required />
              <FieldError messages={errors.invoice_no} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-issue">発行日</Label>
              <Input id="invoice-issue" type="date" value={f.issue_date} onChange={(e) => set({ issue_date: e.target.value })} disabled={pending} required />
              <FieldError messages={errors.issue_date} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-due">入金予定日（お支払い期限）</Label>
              <Input id="invoice-due" type="date" value={f.due_date} onChange={(e) => set({ due_date: e.target.value })} disabled={pending} />
              <FieldError messages={errors.due_date} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-note">備考</Label>
            <Textarea id="invoice-note" value={f.note} onChange={(e) => set({ note: e.target.value })} disabled={pending} maxLength={2000} rows={3} placeholder="お振込先：〇〇銀行 〇〇支店 普通 1234567" />
            <FieldError messages={errors.note} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存する"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
