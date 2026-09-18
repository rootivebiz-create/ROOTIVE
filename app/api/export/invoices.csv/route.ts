/**
 * GET /api/export/invoices.csv?m=YYYY-MM|all — 請求書一覧 CSV。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { invoicesToCsv } from "@/lib/exports/invoices-csv";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_invoice_list").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("client_sort_order").order("invoice_no").range(from, to);
  });

  return csvResponse(`請求書一覧_${monthFileLabel(month)}.csv`, invoicesToCsv(rows));
});
