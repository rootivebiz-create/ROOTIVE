/**
 * GET /api/export/entries.csv?m=YYYY-MM|all — 稼働明細 CSV（§8.1）。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { entriesToCsv, monthFileLabel } from "@/lib/exports/csv";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("driver_sort_order").order("driver_name").order("created_at").order("id").range(from, to);
  });

  return csvResponse(`稼働明細_${monthFileLabel(month)}.csv`, entriesToCsv(rows));
});
