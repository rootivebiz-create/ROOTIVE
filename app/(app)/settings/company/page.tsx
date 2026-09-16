import { requirePageRole } from "@/lib/auth/session";
import { monthFromParam } from "@/lib/month";
import { rateToPercent } from "@/lib/calc/parse";
import { resolveYayoiAccounts } from "@/lib/yayoi/accounts";
import { yayoiAccountsToForm, type CompanyFormInput } from "@/lib/schemas/company";
import { PageHeader } from "@/components/ui/page-header";
import { CompanyForm } from "@/components/settings/company/company-form";

export const metadata = { title: "会社設定" };

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requirePageRole(["owner"]);
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const initial: CompanyFormInput = {
    name: company.name,
    rounding_mode: company.rounding_mode,
    default_royalty_rate: String(rateToPercent(Number(company.default_royalty_rate ?? 0))),
    default_mgmt_fee: String(Number(company.default_mgmt_fee ?? 0)),
    payout_month_offset: String(Number(company.payout_month_offset ?? 1)),
    payout_day: String(Number(company.payout_day ?? 0)),
    statement_note: company.statement_note ?? "",
    address: company.address ?? "",
    tel: company.tel ?? "",
    invoice_reg_no: company.invoice_reg_no ?? "",
    driver_portal_show_royalty: Boolean(company.driver_portal_show_royalty),
    yayoi_accounts: yayoiAccountsToForm(resolveYayoiAccounts(company.yayoi_accounts)),
  };

  return (
    <div>
      <PageHeader title="会社設定" description="会社名・計算の既定値・振込予定日・明細の定型文・弥生会計の勘定科目（オーナーのみ）" />
      <CompanyForm key={company.updated_at} initial={initial} currentMonth={month} />
    </div>
  );
}
