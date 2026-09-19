import { requireDriver } from "@/lib/auth/session";
import { isMonthClosed, loadDailyReports, loadDriverDayItems, loadVehicles, loadWorkDayEntries } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/page-header";
import { TodayForm } from "@/components/driver/today-form";
import type { DayHistoryItem } from "@/components/driver/day-history";
import { EDIT_WINDOW_DAYS, addDays, canEditDate, formatWorkDate, isWorkDate, monthsOfDates, recentDates, summarizeDay, todayJST } from "@/lib/daily/helpers";

export const metadata = { title: "今日の報告" };

/** 履歴に出す日数 */
const HISTORY_DAYS = 7;

/**
 * ドライバーの「今日の報告」（/driver/today?d=YYYY-MM-DD）
 * 既定は今日。過去 14 日まで戻れる（締め済みの月は変更できない）。
 */
export default async function DriverTodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, company, driverId, profile } = await requireDriver();

  const today = todayJST();
  const dateOptions = recentDates(today, EDIT_WINDOW_DAYS + 1);
  const raw = Array.isArray(sp.d) ? sp.d[0] : sp.d;
  const date = isWorkDate(raw) && dateOptions.includes(raw) ? raw : today;

  // 選べる日（今日〜14 日前）と選択中の日が含まれる月ぶんだけ読む
  const months = monthsOfDates([addDays(today, -EDIT_WINDOW_DAYS), today, date]);

  const [items, vehicles, reportsByMonth, entriesByMonth, closedByMonth] = await Promise.all([
    loadDriverDayItems(supabase),
    loadVehicles(supabase, company.id, { activeOnly: true }),
    Promise.all(months.map((m) => loadDailyReports(supabase, company.id, { month: m, driverId, limit: 100 }))),
    Promise.all(months.map((m) => loadWorkDayEntries(supabase, company.id, { month: m, driverId, status: "all", limit: 500 }))),
    Promise.all(months.map((m) => isMonthClosed(supabase, company.id, m))),
  ]);

  const reports = reportsByMonth.flat();
  const entries = entriesByMonth.flat();
  const closedMonths = months.filter((_, i) => closedByMonth[i]);

  const report = reports.find((r) => r.work_date === date) ?? null;
  const dayEntries = entries.filter((e) => e.work_date === date);

  const history: DayHistoryItem[] = recentDates(today, HISTORY_DAYS).map((d) => {
    const r = reports.find((x) => x.work_date === d) ?? null;
    const s = summarizeDay(entries.filter((e) => e.work_date === d));
    return { date: d, pre: !!r?.pre_at, post: !!r?.post_at, qtyTotal: s.qtyTotal, itemCount: s.submitted + s.approved };
  });

  const editable = canEditDate(date, today, closedMonths);
  const lockedReason = closedMonths.includes(date.slice(0, 7))
    ? "この月は締め済みのため変更できません。担当者にご連絡ください。"
    : `報告できるのは ${EDIT_WINDOW_DAYS} 日前までです。担当者にご連絡ください。`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="今日の報告"
        description={`${profile.display_name || ""} 様 ／ ${formatWorkDate(date)} の出発前・稼働・終了後を記録します。`}
        className="mb-0"
      />
      <TodayForm
        today={today}
        date={date}
        dateOptions={dateOptions}
        report={report}
        entries={dayEntries}
        items={items}
        vehicles={vehicles.flatMap((v) => (v.id ? [{ id: v.id, plate: v.plate ?? "" }] : []))}
        history={history}
        editable={editable}
        lockedReason={lockedReason}
      />
    </div>
  );
}
