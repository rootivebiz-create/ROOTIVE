import { requirePageRole } from "@/lib/auth/session";
import { loadApprovalRules, loadDelegations } from "@/lib/executive/queries";
import { loadStaff } from "@/lib/db/queries";
import { todayJST } from "@/lib/finance/date";
import { PageHeader } from "@/components/ui/page-header";
import { ExecutiveTabs, type ExecutiveTabItem } from "@/components/executive/tabs";
import { ApprovalRulesPanel } from "@/components/executive/approval-rules-panel";
import { DelegationsPanel, type DelegateOption } from "@/components/executive/delegations-panel";

export const metadata = { title: "決裁のルール" };

/** ?tab= の値。delegations は v_executive_tasks が指しているので綴りを変えない */
const TABS = ["rules", "delegations"] as const;
type RulesTab = (typeof TABS)[number];

const DESCRIPTIONS: Record<RulesTab, string> = {
  rules: "どの操作を代表の決裁に回すかを、種別ごとに決めます。金額のしきい値は申請の画面が自動で見ます。",
  delegations: "代表が動けないあいだだけ、期間・上限金額・種別を切って決裁を預けます。",
};

function tabFromParam(param: string | string[] | undefined): RulesTab {
  const v = Array.isArray(param) ? param[0] : param;
  return TABS.includes(v as RulesTab) ? (v as RulesTab) : "rules";
}

/**
 * 決裁のルールと委任（/executive/rules）：代表（owner）専用
 *
 * 稼動月（?m）には依存しない。?tab=rules|delegations。
 * 委任できるのは自社の owner / admin のユーザーだけ（DB のトリガーも同じ確認をする）。
 */
export default async function ExecutiveRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = tabFromParam(sp.tab);
  const { supabase, company } = await requirePageRole(["owner"]);

  const [rules, delegations, staff] = await Promise.all([
    loadApprovalRules(supabase, company.id),
    loadDelegations(supabase, company.id),
    loadStaff(supabase, { activeOnly: true }),
  ]);

  // 委任先に選べるのは管理者以上（DB の t_delegation_name が同じ条件で弾く）
  const delegates: DelegateOption[] = staff
    .filter((s) => s.id && (s.role === "owner" || s.role === "admin"))
    .map((s) => ({ id: s.id as string, name: s.display_name || s.email || "（名前なし）", role: s.role ?? "admin" }));

  const tabs: ExecutiveTabItem[] = [
    { key: "rules", label: "決裁のルール", count: rules.filter((r) => r.is_enabled).length },
    { key: "delegations", label: "委任", count: delegations.filter((d) => d.is_current).length },
  ];

  return (
    <div>
      <PageHeader title="決裁のルールと委任" description={DESCRIPTIONS[tab]} />
      <ExecutiveTabs tabs={tabs} current={tab} />

      {tab === "rules" && <ApprovalRulesPanel rules={rules} />}
      {tab === "delegations" && <DelegationsPanel delegations={delegations} staff={delegates} today={todayJST()} />}
    </div>
  );
}
