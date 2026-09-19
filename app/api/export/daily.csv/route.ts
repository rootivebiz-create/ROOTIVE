/**
 * GET /api/export/daily.csv?m=YYYY-MM|all&kind=report|entry
 *  - kind=report：点呼記録簿・業務記録（既定）
 *  - kind=entry：日別の稼働（ドライバー報告と承認状況）
 * スタッフ（owner/admin/viewer）のみ。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import type { ServerSupabase } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import {
  dailyCsvFilename,
  dailyCsvKindFromParam,
  toDailyReportsCsv,
  toDayEntriesCsv,
  type DailyReportCsvSource,
  type DayEntryCsvSource,
} from "@/lib/exports/daily-csv";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** スタッフの表示名（id → 名前）。閲覧できないユーザー（ドライバー本人）は含まれない */
async function loadStaffNames(supabase: ServerSupabase): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("v_staff").select("id, display_name");
  if (error) throw error;
  const map = new Map<string, string>();
  for (const s of data ?? []) {
    if (s.id) map.set(s.id, s.display_name ?? "");
  }
  return map;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });
  const kind = dailyCsvKindFromParam(req.nextUrl.searchParams.get("kind"));
  const monthDate = month === "all" ? null : monthToDate(month);

  if (kind === "entry") {
    const [rows, staff] = await Promise.all([
      fetchAllRows((from, to) => {
        const base = supabase.from("v_work_day_entry_list").select("*").eq("company_id", company.id);
        const filtered = monthDate ? base.eq("month", monthDate) : base;
        return filtered.order("work_date").order("driver_sort_order").order("id").range(from, to);
      }),
      loadStaffNames(supabase),
    ]);

    const csvRows: DayEntryCsvSource[] = rows.map((e) => ({
      ...e,
      approved_by_name: e.approved_by ? (staff.get(e.approved_by) ?? "") : "",
    }));
    return csvResponse(dailyCsvFilename(monthFileLabel(month), "entry"), toDayEntriesCsv(csvRows));
  }

  // 点呼の実施者（pre_by / post_by）はビューに無いので、元のテーブルから引いて名前を当てる
  const [rows, actors, staff] = await Promise.all([
    fetchAllRows((from, to) => {
      const base = supabase.from("v_daily_report_list").select("*").eq("company_id", company.id);
      const filtered = monthDate ? base.eq("month", monthDate) : base;
      return filtered.order("work_date").order("driver_name").order("id").range(from, to);
    }),
    fetchAllRows((from, to) => {
      const base = supabase.from("daily_reports").select("id, pre_by, post_by").eq("company_id", company.id);
      const filtered = monthDate ? base.eq("month", monthDate) : base;
      return filtered.order("id").range(from, to);
    }),
    loadStaffNames(supabase),
  ]);

  const actorById = new Map(actors.map((a) => [a.id, a]));
  /** スタッフに居なければドライバー本人が記録したもの */
  const nameOf = (userId: string | null | undefined, driverName: string | null | undefined): string => {
    if (!userId) return "";
    return staff.get(userId) ?? `${driverName ?? ""}（本人）`;
  };

  const csvRows: DailyReportCsvSource[] = rows.map((r) => {
    const a = r.id ? actorById.get(r.id) : undefined;
    return {
      ...r,
      pre_by_name: r.pre_at ? nameOf(a?.pre_by, r.driver_name) : "",
      post_by_name: r.post_at ? nameOf(a?.post_by, r.driver_name) : "",
    };
  });

  return csvResponse(dailyCsvFilename(monthFileLabel(month), "report"), toDailyReportsCsv(csvRows));
});
