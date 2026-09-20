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
import { canSeeBankAccount } from "@/lib/schemas/drivers";
import { ExportError, fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

const HEADERS = ["ドライバー", "銀行コード", "銀行名", "支店コード", "支店名", "預金種目", "口座番号", "カナ名義", "振込金額", "振込予定日"] as const;

/** 支払日はドライバーに残り、口座は v_driver_bank（0020）。埋め込みリソースは使えないので別々に読む */
const DRIVER_COLUMNS = "id, name, payout_month_offset, payout_day";
const BANK_COLUMNS = "driver_id, bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(ADMIN_ROLES);
  const month = monthParam(req);
  if (!canSeeBankAccount(company.confidential_scope, profile.role)) {
    throw new ExportError(403, "振込先の口座を見る権限がありません。");
  }

  const [summaries, drivers, banks] = await Promise.all([
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
    fetchAllRows((from, to) => supabase.from("v_driver_bank").select(BANK_COLUMNS).eq("company_id", company.id).order("sort_order").order("driver_name").range(from, to)),
  ]);

  const byId = new Map(drivers.map((d) => [d.id, d]));
  const bankById = new Map(banks.filter((b) => b.driver_id).map((b) => [b.driver_id as string, b]));
  const targets: TransferTarget[] = summaries
    .filter((s) => s.driver_id && Number(s.payout_incl ?? 0) > 0)
    .map((s) => {
      const d = byId.get(s.driver_id ?? "");
      const b = bankById.get(s.driver_id ?? "");
      const { date } = resolvePayoutDate(month, company, d ? { payout_month_offset: d.payout_month_offset, payout_day: d.payout_day } : null);
      return toTransferTarget(
        {
          driverId: s.driver_id ?? "",
          driverName: s.driver_name ?? d?.name ?? "",
          bankCode: b?.bank_code ?? null,
          bankName: b?.bank_name ?? null,
          branchCode: b?.branch_code ?? null,
          branchName: b?.branch_name ?? null,
          accountType: b?.account_type ?? null,
          accountNumber: b?.account_number ?? null,
          holderKana: b?.account_holder_kana ?? null,
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
