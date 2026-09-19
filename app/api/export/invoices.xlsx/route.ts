/**
 * GET /api/export/invoices.xlsx?m=YYYY-MM|all — 請求書一覧 Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは invoices.csv と同じ（金額は DB が計算した値をそのまま）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { invoicesCsvRows } from "@/lib/exports/invoices-csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** INVOICES_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = ["text", "text", "text", "text", "date", "date", "money", "money", "money", "date", "text"];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_invoice_list").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("client_sort_order").order("invoice_no").range(from, to);
  });

  const sheet = sheetFromRows("請求書一覧", invoicesCsvRows(rows), { types: TYPES });
  return xlsxResponse(`請求書一覧_${monthFileLabel(month)}.xlsx`, buildXlsx([sheet]));
});
