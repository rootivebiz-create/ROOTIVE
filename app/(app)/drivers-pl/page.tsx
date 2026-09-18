import { requireStaff } from "@/lib/auth/session";
import { isMonthClosed } from "@/lib/db/queries";
import { addMonths, formatMonthJa, monthFromParam, monthRange, monthToDate } from "@/lib/month";
import { PageHeader } from "@/components/ui/page-header";
import { buildDriverPlRows, buildSimDrivers } from "@/components/drivers-pl/helpers";
import { DriversPlView } from "@/components/drivers-pl/drivers-pl-view";

export const metadata = { title: "ドライバー別の採算" };

/** 推移の期間：当月を含む直近 12 か月（昇順） */
const TREND_MONTHS = 12;

export default async function DriversPlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const from = addMonths(month, -(TREND_MONTHS - 1));
  const months = monthRange(from, month);
  const requestedDriver = Array.isArray(sp.driver) ? sp.driver[0] : sp.driver;

  const [summariesRes, entriesRes, closed] = await Promise.all([
    supabase
      .from("v_driver_month_summary")
      .select("*")
      .eq("company_id", company.id)
      .gte("month", monthToDate(from))
      .lte("month", monthToDate(month))
      .order("month")
      .order("driver_sort_order")
      .order("driver_name"),
    supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("driver_name").order("project_name").order("item_name"),
    isMonthClosed(supabase, company.id, month),
  ]);
  if (summariesRes.error) throw summariesRes.error;
  if (entriesRes.error) throw entriesRes.error;

  const trendSummaries = summariesRes.data ?? [];
  const entries = entriesRes.data ?? [];
  const monthSummaries = trendSummaries.filter((s) => s.month === monthToDate(month));
  const rows = buildDriverPlRows(monthSummaries, entries);
  const simDrivers = buildSimDrivers(monthSummaries, entries);
  const initialDriverId = requestedDriver && rows.some((r) => r.driverId === requestedDriver) ? requestedDriver : (rows[0]?.driverId ?? "");

  return (
    <div>
      <PageHeader
        title="ドライバー別の採算"
        description={`${formatMonthJa(month)} の会社利益・利益率と、単価を変えたときの試算（金額は税抜。ドライバーの手取りのみ税込）`}
      />
      <DriversPlView
        month={month}
        rows={rows}
        entries={entries}
        trendSummaries={trendSummaries}
        trendMonths={months}
        simDrivers={simDrivers}
        initialDriverId={initialDriverId}
        isClosed={closed}
      />
    </div>
  );
}
