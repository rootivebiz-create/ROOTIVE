/**
 * GET /api/export/projects.csv?m=YYYY-MM|all — 案件別採算 CSV。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { toProjectsCsv } from "@/lib/exports/projects-csv";
import { csvResponse } from "@/lib/exports/download";
import { toProjectRow } from "@/components/projects/helpers";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGEMENT_VIEW_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_project_pl").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("project_sort_order").order("project_name").range(from, to);
  });

  await recordExport({ profileId: profile.id, kind: "other", label: "案件別採算 CSV", month, rows: rows.length, req });
  return csvResponse(`案件別採算_${monthFileLabel(month)}.csv`, toProjectsCsv(rows.map(toProjectRow)));
});
