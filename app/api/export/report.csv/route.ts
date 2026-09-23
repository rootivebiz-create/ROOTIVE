/**
 * GET /api/export/report.csv?fy=YYYY（期）| ?y=YYYY（暦年） — 年次レポート CSV（月次推移）。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { loadMonthPlRange } from "@/lib/db/queries";
import { toReportRowsForMonths } from "@/components/reports/helpers";
import { reportRangeFilePart, reportRangeParam } from "../_lib/report-range";
import { reportCsvFilename, toReportCsv } from "@/lib/exports/report-csv";
import { csvResponse } from "@/lib/exports/download";
import { handleExport, requireManagementExport } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireManagementExport();
  const range = reportRangeParam(req, company);
  const { from, to } = range;

  const pl = await loadMonthPlRange(supabase, company.id, from, to);
  await recordExport({ profileId: profile.id, kind: "report", label: "年次レポート CSV", req });
  return csvResponse(reportCsvFilename(reportRangeFilePart(range)), toReportCsv(toReportRowsForMonths(pl, range.months)));
});
