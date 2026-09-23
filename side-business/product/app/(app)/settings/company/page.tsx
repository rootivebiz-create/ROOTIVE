import { Notice, PageHeader } from "~/components/page";
import { CompanyForm, type CompanyInitial } from "~/components/settings/company-form";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadCompany } from "~/server/features/settings/company";
import { todayJst } from "~/server/features/settings/format";
import { PERIOD_WORDS, START_WORDS, TORITEKI_CAPITAL_YEN, TORITEKI_EMPLOYEES } from "~/server/features/watch/rules";
import { SOURCES } from "~/server/features/watch/sources";
import { monthFromParam } from "~/server/month";
import { saveCompanyAction } from "./actions";

export const metadata = { title: "会社の設定" };

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const db = await getDb();
  const t = await loadCompany(db, user.tenantId);
  const canEdit = roleAtLeast(user.role, "owner");
  const st = t.settings ?? {};
  const r = st.requester ?? {};
  const initial: CompanyInitial = {
    name: t.name,
    registrationNo: t.registrationNo ?? "",
    taxMethod: t.taxMethod === "simplified" || t.taxMethod === "exempt" ? t.taxMethod : "general",
    payTaxToExempt: t.payTaxToExempt,
    taxRounding: t.taxRounding,
    amountRounding: t.amountRounding,
    closingDay: t.closingDay,
    payMonthOffset: Math.max(0, Math.min(2, t.payMonthOffset)),
    payDay: t.payDay,
    paymentTermsText: st.paymentTermsText ?? "",
    transferFeeBearer: st.transferFeeBearer === "driver" ? "driver" : "company",
    capitalYen: typeof st.capitalYen === "number" ? st.capitalYen.toLocaleString("ja-JP") : "",
    employees: typeof st.employees === "number" ? String(st.employees) : "",
    deemedConfirmDays: String(st.deemedConfirmDays ?? 7),
    statementNote: st.statementNote ?? "",
    requester: {
      code: r.code ?? "",
      nameKana: r.nameKana ?? "",
      bankCode: r.bankCode ?? "",
      bankNameKana: r.bankNameKana ?? "",
      branchCode: r.branchCode ?? "",
      branchNameKana: r.branchNameKana ?? "",
      accountType: r.accountType === "checking" ? "checking" : "ordinary",
      accountNumber: r.accountNumber ?? "",
    },
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title="会社の設定" description="明細・振込データ・見張り番のもとになる、会社の決まりごとです。" />
      {!canEdit && (
        <div className="mb-4">
          <Notice tone="info">会社の設定はオーナーだけが変えられます。変えたいときは、オーナーに頼んでください。</Notice>
        </div>
      )}
      <CompanyForm
        action={saveCompanyAction}
        initial={initial}
        canEdit={canEdit}
        today={todayJst()}
        month={month}
        periodWords={PERIOD_WORDS}
        startWords={START_WORDS}
        toriteki={{ capitalYen: TORITEKI_CAPITAL_YEN, employees: TORITEKI_EMPLOYEES }}
        sources={{
          flGuidelines: SOURCES.flGuidelines,
          flQa: SOURCES.flQa,
          toritekiLeaflet: SOURCES.toritekiLeaflet,
          toritekiOverview: SOURCES.toritekiOverview,
          exemptQa: SOURCES.exemptQa,
          invoiceRegistry: SOURCES.invoiceRegistry,
          purchaseStatement: SOURCES.purchaseStatement,
          purchaseStatementQa: SOURCES.purchaseStatementQa,
        }}
      />
    </div>
  );
}
