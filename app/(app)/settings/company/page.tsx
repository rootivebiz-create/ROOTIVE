import { requirePageRole } from "@/lib/auth/session";
import { monthFromParam } from "@/lib/month";
import { rateToPercent } from "@/lib/calc/parse";
import { resolveYayoiAccounts } from "@/lib/yayoi/accounts";
import { yayoiAccountsToForm, type CompanyFormInput } from "@/lib/schemas/company";
import { PageHeader } from "@/components/ui/page-header";
import { CompanyForm } from "@/components/settings/company/company-form";
import { CompanyAssetsCard } from "@/components/settings/company/company-assets-card";

export const metadata = { title: "会社設定" };

/** 率（0.1）→ パーセント表記の文字列（"10"） */
const pctText = (rate: number | null | undefined) => String(rateToPercent(Number(rate ?? 0)));

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, profile } = await requirePageRole(["owner"]);
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const initial: CompanyFormInput = {
    name: company.name,
    rounding_mode: company.rounding_mode,
    default_royalty_rate: pctText(company.default_royalty_rate),
    default_mgmt_fee: String(Number(company.default_mgmt_fee ?? 0)),
    payout_month_offset: String(Number(company.payout_month_offset ?? 1)),
    payout_day: String(Number(company.payout_day ?? 0)),
    statement_note: company.statement_note ?? "",
    address: company.address ?? "",
    tel: company.tel ?? "",
    invoice_reg_no: company.invoice_reg_no ?? "",
    driver_portal_show_royalty: Boolean(company.driver_portal_show_royalty),
    driver_portal_show_open_month: Boolean(company.driver_portal_show_open_month),
    tax_rate: pctText(company.tax_rate),
    tax_rounding: company.tax_rounding,
    fiscal_month: String(Number(company.fiscal_month ?? 3)),
    established_on: company.established_on ?? "",
    fb_consignor_code: company.fb_consignor_code ?? "",
    fb_consignor_kana: company.fb_consignor_kana ?? "",
    fb_bank_code: company.fb_bank_code ?? "",
    fb_bank_name: company.fb_bank_name ?? "",
    fb_branch_code: company.fb_branch_code ?? "",
    fb_branch_name: company.fb_branch_name ?? "",
    fb_account_type: company.fb_account_type ?? "",
    fb_account_number: company.fb_account_number ?? "",
    yayoi_accounts: yayoiAccountsToForm(resolveYayoiAccounts(company.yayoi_accounts)),
  };

  return (
    <div>
      <PageHeader title="会社設定" description="会社名・計算の既定値・振込予定日・消費税・決算月・振込元の口座・明細の定型文・ロゴと認印・弥生会計の勘定科目（オーナーのみ）" />
      {/* フォームの初期値が変わったとき（保存後）だけ作り直す。ロゴ・認印のアップロードでは入力中の値を保つ */}
      <CompanyForm key={JSON.stringify(initial)} initial={initial} currentMonth={month} />
      <div className="mt-4">
        <CompanyAssetsCard logoPath={company.logo_path ?? null} sealPath={company.seal_path ?? null} canEdit={profile.role === "owner"} />
      </div>
    </div>
  );
}
