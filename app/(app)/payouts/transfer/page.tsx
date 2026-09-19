import { ADMIN_ROLES, requirePageRole } from "@/lib/auth/session";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/db/types";
import { formatMonthJa, monthFromParam, monthToDate } from "@/lib/month";
import { resolvePayoutDate } from "@/lib/statement";
import { missingBankFields, pickTransferDate, toTransferTarget, transferDateOptions, type TransferTarget } from "@/lib/exports/zengin";
import { PageHeader } from "@/components/ui/page-header";
import { TransferView } from "@/components/transfer/transfer-view";

export const metadata = { title: "振込データ" };

const DRIVER_COLUMNS =
  "id, name, bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana, payout_month_offset, payout_day";

/** ?d=YYYY-MM-DD */
function dateParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export default async function TransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company, profile } = await requirePageRole(ADMIN_ROLES);
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const [summaryRes, driverRes] = await Promise.all([
    supabase
      .from("v_driver_month_summary")
      .select("driver_id, driver_name, payout_incl")
      .eq("company_id", company.id)
      .eq("month", monthToDate(month))
      .order("driver_sort_order")
      .order("driver_name"),
    supabase.from("drivers").select(DRIVER_COLUMNS).eq("company_id", company.id).order("sort_order").order("name"),
  ]);
  if (summaryRes.error) throw summaryRes.error;
  if (driverRes.error) throw driverRes.error;

  const byId = new Map((driverRes.data ?? []).map((d) => [d.id, d]));
  const targets: TransferTarget[] = (summaryRes.data ?? [])
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

  // 会社の振込元（0014 の fb_*）
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
  const companyAccountType = company.fb_account_type ? BANK_ACCOUNT_TYPE_LABELS[company.fb_account_type] : "";
  const companyAccountLabel = `${company.fb_bank_name ?? ""}（${company.fb_bank_code ?? ""}）${company.fb_branch_name ?? ""}（${company.fb_branch_code ?? ""}）${companyAccountType} ${company.fb_account_number ?? ""}`.trim();
  const consignorLabel = `${company.fb_consignor_kana ?? ""}　委託者コード ${company.fb_consignor_code ?? ""}`.trim();

  return (
    <div>
      <PageHeader
        title="振込データ（全銀フォーマット）"
        description={`${formatMonthJa(month)} の税込支払額から、ネットバンキングにアップロードできる総合振込データを作ります`}
      />
      {/* 月を変えたら取組日の選択も作り直す */}
      <TransferView
        key={month}
        month={month}
        targets={targets}
        transferDate={pickTransferDate(targets, dateParam(sp.d))}
        dateOptions={transferDateOptions(targets)}
        companyMissing={companyMissing}
        companyAccountLabel={companyAccountLabel}
        consignorLabel={consignorLabel}
        canEditCompany={profile.role === "owner"}
      />
    </div>
  );
}
