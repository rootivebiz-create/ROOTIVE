/**
 * GET /api/export/transfer.txt?m=YYYY-MM&d=YYYY-MM-DD — 全銀フォーマット（総合振込）のデータ
 * - 1 レコード 120 バイト固定長・CRLF・Shift_JIS。ネットバンキングにそのままアップロードできる
 * - 口座情報を含むため owner/admin のみ（閲覧者には出させない）
 * - 金額は v_driver_month_summary.payout_incl（税込）。0 円以下と口座情報が足りないドライバーは除外する
 * - 取組日は ?d=YYYY-MM-DD。省略時は振込予定日（resolvePayoutDate）のうち一番多い日
 */
import type { NextRequest } from "next/server";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { resolvePayoutDate } from "@/lib/statement";
import { binaryResponse } from "@/lib/exports/download";
import {
  buildZenginBytes,
  missingBankFields,
  pickTransferDate,
  toTransferTarget,
  transferFileName,
  transferRows,
  type TransferTarget,
  type ZenginInput,
} from "@/lib/exports/zengin";
import { canSeeBankAccount } from "@/lib/schemas/drivers";
import { ExportError, fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

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

  // 振込元（会社設定の fb_*）がそろっていないと作れない
  const companyMissing = [
    ...((company.fb_consignor_code ?? "").trim() ? [] : ["委託者コード"]),
    ...((company.fb_consignor_kana ?? "").trim() ? [] : ["委託者名（カナ）"]),
    ...missingBankFields({
      bankCode: company.fb_bank_code ?? null,
      bankName: company.fb_bank_name ?? null,
      branchCode: company.fb_branch_code ?? null,
      branchName: company.fb_branch_name ?? null,
      accountType: company.fb_account_type ?? null,
      accountNumber: company.fb_account_number ?? null,
      holderKana: company.fb_consignor_kana ?? null,
    }).filter((m) => m !== "口座名義（カナ）"),
  ];
  if (companyMissing.length > 0) {
    throw new ExportError(400, `振込元の情報が足りません（${companyMissing.join("・")}）。会社設定の「振込元口座」を登録してください。`);
  }

  const rows = transferRows(targets);
  if (rows.length === 0) {
    const reason = targets.length === 0 ? "この月に振込対象のドライバーがいません。" : "口座情報が登録されているドライバーがいません。ドライバー設定で口座を登録してください。";
    throw new ExportError(400, `全銀データを作成できませんでした。${reason}`);
  }

  const transferDate = pickTransferDate(targets, req.nextUrl.searchParams.get("d"));
  if (!transferDate) throw new ExportError(400, "取組日を決められませんでした。?d=YYYY-MM-DD で指定してください。");

  const input: ZenginInput = {
    consignorCode: company.fb_consignor_code ?? "",
    consignorKana: company.fb_consignor_kana ?? "",
    bank: {
      bankCode: company.fb_bank_code ?? "",
      bankName: company.fb_bank_name ?? "",
      branchCode: company.fb_branch_code ?? "",
      branchName: company.fb_branch_name ?? "",
      accountType: company.fb_account_type ?? null,
      accountNumber: company.fb_account_number ?? "",
    },
    transferDate,
    rows,
  };

  let bytes: Uint8Array;
  try {
    bytes = buildZenginBytes(input);
  } catch (e) {
    throw new ExportError(400, `全銀データを作成できませんでした：${e instanceof Error ? e.message : String(e)}`);
  }

    await recordExport({ profileId: profile.id, kind: "transfer", label: "振込データ（全銀）", month, rows: rows.length, req });
  return binaryResponse(transferFileName(month, "txt"), bytes, "text/plain; charset=Shift_JIS");
});
