import { Download } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadClients } from "@/lib/db/queries";
import { formatMonthJa, monthFromParam, monthToDate } from "@/lib/month";
import { exportUrls } from "@/lib/exports/urls";
import { sumMoney } from "@/lib/calc/money";
import { paymentRuleLabel } from "@/lib/schemas/clients";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { InvoicesTable, type InvoiceListItem } from "@/components/invoices/invoices-table";
import { cn } from "@/lib/utils";

export const metadata = { title: "請求書" };

/** 合計カードの 1 枚 */
function TotalCard({ label, value, description }: { label: string; value: number; description?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold">
          <Money value={value} />
        </p>
        {description && <CardDescription className="mt-1 text-xs">{description}</CardDescription>}
      </CardContent>
    </Card>
  );
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const monthDate = monthToDate(month);

  const [clients, summaryRes, invoiceRes] = await Promise.all([
    loadClients(supabase, company.id),
    supabase.from("v_client_month_summary").select("*").eq("company_id", company.id).eq("month", monthDate),
    supabase.from("v_invoice_list").select("*").eq("company_id", company.id).eq("month", monthDate).order("client_sort_order").order("invoice_no"),
  ]);
  if (summaryRes.error) throw summaryRes.error;
  if (invoiceRes.error) throw invoiceRes.error;

  const summaries = new Map((summaryRes.data ?? []).filter((s) => s.client_id).map((s) => [s.client_id as string, s]));
  const invoices = new Map((invoiceRes.data ?? []).filter((i) => i.client_id && i.id).map((i) => [i.client_id as string, i]));

  // 有効な取引先 ＋ その月に売上か請求書がある取引先（停止中も含む）
  const rows: InvoiceListItem[] = clients
    .filter((c) => c.is_active || summaries.has(c.id) || invoices.has(c.id))
    .map((c) => {
      const s = summaries.get(c.id);
      const inv = invoices.get(c.id);
      return {
        clientId: c.id,
        clientName: c.name,
        honorific: c.honorific ?? "",
        isActive: c.is_active,
        paymentRule: paymentRuleLabel(c.payment_month_offset, c.payment_day),
        bill: Number(s?.bill ?? 0),
        entryCount: Number(s?.entry_count ?? 0),
        invoice: inv
          ? {
              id: inv.id ?? "",
              invoiceNo: inv.invoice_no ?? "",
              status: inv.status ?? "draft",
              subtotal: Number(inv.subtotal ?? 0),
              total: Number(inv.total ?? 0),
              dueDate: inv.due_date ?? null,
              paidOn: inv.paid_on ?? null,
              itemCount: Number(inv.item_count ?? 0),
            }
          : null,
      };
    });

  const totalBilled = sumMoney(rows.map((r) => r.invoice?.total ?? 0));
  const totalPaid = sumMoney(rows.map((r) => (r.invoice?.status === "paid" ? r.invoice.total : 0)));
  const totalUnpaid = sumMoney([totalBilled, -totalPaid]);
  const editable = canEdit(profile.role);

  return (
    <div>
      <PageHeader
        title="請求書"
        description={`${formatMonthJa(month)} の取引先ごとの売上と請求書`}
        actions={
          <a href={exportUrls.invoicesCsv(month)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Download className="h-4 w-4" />
            CSV
          </a>
        }
      />

      {clients.length === 0 ? (
        <Empty title="取引先が登録されていません" description="請求書は取引先ごとに作ります。まず取引先を登録し、案件に取引先を設定してください。">
          <MonthLink href="/settings/clients" className={cn(buttonVariants({ size: "sm" }), "mt-2")}>
            設定 → 取引先へ
          </MonthLink>
        </Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            <TotalCard label="請求金額（税込）" value={totalBilled} />
            <TotalCard label="入金済み" value={totalPaid} />
            <TotalCard label="未入金" value={totalUnpaid} description="下書き・発行済みの合計" />
          </div>

          <InvoicesTable rows={rows} month={month} canEdit={editable} />

          <p className="mt-3 text-xs text-muted-foreground">
            売上は取引先を設定した案件の稼働のみ集計します（設定 → 案件・単価で取引先を選んでください）。請求金額は税込、売上は税抜です。
          </p>
        </>
      )}
    </div>
  );
}
