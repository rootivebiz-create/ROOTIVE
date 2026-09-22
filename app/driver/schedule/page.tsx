import { requireDriver } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { ScheduleView, type ScheduleDay } from "@/components/driver/schedule-view";
import { dateRange } from "@/lib/dispatch/board";
import { unitSuffix } from "@/components/entries/helpers";
import { addDays, todayJST } from "@/lib/daily/helpers";
import type { DayOffStatus } from "@/lib/db/types";
import type { Unit } from "@/lib/calc";

export const metadata = { title: "予定" };

/** これから何日ぶんを見せるか */
const DAYS = 14;

export default async function DriverSchedulePage() {
  const { supabase, company, driverId } = await requireDriver();
  const today = todayJST();
  const to = addDays(today, DAYS - 1);

  const [dispatchRes, offsRes] = await Promise.all([
    supabase.from("v_dispatch_list").select("*").eq("company_id", company.id).eq("driver_id", driverId).gte("on_date", today).lte("on_date", to).order("on_date"),
    supabase.from("v_day_off_list").select("*").eq("company_id", company.id).eq("driver_id", driverId).gte("on_date", today).lte("on_date", to),
  ]);

  const days: ScheduleDay[] = dateRange(today, DAYS).map((date) => {
    const mine = (dispatchRes.data ?? []).filter((r) => r.on_date === date && r.status !== "cancelled");
    const off = (offsRes.data ?? []).find((o) => o.on_date === date);
    return {
      date,
      items: mine.map((r) => ({
        label: `${r.project_name ?? ""}${r.item_name && r.item_name !== "標準" ? `（${r.item_name}）` : ""}`,
        qtyPlan: Number(r.qty_plan ?? 0),
        unitSuffix: unitSuffix((r.unit ?? "day") as Unit),
        confirmed: r.status === "confirmed",
      })),
      off: off ? { status: (off.status ?? "requested") as DayOffStatus, reason: off.reason ?? "" } : null,
    };
  });

  return (
    <div>
      <PageHeader title="予定" description="これから 2 週間の配車です。休みの申請もここからできます。" />
      <ScheduleView days={days} today={today} />
    </div>
  );
}
