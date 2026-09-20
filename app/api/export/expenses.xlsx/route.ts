/**
 * GET /api/export/expenses.xlsx?m=YYYY-MM|all — 経費 Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは expenses.csv と同じ（金額はすべて税抜）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { expensesCsvRows } from "@/lib/exports/expenses-csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** EXPENSES_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = ["text", "text", "text", "text", "money", "text", "date", "text", "text", "text", "text"];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_expense_list").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("category_sort_order").order("created_at").order("id").range(from, to);
  });

  const sheet = sheetFromRows("経費", expensesCsvRows(rows), { types: TYPES });
  await recordExport({ profileId: profile.id, kind: "expenses", label: "経費 Excel", month, rows: rows.length, req });
  return xlsxResponse(`経費_${monthFileLabel(month)}.xlsx`, buildXlsx([sheet]));
});
