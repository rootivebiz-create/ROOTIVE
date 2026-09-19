/**
 * GET /api/export/alerts.xlsx?m=YYYY-MM|all&status=open|resolved|ignored|all — 気になること Excel。
 * スタッフ（owner/admin/viewer）。内容・並び・既定値は alerts.csv と同じ。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { alertsCsvRows } from "@/lib/exports/alerts-csv";
import { alertFilterSchema, type AlertFilter } from "@/lib/schemas/alerts";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** ALERTS_CSV_HEADERS と同じ並びの列の型（検知日時・対応日時は時刻まで見せたいので文字列） */
const TYPES: XlsxCellType[] = ["text", "text", "text", "text", "text", "money", "text", "text", "text", "text", "text"];

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

  const sheet = sheetFromRows("気になること", alertsCsvRows(rows), { types: TYPES });
  return xlsxResponse(`気になること_${monthFileLabel(month)}.xlsx`, buildXlsx([sheet]));
});
