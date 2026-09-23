/**
 * GET /api/export/payouts.csv?m=YYYY-MM|all — 支払一覧 CSV（§8.1）。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { payoutsToCsv, monthFileLabel } from "@/lib/exports/csv";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGEMENT_VIEW_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_driver_month_summary").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("driver_sort_order").order("driver_name").range(from, to);
  });

  await recordExport({ profileId: profile.id, kind: "payouts", label: "支払一覧 CSV", month, rows: rows.length, req });
  return csvResponse(`支払一覧_${monthFileLabel(month)}.csv`, payoutsToCsv(rows));
});
