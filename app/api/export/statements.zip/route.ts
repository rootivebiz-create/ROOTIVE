/**
 * GET /api/export/statements.zip?m=YYYY-MM — その月の全ドライバーの PDF 支払明細をまとめた ZIP（無圧縮）
 * スタッフ（owner/admin/viewer）。v_driver_month_summary に行があるドライバーが対象（並びは支払明細画面と同じ）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import type { DriverMonthSummary } from "@/lib/db/types";
import { monthToDate } from "@/lib/month";
import { loadStatementData } from "@/lib/statement";
import { loadStatementAssets } from "@/lib/company-assets";
import { renderStatementPdf, statementPdfFilename } from "@/lib/pdf/statement";
import { buildZip, uniqueZipName, type ZipEntry } from "@/lib/exports/zip";
import { binaryResponse, safeFilePart } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req);

  const summaries = await fetchAllRows<DriverMonthSummary>((from, to) =>
    supabase.from("v_driver_month_summary").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("driver_sort_order").order("driver_name").range(from, to),
  );
  const driverIds = summaries.map((s) => s.driver_id).filter((id): id is string => Boolean(id));
  if (driverIds.length === 0) throw new ExportError(404, "この月の支払明細はありません。");

  // ロゴ・認印は 1 回だけ読んで全ドライバーで使い回す
  const assets = await loadStatementAssets(company);

  // PDF は直列に生成する（同時実行によるメモリ増を避ける）
  const entries: ZipEntry[] = [];
  const usedNames = new Set<string>();
  const mtime = new Date();
  for (const driverId of driverIds) {
    const data = await loadStatementData(supabase, company, month, driverId);
    if (!data) continue;
    const pdf = await renderStatementPdf(data, { showRoyaltyRate: true, assets });
    const name = uniqueZipName(statementPdfFilename({ month: data.month, driverName: safeFilePart(data.driverName) }), usedNames);
    entries.push({ name, data: pdf, mtime });
  }
  if (entries.length === 0) throw new ExportError(404, "この月の支払明細はありません。");

  await recordExport({ profileId: profile.id, kind: "statements", label: "支払明細の一括 PDF", month, rows: entries.length, req });
  return binaryResponse(`支払明細_${month}_全員.zip`, buildZip(entries, { now: mtime }), "application/zip");
});
