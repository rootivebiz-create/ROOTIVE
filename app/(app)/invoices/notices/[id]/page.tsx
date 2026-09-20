import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadClients, loadMasters, loadPaymentNotice, loadPaymentNoticeDiff, loadPaymentNoticeItems } from "@/lib/db/queries";
import { exportUrls } from "@/lib/exports/urls";
import { formatMonthJa } from "@/lib/month";
import { explainDiff, noticeDiffSummary } from "@/lib/notices/diff";
import { toNoticeDiffItem, toNoticeListItem, type NoticeItemOption } from "@/lib/notices/view";
import { uuidSchema } from "@/lib/schemas/common";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { NoticeDetail } from "@/components/notices/notice-detail";
import { cn } from "@/lib/utils";

export const metadata = { title: "支払通知の突合" };

/**
 * 支払通知書 1 件の突合（/invoices/notices/[id]）
 * 差は DB のビュー（v_payment_notice_diff）が計算し、説明だけ lib/notices/diff.ts で付ける。
 */
export default async function PaymentNoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const { supabase, profile, company } = await requireStaff();
  const notice = await loadPaymentNotice(supabase, company.id, id);
  if (!notice) notFound();

  const [diffRows, items, clients, masters] = await Promise.all([
    loadPaymentNoticeDiff(supabase, company.id, id),
    loadPaymentNoticeItems(supabase, company.id, id),
    loadClients(supabase, company.id),
    loadMasters(supabase, company.id),
  ]);

  const memoById = new Map(items.map((i) => [i.id, i.memo ?? ""]));
  const rows = diffRows.map((r) => toNoticeDiffItem(r, explainDiff(r), memoById.get(r.id ?? "") ?? ""));
  const summary = noticeDiffSummary(diffRows);
  const view = toNoticeListItem(notice);

  const itemOptions: NoticeItemOption[] = masters.projects.flatMap((p) =>
    p.items.map((i) => ({ id: i.id, name: i.name, projectId: p.id, projectName: p.name, isActive: i.is_active })),
  );

  return (
    <div>
      <PageHeader
        title={`支払通知 ${view.noticeNo || view.clientName || formatMonthJa(view.month)}`}
        description={`${view.clientName || "取引先の指定なし"} / ${view.month ? formatMonthJa(view.month) : ""}`}
        actions={
          <>
            <a href={exportUrls.noticeDiffCsv(view.id)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              CSV
            </a>
            <MonthLink href="/invoices/notices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <ArrowLeft className="h-4 w-4" />
              一覧
            </MonthLink>
          </>
        }
      />

      <NoticeDetail
        notice={view}
        rows={rows}
        summary={summary}
        clients={clients.map((c) => ({ id: c.id, name: c.name, isActive: c.is_active }))}
        itemOptions={itemOptions}
        canEdit={canEdit(profile.role)}
      />
    </div>
  );
}
