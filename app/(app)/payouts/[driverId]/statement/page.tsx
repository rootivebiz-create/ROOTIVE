import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, Printer } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { isMonthClosed } from "@/lib/db/queries";
import { loadStatementData, statementToText } from "@/lib/statement";
import { monthFromParam, monthToDate } from "@/lib/month";
import { exportUrls } from "@/lib/exports/urls";
import { uuidSchema } from "@/lib/schemas/common";
import type { EntryInput } from "@/lib/calc";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { StatementCard, CompanyBreakdownCard } from "@/components/payouts/statement-view";
import { CopyStatementButton } from "@/components/payouts/statement-actions";
import { DriverMonthDialog } from "@/components/payouts/driver-month-dialog";
import { cn } from "@/lib/utils";

export const metadata = { title: "支払明細" };

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, profile, company, access } = await requireStaff();
  const { driverId } = await params;
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  if (!uuidSchema.safeParse(driverId).success) notFound();
  const monthDate = monthToDate(month);

  const [s, closedFlag, listRes, recurringRes, calcRes] = await Promise.all([
    loadStatementData(supabase, company, month, driverId),
    isMonthClosed(supabase, company.id, month),
    supabase
      .from("v_driver_month_summary")
      .select("driver_id, driver_name")
      .eq("company_id", company.id)
      .eq("month", monthDate)
      .order("driver_sort_order")
      .order("driver_name"),
    supabase.from("driver_recurring_adjustments").select("*").eq("driver_id", driverId).eq("is_active", true).order("sort_order").order("created_at"),
    supabase.from("v_work_entry_calc").select("id, qty, bill_rate, pay_rate, royalty_rate, rounding_mode").eq("company_id", company.id).eq("month", monthDate).eq("driver_id", driverId),
  ]);
  if (!s) notFound();
  if (listRes.error) throw listRes.error;
  if (recurringRes.error) throw recurringRes.error;
  if (calcRes.error) throw calcRes.error;

  const closed = closedFlag || s.isClosed;
  const editable = canEdit(profile.role) && !closed;
  // 会社側の内訳（会社売上・会社利益）は経営の数字（事務員には出さない）
  const showProfit = access.management;

  // 調整の recurring_id（固定控除の二重追加を防ぐためダイアログへ渡す）
  const recurringIdByAdjustment = new Map<string, string | null>();
  if (editable && s.driverMonthId) {
    const adjRes = await supabase.from("adjustments").select("id, recurring_id").eq("driver_month_id", s.driverMonthId);
    if (adjRes.error) throw adjRes.error;
    for (const a of adjRes.data ?? []) recurringIdByAdjustment.set(a.id, a.recurring_id);
  }

  // 前後のドライバー（同月の一覧順）
  const list = (listRes.data ?? []).filter((r) => r.driver_id);
  const idx = list.findIndex((r) => r.driver_id === driverId);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  const entriesForCalc: EntryInput[] = (calcRes.data ?? []).map((r) => ({
    qty: Number(r.qty ?? 0),
    billRate: Number(r.bill_rate ?? 0),
    payRate: Number(r.pay_rate ?? 0),
    royaltyRate: Number(r.royalty_rate ?? 0),
    roundingMode: r.rounding_mode ?? company.rounding_mode,
  }));
  const recurring = (recurringRes.data ?? []).map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount), countAsProfit: r.count_as_profit }));
  const text = statementToText(s, { showRoyaltyRate: company.driver_portal_show_royalty });
  const linkCls = cn(buttonVariants({ variant: "outline", size: "sm" }));

  return (
    <div>
      <div className="mb-2">
        <MonthLink href="/payouts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          支払明細一覧へ
        </MonthLink>
      </div>
      <PageHeader
        title={`${s.driverName} 様 ${s.monthLabel} 支払明細`}
        description={closed ? "この月は締め済みです。管理費・調整は変更できません。" : undefined}
        actions={
          <>
            {editable && (
              <DriverMonthDialog
                month={month}
                monthLabel={s.monthLabel}
                driverId={s.driverId}
                driverName={s.driverName}
                mgmtFee={s.mgmtFeeSetting}
                driverDefaultMgmtFee={s.driverDefaultMgmtFee}
                memo={s.memo}
                adjustments={s.adjustments.map((a) => ({ ...a, recurringId: recurringIdByAdjustment.get(a.id) ?? null }))}
                entries={entriesForCalc}
                recurring={recurring}
                tax={{ mode: s.taxMode, rate: s.taxRate, rounding: s.taxRounding }}
                showProfit={showProfit}
              />
            )}
            <CopyStatementButton text={text} />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <a href={exportUrls.statementCsv(month, s.driverId)} download className={linkCls}>
          <Download className="h-4 w-4" />
          個人明細 CSV
        </a>
        <a href={exportUrls.statementPdf(month, s.driverId)} download className={linkCls}>
          <FileText className="h-4 w-4" />
          PDF
        </a>
        <a href={exportUrls.statementPrint(month, s.driverId)} target="_blank" rel="noopener" className={linkCls}>
          <Printer className="h-4 w-4" />
          印刷用ページ
        </a>
      </div>

      <div className={showProfit ? "grid gap-4 lg:grid-cols-[3fr_2fr]" : "grid gap-4"}>
        <StatementCard s={s} editable={editable} />
        {showProfit && <CompanyBreakdownCard s={s} />}
      </div>

      {(prev || next) && (
        <nav className="mt-4 flex items-center justify-between gap-2" aria-label="前後のドライバー">
          {prev ? (
            <MonthLink href={`/payouts/${encodeURIComponent(prev.driver_id ?? "")}/statement`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-w-[48%]")}>
              <ChevronLeft className="h-4 w-4" />
              <span className="truncate">{prev.driver_name}</span>
            </MonthLink>
          ) : (
            <span />
          )}
          {next ? (
            <MonthLink href={`/payouts/${encodeURIComponent(next.driver_id ?? "")}/statement`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-w-[48%]")}>
              <span className="truncate">{next.driver_name}</span>
              <ChevronRight className="h-4 w-4" />
            </MonthLink>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
