/**
 * GET /api/export/bank.csv?status=unmatched|matched|ignored|all — 銀行明細 CSV。スタッフ（owner/admin/viewer）
 * 稼動月には依存しない（全期間）。?status= を省略すると未消込のみ。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { bankCsv, bankCsvFilename } from "@/lib/exports/bank-csv";
import { bankStatusFromParam } from "@/lib/schemas/bank";
import { csvResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const status = bankStatusFromParam(req.nextUrl.searchParams.get("status") ?? undefined);

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_bank_transaction_list").select("*").eq("company_id", company.id);
    const filtered = status === "all" ? base : base.eq("status", status);
    return filtered.order("txn_date", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
  });

  return csvResponse(bankCsvFilename(status), bankCsv(rows));
});
