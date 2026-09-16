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

export const metadata = { title: "支払明細" };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const [rowsRes, closed] = await Promise.all([
    supabase
      .from("v_driver_month_summary")
      .select("*")
      .eq("company_id", company.id)
      .eq("month", monthToDate(month))
      .order("driver_sort_order")
      .order("driver_name"),
    isMonthClosed(supabase, company.id, month),
  ]);
  if (rowsRes.error) throw rowsRes.error;

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
          </>
        }
      />
      <PayoutsTable rows={rows} />
      <p className="mt-3 text-xs text-muted-foreground">行をタップすると支払明細を表示します。稼働も管理費・調整の登録もないドライバーは表示されません。</p>
    </div>
  );
}
