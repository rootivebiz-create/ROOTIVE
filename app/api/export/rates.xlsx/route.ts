/**
 * GET /api/export/rates.xlsx — 単価表 Excel（稼働中のドライバー × 案件内容の実効単価と出所）。スタッフ（owner/admin/viewer）
 * 内容・並びは rates.csv と同じ。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { loadMasters } from "@/lib/db/queries";
import { ratesCsvFilename, ratesToCsvRows } from "@/lib/exports/rates-csv";
import { buildXlsx, sheetFromRows, xlsxFilename, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** RATES_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = ["text", "text", "text", "text", "money", "money", "money", "text", "text", "money", "money"];

export const GET = handleExport(async (_req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const masters = await loadMasters(supabase, company.id, { activeOnly: true });

  const sheet = sheetFromRows("単価表", ratesToCsvRows(masters), { types: TYPES });
  return xlsxResponse(xlsxFilename(ratesCsvFilename()), buildXlsx([sheet]));
});
