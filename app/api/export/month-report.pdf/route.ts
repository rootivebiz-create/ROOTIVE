/**
 * GET /api/export/month-report.pdf?m=YYYY-MM — 月次の経営レポート PDF（A4 縦・3 ページ）
 * スタッフ（owner/admin/viewer）。数字は v_month_pl / v_month_kpi などのビューの値をそのまま載せる
 */
import type { NextRequest } from "next/server";
import { loadMonthReportData, monthReportPdfFilename, renderMonthReportPdf } from "@/lib/pdf/month-report";
import { pdfResponse } from "@/lib/exports/download";
import { handleExport, monthParam, requireManagementExport } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireManagementExport();
  const month = monthParam(req);

  const data = await loadMonthReportData(supabase, company, month);
  const pdf = await renderMonthReportPdf(data);
  await recordExport({ profileId: profile.id, kind: "report", label: "月次レポート PDF", month, rows: 1, req });
  return pdfResponse(monthReportPdfFilename(month), pdf);
});
