import { requirePageRole } from "@/lib/auth/session";
import { loadAdvisors, loadCompanyProfile, loadGuarantees, loadInsurancePolicies, loadOfficers, loadShareholders } from "@/lib/executive/queries";
import { loadLoans } from "@/lib/db/queries";
import { todayJST } from "@/lib/finance/date";
import { PageHeader } from "@/components/ui/page-header";
import { ExecutiveTabs, type ExecutiveTabItem } from "@/components/executive/tabs";
import { CompanyProfileForm } from "@/components/executive/company-profile-form";
import { OfficersPanel } from "@/components/executive/officers-panel";
import { ShareholdersPanel } from "@/components/executive/shareholders-panel";
import { InsurancePanel } from "@/components/executive/insurance-panel";
import { AdvisorsPanel } from "@/components/executive/advisors-panel";
import { GuaranteesPanel, type GuaranteeLoanOption } from "@/components/executive/guarantees-panel";

export const metadata = { title: "会社の台帳" };

/** ?tab= の値。insurance と officers は v_executive_tasks が指しているので綴りを変えない */
const TABS = ["basic", "officers", "shareholders", "insurance", "advisors", "guarantees"] as const;
type CompanyTab = (typeof TABS)[number];

const DESCRIPTIONS: Record<CompanyTab, string> = {
  basic: "登記・許認可・社会保険の控えです。融資や契約のときに毎回聞かれることをまとめてあります。",
  officers: "役員の任期です。満了の 90 日前から重任（再任）の登記を知らせます。",
  shareholders: "株主名簿です。持株数を入れると持株比率を自動で計算します。",
  insurance: "会社で入っている保険です。満了の 60 日前から知らせます。",
  advisors: "税理士・社労士などの顧問です。連絡先と顧問料を控えておきます。",
  guarantees: "代表個人が負っている保証・担保です。有効なものの合計が代表のリスクの大きさになります。",
};

function tabFromParam(param: string | string[] | undefined): CompanyTab {
  const v = Array.isArray(param) ? param[0] : param;
  return TABS.includes(v as CompanyTab) ? (v as CompanyTab) : "basic";
}

/** 借入の選択肢（保証と結びつける） */
function toLoanOptions(loans: Awaited<ReturnType<typeof loadLoans>>): GuaranteeLoanOption[] {
  return loans
    .filter((l): l is typeof l & { id: string } => typeof l.id === "string")
    .map((l) => ({ id: l.id, label: [l.name, l.lender].filter(Boolean).join(" / ") || "借入" }));
}

/**
 * 会社の台帳（/executive/company）：代表（owner）専用
 *
 * 稼動月（?m）には依存しない。?tab=basic|officers|shareholders|insurance|advisors|guarantees の 1 画面。
 * 代表専用のテーブルは RLS でも閉じているので、代表以外は入口ではじかれる（CLAUDE.md §2）。
 */
export default async function ExecutiveCompanyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = tabFromParam(sp.tab);
  const { supabase, company } = await requirePageRole(["owner"]);
  const today = todayJST();

  const [profile, officers, shareholders, policies, advisors, guarantees] = await Promise.all([
    loadCompanyProfile(supabase, company.id),
    loadOfficers(supabase, company.id),
    loadShareholders(supabase, company.id),
    loadInsurancePolicies(supabase, company.id),
    loadAdvisors(supabase, company.id),
    loadGuarantees(supabase, company.id),
  ]);
  // 借入は保証タブの選択肢にだけ使う
  const loans = tab === "guarantees" ? await loadLoans(supabase, company.id) : [];

  const tabs: ExecutiveTabItem[] = [
    { key: "basic", label: "基本情報" },
    { key: "officers", label: "役員", count: officers.filter((o) => o.is_active).length },
    { key: "shareholders", label: "株主", count: shareholders.length },
    { key: "insurance", label: "保険", count: policies.filter((p) => p.is_active).length },
    { key: "advisors", label: "顧問", count: advisors.filter((a) => a.is_active).length },
    { key: "guarantees", label: "個人保証", count: guarantees.filter((g) => g.is_active).length },
  ];

  return (
    <div>
      <PageHeader title="会社の台帳" description={DESCRIPTIONS[tab]} />
      <ExecutiveTabs tabs={tabs} current={tab} />

      {tab === "basic" && <CompanyProfileForm profile={profile} />}
      {tab === "officers" && <OfficersPanel officers={officers} today={today} />}
      {tab === "shareholders" && <ShareholdersPanel shareholders={shareholders} />}
      {tab === "insurance" && <InsurancePanel policies={policies} today={today} />}
      {tab === "advisors" && <AdvisorsPanel advisors={advisors} />}
      {tab === "guarantees" && <GuaranteesPanel guarantees={guarantees} loans={toLoanOptions(loans)} />}
    </div>
  );
}
