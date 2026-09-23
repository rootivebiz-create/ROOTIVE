/**
 * GET /api/export/payouts.xlsx?m=YYYY-MM|all — 支払一覧 Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは payouts.csv と同じ（支払額は税抜、実際の振込額は税込支払額）。
 */
import type { NextRequest } from "next/server";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel, payoutsCsvRows } from "@/lib/exports/csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** PAYOUTS_CSV_HEADERS と同じ並びの列の型（稼動月・ドライバー以外はすべて金額） */
const TYPES: XlsxCellType[] = ["text", "text", "money", "money", "money", "money", "money", "money", "money", "money", "money", "money"];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGEMENT_VIEW_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_driver_month_summary").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("driver_sort_order").order("driver_name").range(from, to);
  });

  const sheet = sheetFromRows("支払一覧", payoutsCsvRows(rows), { types: TYPES });
  await recordExport({ profileId: profile.id, kind: "payouts", label: "支払一覧 Excel", month, rows: rows.length, req });
  return xlsxResponse(`支払一覧_${monthFileLabel(month)}.xlsx`, buildXlsx([sheet]));
});
