/**
 * GET /api/export/drivers-pl.csv?m=YYYY-MM&inactive=1 — ドライバー別の採算 CSV。スタッフ（owner/admin/viewer）
 * 既定は稼働中のドライバーのみ。?inactive=1 で停止中も含める（画面の「停止中も表示」と同じ）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { buildDriverPlRows, visibleDriverPlRows } from "@/components/drivers-pl/helpers";
import { driversPlCsvFilename, toDriversPlCsv } from "@/lib/exports/drivers-pl-csv";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req);
  const includeInactive = req.nextUrl.searchParams.get("inactive") === "1";

  const [summaries, entries] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("v_driver_month_summary")
        .select("*")
        .eq("company_id", company.id)
        .eq("month", monthToDate(month))
        .order("driver_sort_order")
        .order("driver_name")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("driver_name").order("id").range(from, to),
    ),
  ]);

  const rows = visibleDriverPlRows(buildDriverPlRows(summaries, entries), { includeInactive });
  return csvResponse(driversPlCsvFilename(month), toDriversPlCsv(rows));
});
