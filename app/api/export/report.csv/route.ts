/**
 * GET /api/export/report.csv?y=YYYY — 年次レポート CSV（月次推移）。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { currentMonthJST } from "@/lib/month";
import { loadMonthPlRange } from "@/lib/db/queries";
import { parseYear, toReportRows, yearOfMonth, yearRange } from "@/components/reports/helpers";
import { reportCsvFilename, toReportCsv } from "@/lib/exports/report-csv";
import { csvResponse } from "@/lib/exports/download";
import { ExportError, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** ?y=YYYY（未指定なら日本時間の今年）。不正は 400 */
function yearParam(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("y");
  if (raw == null || raw === "") return yearOfMonth(currentMonthJST());
  const y = parseYear(raw);
  if (y == null) throw new ExportError(400, "年は ?y=YYYY（西暦 4 桁）で指定してください。");
  return y;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const year = yearParam(req);
  const { from, to } = yearRange(year);

  const pl = await loadMonthPlRange(supabase, company.id, from, to);
  await recordExport({ profileId: profile.id, kind: "report", label: "年次レポート CSV", req });
  return csvResponse(reportCsvFilename(year), toReportCsv(toReportRows(pl, year)));
});
