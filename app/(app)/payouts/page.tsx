import { Download, Lock } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { isMonthClosed } from "@/lib/db/queries";
import { monthFromParam, monthToDate, formatMonthJa } from "@/lib/month";
import { exportUrls } from "@/lib/exports/urls";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PayoutsTable, type PayoutRow } from "@/components/payouts/payouts-table";
import { cn } from "@/lib/utils";
import { MonthLink } from "@/components/layout/month-link";

export const metadata = { title: "支払明細" };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const [rowsRes, closed, activeRes] = await Promise.all([
    supabase
      .from("v_driver_month_summary")
      .select("*")
      .eq("company_id", company.id)
      .eq("month", monthToDate(month))
      .order("driver_sort_order")
      .order("driver_name"),
    isMonthClosed(supabase, company.id, month),
    supabase.from("drivers").select("id, name").eq("company_id", company.id).eq("is_active", true).order("sort_order").order("name"),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  if (activeRes.error) throw activeRes.error;
  const listed = new Set((rowsRes.data ?? []).map((r) => r.driver_id));
  // 稼働も管理費・調整も無い稼働中ドライバー（締め済み月では登録できないので出さない）
  const missingDrivers = closed ? [] : (activeRes.data ?? []).filter((d) => !listed.has(d.id));

  const rows: PayoutRow[] = (rowsRes.data ?? [])
    .filter((r) => r.driver_id)
    .map((r) => ({
      driverId: r.driver_id ?? "",
      driverName: r.driver_name ?? "",
      isActive: r.driver_is_active ?? true,
      entryCount: Number(r.entry_count ?? 0),
      pay: Number(r.pay ?? 0),
      royalty: Number(r.royalty ?? 0),
      mgmtFee: Number(r.mgmt_fee ?? 0),
      adjPay: Number(r.adj_pay ?? 0),
      payout: Number(r.payout ?? 0),
      tax: Number(r.tax ?? 0),
      payoutIncl: Number(r.payout_incl ?? 0),
      driverProfit: Number(r.driver_profit ?? 0),
    }));

  return (
    <div>
      <PageHeader
        title="支払明細"
        description={`${formatMonthJa(month)} のドライバー別の支払額と会社利益`}
        actions={
          <>
            {closed && (
              <Badge variant="secondary">
                <Lock className="mr-1 h-3 w-3" />
                締め済み
              </Badge>
            )}
            <a href={exportUrls.payoutsCsv(month)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              支払一覧 CSV
            </a>
            <a href={exportUrls.yayoiCsv(month)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              弥生 CSV
            </a>
            {rows.length > 0 && (
              <a href={exportUrls.statementsZip(month)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <Download className="h-4 w-4" />
                全員分の PDF（ZIP）
              </a>
            )}
          </>
        }
      />
      <PayoutsTable rows={rows} />
      <p className="mt-3 text-xs text-muted-foreground">
        行をタップすると支払明細を表示します。支払額は税抜。実際の振込額は税込支払額です。稼働も管理費・調整の登録もないドライバーは表示されません。
      </p>
      {missingDrivers.length > 0 && (
        <details className="mt-3 rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">この月に稼働のない稼働中ドライバー（{missingDrivers.length} 名）の管理費・調整を登録する</summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missingDrivers.map((d) => (
              <li key={d.id}>
                <MonthLink href={`/payouts/${d.id}/statement`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  {d.name}
                </MonthLink>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
