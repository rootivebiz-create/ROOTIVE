import { canEdit, isOwner, requireStaff } from "@/lib/auth/session";
import { loadLoanPayments, loadLoans, loadMonthKpiRange, loadTaxTasks } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/page-header";
import { uuidSchema } from "@/lib/schemas/common";
import { financeTabFromParam } from "@/lib/schemas/finance";
import { monthToDate } from "@/lib/month";
import { resolveFinanceYear, todayJST, yearEndDate, yearOfDate, yearOptions, yearStartDate } from "@/lib/finance/date";
import { toBudgetRows } from "@/lib/finance/budget";
import { tasksOfYear, taxYears, toTaxTaskView } from "@/lib/finance/tax";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { BudgetPanel } from "@/components/finance/budget-panel";
import { LoansPanel } from "@/components/finance/loans-panel";
import { TaxPanel } from "@/components/finance/tax-panel";

export const metadata = { title: "財務" };

/** 返済予定の読み込み上限（1 件あたり最長 600 回） */
const SCHEDULE_LIMIT = 600;
/** 今年の返済予定の読み込み上限（借入が増えても足りる件数） */
const YEAR_PAYMENT_LIMIT = 1200;

const DESCRIPTIONS: Record<string, string> = {
  budget: "年間の目標を 12 か月ぶんまとめて決めて、実績と見比べます。",
  loans: "借入の残高と返済予定です。返済は資金繰りにも反映されます。",
  tax: "決算・税務の期限（目安）です。対応済みにすると気になることから消えます。",
};

/** URL の ?loan= を UUID として読む（不正なら null） */
function loanIdFromParam(param: string | string[] | undefined): string | null {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = uuidSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/**
 * 財務（/finance）：予算・借入・税務
 *
 * 稼動月（?m）には依存しない。タブは ?tab=budget|loans|tax、年は ?y=YYYY。
 * ?m が付いていても無視するが、ほかの画面へのリンクでは引き継ぐ（MonthLink）。
 * 閲覧者（viewer）は見るだけ（編集の UI を出さず、Server Action と RLS でも拒否される）。
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = financeTabFromParam(sp.tab);
  const { supabase, profile, company } = await requireStaff();

  const today = todayJST();
  const thisYear = yearOfDate(today);
  const year = resolveFinanceYear(sp.y, today);
  const editable = canEdit(profile.role);

  return (
    <div>
      <PageHeader title="財務" description={DESCRIPTIONS[tab]} />
      <FinanceTabs tab={tab} />

      {tab === "budget" && <BudgetTab supabase={supabase} companyId={company.id} year={year} thisYear={thisYear} canEdit={editable} />}
      {tab === "loans" && <LoansTab supabase={supabase} companyId={company.id} loanId={loanIdFromParam(sp.loan)} today={today} thisYear={thisYear} canEdit={editable} />}
      {tab === "tax" && (
        <TaxTab supabase={supabase} companyId={company.id} year={year} thisYear={thisYear} today={today} fiscalMonth={company.fiscal_month} canEdit={editable} owner={isOwner(profile.role)} />
      )}
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof requireStaff>>["supabase"];

/** 予算タブ：その年と前年の 12 か月を読む（前年は「前年実績 ＋ ◯%」に使う） */
async function BudgetTab({ supabase, companyId, year, thisYear, canEdit: editable }: { supabase: Supabase; companyId: string; year: number; thisYear: number; canEdit: boolean }) {
  const kpis = await loadMonthKpiRange(supabase, companyId, monthToDate(`${year - 1}-01`), monthToDate(`${year}-12`));
  return (
    <BudgetPanel
      key={year}
      year={year}
      years={yearOptions(thisYear, [year])}
      rows={toBudgetRows(year, kpis)}
      prevRows={toBudgetRows(year - 1, kpis)}
      canEdit={editable}
    />
  );
}

/** 借入タブ：一覧と今年の返済予定、選ばれている借入の返済予定 */
async function LoansTab({
  supabase,
  companyId,
  loanId,
  today,
  thisYear,
  canEdit: editable,
}: {
  supabase: Supabase;
  companyId: string;
  loanId: string | null;
  today: string;
  thisYear: number;
  canEdit: boolean;
}) {
  const [loans, yearPayments, schedule] = await Promise.all([
    loadLoans(supabase, companyId),
    loadLoanPayments(supabase, companyId, { from: yearStartDate(thisYear), to: yearEndDate(thisYear), limit: YEAR_PAYMENT_LIMIT }),
    loanId ? loadLoanPayments(supabase, companyId, { loanId, limit: SCHEDULE_LIMIT }) : Promise.resolve([]),
  ]);
  return <LoansPanel loans={loans} yearPayments={yearPayments} selectedLoanId={loanId} schedule={schedule} today={today} canEdit={editable} />;
}

/** 税務タブ：すべての期限を読み、その年だけを出す（年セレクタの選択肢にも使う） */
async function TaxTab({
  supabase,
  companyId,
  year,
  thisYear,
  today,
  fiscalMonth,
  canEdit: editable,
  owner,
}: {
  supabase: Supabase;
  companyId: string;
  year: number;
  thisYear: number;
  today: string;
  fiscalMonth: number;
  canEdit: boolean;
  owner: boolean;
}) {
  const all = await loadTaxTasks(supabase, companyId);
  const views = all.map((t) => toTaxTaskView(t, today));
  return (
    <TaxPanel
      year={year}
      years={yearOptions(thisYear, [...taxYears(all), year])}
      tasks={tasksOfYear(views, year)}
      fiscalMonth={fiscalMonth}
      today={today}
      canEdit={editable}
      isOwner={owner}
    />
  );
}
