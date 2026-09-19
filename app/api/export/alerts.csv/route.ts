/**
 * GET /api/export/alerts.csv?m=YYYY-MM|all&status=open|resolved|ignored|all — 気になること CSV。
 * スタッフ（owner/admin/viewer）。status の既定は "open"（画面の「未対応」タブと同じ）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { alertsCsv, alertsCsvFilename } from "@/lib/exports/alerts-csv";
import { alertFilterSchema, type AlertFilter } from "@/lib/schemas/alerts";
import { csvResponse } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** ?status=（未指定は "open"、不正は 400） */
function statusParam(req: NextRequest): AlertFilter {
  const raw = req.nextUrl.searchParams.get("status");
  if (raw == null || raw === "") return "open";
  const parsed = alertFilterSchema.safeParse(raw);
  if (!parsed.success) throw new ExportError(400, "状態は ?status=open / resolved / ignored / all で指定してください。");
  return parsed.data;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });
  const status = statusParam(req);

  const rows = await fetchAllRows((from, to) => {
    let q = supabase.from("alerts").select("*").eq("company_id", company.id);
    if (month !== "all") q = q.eq("month", monthToDate(month));
    if (status !== "all") q = q.eq("status", status);
    return q.order("month").order("severity").order("detected_at", { ascending: false }).range(from, to);
  });

  return csvResponse(alertsCsvFilename(monthFileLabel(month)), alertsCsv(rows));
});
