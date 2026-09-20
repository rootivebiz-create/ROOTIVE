/**
 * GET /api/export/labor.csv?m=YYYY-MM&kind=day|month
 *  - kind=day：日ごとの拘束時間・実働・休息期間・連続勤務（既定）
 *  - kind=month：ドライバー × 月のまとめ
 * スタッフ（owner/admin/viewer）のみ。時間はすべて分で出す。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import type { ServerSupabase } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { laborCsvFilename, laborCsvKindFromParam, toLaborDaysCsv, toLaborMonthsCsv, type LaborDayCsvSource } from "@/lib/exports/labor-csv";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** ドライバーの表示名（id → 名前）。v_daily_labor には名前が無いので引いて当てる */
async function loadDriverNames(supabase: ServerSupabase, companyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("drivers").select("id, name").eq("company_id", companyId);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.id) map.set(d.id, d.name ?? "");
  }
  return map;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req);
  const kind = laborCsvKindFromParam(req.nextUrl.searchParams.get("kind"));
  const monthDate = monthToDate(month);
  const filename = laborCsvFilename(monthFileLabel(month), kind);

  if (kind === "month") {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from("v_driver_month_labor")
        .select("*")
        .eq("company_id", company.id)
        .eq("month", monthDate)
        .order("driver_sort_order")
        .order("driver_name")
        .order("driver_id")
        .range(from, to),
    );
    await recordExport({ profileId: profile.id, kind: "other", label: "労務（月まとめ）CSV", month, rows: rows.length, req });
    return csvResponse(filename, toLaborMonthsCsv(rows));
  }

  const [rows, drivers] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from("v_daily_labor").select("*").eq("company_id", company.id).eq("month", monthDate).order("work_date").order("driver_id").order("id").range(from, to),
    ),
    loadDriverNames(supabase, company.id),
  ]);

  const csvRows: LaborDayCsvSource[] = rows.map((r) => ({ ...r, driver_name: r.driver_id ? (drivers.get(r.driver_id) ?? "") : "" }));
  await recordExport({ profileId: profile.id, kind: "other", label: "労務（日別）CSV", month, rows: csvRows.length, req });
  return csvResponse(filename, toLaborDaysCsv(csvRows));
});
