import { canEdit, requireStaff } from "@/lib/auth/session";
import { isMonthClosed, loadDailyReports, loadDayStatus, loadMasters, loadVehicles, loadWorkDayEntries } from "@/lib/db/queries";
import { monthFromParam } from "@/lib/month";
import { dayTabFromParam } from "@/lib/schemas/daily";
import { DailyView } from "@/components/daily/daily-view";
import type { DailyChoices } from "@/components/daily/roll-call-dialog";

export const metadata = { title: "日報・点呼" };

/**
 * 日報・点呼（/daily）
 * 稼動月は ?m=YYYY-MM、タブは ?tab=reports|entries。
 * 件数は DB ビュー v_day_status（稼働日数・承認待ち・点呼が無い日）を使う。
 */
export default async function DailyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const tab = dayTabFromParam(sp.tab);
  const { supabase, profile, company } = await requireStaff();

  const [reports, entries, status, closed] = await Promise.all([
    loadDailyReports(supabase, company.id, { month }),
    loadWorkDayEntries(supabase, company.id, { month, status: "all" }),
    loadDayStatus(supabase, company.id, month),
    isMonthClosed(supabase, company.id, month),
  ]);

  const editable = canEdit(profile.role) && !closed;
  // ダイアログの選択肢は編集できるときだけ読み込む
  const [masters, vehicles] = await Promise.all([
    editable ? loadMasters(supabase, company.id, { activeOnly: true }) : null,
    editable ? loadVehicles(supabase, company.id, { activeOnly: true }) : null,
  ]);
  const choices: DailyChoices = {
    drivers: (masters?.drivers ?? []).map((d) => ({ id: d.id, name: d.name })),
    vehicles: (vehicles ?? []).flatMap((v) => (v.id ? [{ id: v.id, plate: v.plate ?? "" }] : [])),
  };

  return (
    <DailyView
      month={month}
      tab={tab}
      reports={reports}
      entries={entries}
      status={{
        workDayCount: Number(status?.work_day_count ?? 0),
        pendingCount: Number(status?.pending_count ?? 0),
        rollCallMissingCount: Number(status?.roll_call_missing_count ?? 0),
      }}
      choices={choices}
      editable={editable}
      closed={closed}
    />
  );
}
