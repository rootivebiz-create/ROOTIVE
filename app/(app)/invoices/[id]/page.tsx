import { notFound } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadInvoiceData } from "@/lib/invoice";
import { exportUrls } from "@/lib/exports/urls";
import { uuidSchema } from "@/lib/schemas/common";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { InvoiceItemsEditor } from "@/components/invoices/invoice-items-editor";
import { InvoiceMetaForm } from "@/components/invoices/invoice-meta-form";
import { InvoiceStatusActions } from "@/components/invoices/invoice-status-actions";
import { InvoiceStatusBadge } from "@/components/invoices/status-badge";
import { InvoiceMailCard, type InvoiceSendRow } from "@/components/invoices/invoice-mail";
import { isMailEnabled } from "@/lib/mail/send";
import { cn } from "@/lib/utils";

export const metadata = { title: "請求書" };

/** 概要カードの 1 項目 */
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, profile, company } = await requireStaff();

  const invoice = await loadInvoiceData(supabase, company.id, id);
  if (!invoice) notFound();

  const editable = canEdit(profile.role);
  // メールで送った記録（0028。新しい順に 10 件）
  const sendsRes = await supabase
    .from("invoice_sends")
    .select("id, to_email, status, error, sent_at, sent_by_name")
    .eq("company_id", company.id)
    .eq("invoice_id", invoice.id)
    .order("sent_at", { ascending: false })
    .limit(10);
  const sends: InvoiceSendRow[] = (sendsRes.data ?? []).map((r) => ({
    id: r.id,
    toEmail: r.to_email,
    status: r.status === "failed" ? "failed" : "sent",
    error: r.error ?? "",
    sentAt: r.sent_at,
    sentByName: r.sent_by_name ?? "",
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`請求書 ${invoice.invoiceNo}`}
        description={`${invoice.client.name} ${invoice.client.honorific} / ${invoice.monthLabel}`}
        actions={
          <>
            <InvoiceStatusBadge status={invoice.status} />
            <a href={exportUrls.invoicePdf(invoice.id)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              PDF
            </a>
            <MonthLink href={exportUrls.invoicePrint(invoice.id)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Printer className="h-4 w-4" />
              印刷
            </MonthLink>
            <MonthLink href="/invoices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <ArrowLeft className="h-4 w-4" />
              一覧
            </MonthLink>
          </>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">ご請求金額（税込）</p>
              <p className="text-2xl font-bold">
                <Money value={invoice.total} />
              </p>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
              <Item label="小計（税抜）">
                <Money value={invoice.subtotal} />
              </Item>
              <Item label={`消費税（${invoice.taxRateLabel}）`}>
                <Money value={invoice.tax} />
              </Item>
              <Item label="発行日">{invoice.issueDateLabel}</Item>
              <Item label="入金予定日">{invoice.dueDateLabel ?? "—"}</Item>
            </dl>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {invoice.paidOnLabel ? `入金日 ${invoice.paidOnLabel}` : `入金予定日の設定：${invoice.client.paymentRuleLabel}`}
            {invoice.client.invoiceRegNo ? ` / 取引先の登録番号 ${invoice.client.invoiceRegNo}` : ""}
          </p>
        </CardContent>
      </Card>

      <InvoiceMailCard invoice={invoice} companyName={company.name} sends={sends} editable={editable} mailEnabled={isMailEnabled()} />

      {editable && <InvoiceStatusActions invoice={invoice} />}

      <InvoiceItemsEditor invoice={invoice} canEdit={editable && invoice.status === "draft"} />

      <InvoiceMetaForm invoice={invoice} canEdit={editable} />
    </div>
  );
}
