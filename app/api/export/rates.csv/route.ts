/**
 * GET /api/export/rates.csv — 単価表 CSV（稼働中のドライバー × 案件内容の実効単価と出所）。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { loadMasters } from "@/lib/db/queries";
import { ratesCsvFilename, ratesToCsv } from "@/lib/exports/rates-csv";
import { csvResponse } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (_req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const masters = await loadMasters(supabase, company.id, { activeOnly: true });
  return csvResponse(ratesCsvFilename(), ratesToCsv(masters));
});
