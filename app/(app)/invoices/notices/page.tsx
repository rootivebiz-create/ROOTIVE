import { ArrowLeft } from "lucide-react";
import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadClients, loadPaymentNotices } from "@/lib/db/queries";
import { formatMonthJa, monthFromParam } from "@/lib/month";
import { toNoticeListItem } from "@/lib/notices/view";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { NoticesView } from "@/components/notices/notices-view";
import { cn } from "@/lib/utils";

export const metadata = { title: "支払通知の突合" };

/**
 * 元請の支払通知書の一覧（/invoices/notices）
 * 稼動月（?m=YYYY-MM）を引き継ぎ、既定ではその月の通知だけを出す（画面のボタンで全期間に切り替えられる）。
 */
export default async function PaymentNoticesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const [notices, clients] = await Promise.all([loadPaymentNotices(supabase, company.id, { limit: 200 }), loadClients(supabase, company.id)]);

  return (
    <div>
      <PageHeader
        title="支払通知の突合"
        description={`${formatMonthJa(month)} の元請の支払明細書と自社の売上を突き合わせます`}
        actions={
          <MonthLink href="/invoices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <ArrowLeft className="h-4 w-4" />
            請求書へ
          </MonthLink>
        }
      />

      <NoticesView
        month={month}
        rows={notices.map(toNoticeListItem)}
        clients={clients.map((c) => ({ id: c.id, name: c.name, isActive: c.is_active }))}
        canEdit={canEdit(profile.role)}
      />
    </div>
  );
}
