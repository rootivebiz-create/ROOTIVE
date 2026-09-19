/**
 * GET /api/export/bank.xlsx?status=unmatched|matched|ignored|all — 銀行明細 Excel。スタッフ（owner/admin/viewer）
 * 内容・並び・既定値は bank.csv と同じ（稼動月には依存しない）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { BANK_CSV_STATUS_LABELS, bankCsvRows } from "@/lib/exports/bank-csv";
import { bankStatusFromParam } from "@/lib/schemas/bank";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** BANK_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = ["date", "text", "money", "money", "money", "text", "text", "text", "text", "text", "text"];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const status = bankStatusFromParam(req.nextUrl.searchParams.get("status") ?? undefined);

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_bank_transaction_list").select("*").eq("company_id", company.id);
    const filtered = status === "all" ? base : base.eq("status", status);
    return filtered.order("txn_date", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
  });

  const label = BANK_CSV_STATUS_LABELS[status] ?? "すべて";
  const sheet = sheetFromRows("銀行明細", bankCsvRows(rows), { types: TYPES });
  return xlsxResponse(`銀行明細_${label}.xlsx`, buildXlsx([sheet]));
});
