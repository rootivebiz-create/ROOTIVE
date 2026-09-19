/**
 * GET /api/export/transfer.csv?m=YYYY-MM — 振込一覧 CSV（全銀データの目視確認用。UTF-8 BOM・CRLF）
 * - 全銀データ（transfer.txt）と同じ対象（その月の税込支払額が 1 円以上のドライバー）を、人が読める形で出す
 * - 口座情報が足りないドライバーは列が空欄になる（全銀データからは除外される）
 * - 口座情報を含むため owner/admin のみ（閲覧者には出させない）
 */
import type { NextRequest } from "next/server";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/db/types";
import { monthToDate } from "@/lib/month";
import { rawNumber } from "@/lib/format";
import { resolvePayoutDate } from "@/lib/statement";
import { toCsv, type CsvValue } from "@/lib/exports/csv";
import { csvResponse } from "@/lib/exports/download";
import { toTransferTarget, transferFileName, type TransferTarget } from "@/lib/exports/zengin";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

const HEADERS = ["ドライバー", "銀行コード", "銀行名", "支店コード", "支店名", "預金種目", "口座番号", "カナ名義", "振込金額", "振込予定日"] as const;

const DRIVER_COLUMNS =
  "id, name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana, payout_month_offset, payout_day";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(ADMIN_ROLES);
  const month = monthParam(req);

  const [summaries, drivers] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("v_driver_month_summary")
        .select("driver_id, driver_name, payout_incl")
        .eq("company_id", company.id)
        .eq("month", monthToDate(month))
        .order("driver_sort_order")
        .order("driver_name")
        .range(from, to),
    ),
    fetchAllRows((from, to) => supabase.from("drivers").select(DRIVER_COLUMNS).eq("company_id", company.id).order("sort_order").order("name").range(from, to)),
  ]);

  const byId = new Map(drivers.map((d) => [d.id, d]));
  const targets: TransferTarget[] = summaries
    .filter((s) => s.driver_id && Number(s.payout_incl ?? 0) > 0)
    .map((s) => {
      const d = byId.get(s.driver_id ?? "");
      const { date } = resolvePayoutDate(month, company, d ? { payout_month_offset: d.payout_month_offset, payout_day: d.payout_day } : null);
      return toTransferTarget(
        {
          driverId: s.driver_id ?? "",
          driverName: s.driver_name ?? d?.name ?? "",
          bankCode: d?.bank_code ?? null,
          bankName: d?.bank_name ?? null,
          branchCode: d?.branch_code ?? null,
          branchName: d?.branch_name ?? null,
          accountType: d?.account_type ?? null,
          accountNumber: d?.account_number ?? null,
          holderKana: d?.account_holder_kana ?? null,
        },
        Number(s.payout_incl ?? 0),
        date,
      );
    });

  const rows: CsvValue[][] = targets.map((t) => [
    t.driverName,
    t.bankCode,
    t.bankName,
    t.branchCode,
    t.branchName,
    t.accountType ? BANK_ACCOUNT_TYPE_LABELS[t.accountType] : "",
    t.accountNumber,
    t.holderKana,
    rawNumber(t.amount),
    t.payoutDate,
  ]);

  return csvResponse(transferFileName(month, "csv"), toCsv([[...HEADERS], ...rows]));
});
