import { canEdit, canSeeManagement, requireStaff } from "@/lib/auth/session";
import { DispatchView } from "@/components/dispatch/dispatch-view";
import { loadDispatchWeek } from "@/lib/dispatch/queries";
import { weekStart } from "@/lib/dispatch/board";
import { addDays, todayJST } from "@/lib/daily/helpers";
import type { DayOffStatus } from "@/lib/db/types";

export const metadata = { title: "配車" };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DispatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, company, profile } = await requireStaff();

  const today = todayJST();
  const fromParam = str(sp.from);
  const start = DATE_RE.test(fromParam) ? weekStart(fromParam) : weekStart(today);
  const end = addDays(start, 6);

  const data = await loadDispatchWeek(supabase, company.id, start, end);

  // 必要人数タブ（これから先の特定日）と休み希望タブは、週の外も見せたいので別に読む
  const [demandDaysRes, offsRes] = await Promise.all([
    supabase.from("project_demand_days").select("project_item_id, on_date, need, note").eq("company_id", company.id).gte("on_date", today).order("on_date").limit(100),
    supabase.from("v_day_off_list").select("*").eq("company_id", company.id).gte("on_date", addDays(today, -30)).order("on_date").limit(200),
  ]);

  return (
    <DispatchView
      weekStart={start}
      today={today}
      editable={canEdit(profile.role)}
      showProfit={canSeeManagement(profile.role)}
      items={data.items}
      drivers={data.drivers}
      patterns={data.patterns}
      demandDays={data.demandDays}
      assignments={data.assignments}
      dayOffs={data.dayOffs}
      recentQty={data.recentQty}
      demandDayRows={(demandDaysRes.data ?? []).map((d) => ({
        projectItemId: d.project_item_id,
        onDate: d.on_date,
        need: Number(d.need ?? 0),
        note: d.note ?? "",
      }))}
      offRows={(offsRes.data ?? []).map((o) => ({
        id: o.id ?? "",
        driverId: o.driver_id ?? "",
        driverName: o.driver_name ?? "",
        onDate: o.on_date ?? "",
        status: (o.status ?? "requested") as DayOffStatus,
        reason: o.reason ?? "",
      }))}
      tab={str(sp.tab) || "board"}
    />
  );
}
