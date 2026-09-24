import { canEdit, isOwner, requireManagementPage } from "@/lib/auth/session";
import { loadLoanPayments, loadLoans, loadMonthKpiRange, loadTaxTasks } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/page-header";
import { uuidSchema } from "@/lib/schemas/common";
import { financeTabFromParam } from "@/lib/schemas/finance";
import { addMonths, monthRange, monthToDate } from "@/lib/month";
import { monthOfDate, resolveFinanceYear, todayJST, yearOfDate, yearOptions } from "@/lib/finance/date";
import { previousMonths, toBudgetRowsForMonths } from "@/lib/finance/budget";
import { tasksOfYear, taxYears, toTaxTaskView } from "@/lib/finance/tax";
import { fiscalPeriodOfMonth, fiscalSettingsOf, periodDateRange, periodTitle, type FiscalSettings } from "@/lib/fiscal";
import { previousReportRange, reportRangeOptions, resolveReportRange } from "@/components/reports/helpers";
import { RangeSelector } from "@/components/reports/range-selector";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { BudgetPanel } from "@/components/finance/budget-panel";
import { LoansPanel } from "@/components/finance/loans-panel";
import { TaxPanel } from "@/components/finance/tax-panel";

export const metadata = { title: "財務" };

/** 返済予定の読み込み上限（1 件あたり最長 600 回） */
const SCHEDULE_LIMIT = 600;
/** 今期の返済予定の読み込み上限（借入が増えても足りる件数） */
const PERIOD_PAYMENT_LIMIT = 1200;

const DESCRIPTIONS: Record<string, string> = {
  budget: "期（事業年度）または暦年の目標を月ごとにまとめて決めて、実績と見比べます。",
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
 * 稼動月（?m）には依存しない。タブは ?tab=budget|loans|tax。
 * 予算は期（?fy=決算の年。既定は今日の期）か暦年（?y=）、借入の要約は今期、税務は期限の年（?y=）。
 * ?m が付いていても無視するが、ほかの画面へのリンクでは引き継ぐ（MonthLink）。
 * 閲覧者（viewer）は見るだけ（編集の UI を出さず、Server Action と RLS でも拒否される）。
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = financeTabFromParam(sp.tab);
  const { supabase, profile, company } = await requireManagementPage();

  const today = todayJST();
  const thisYear = yearOfDate(today);
  const year = resolveFinanceYear(sp.y, today);
  const editable = canEdit(profile.role);
  const fiscal = fiscalSettingsOf(company);

  return (
    <div>
      <PageHeader title="財務" description={DESCRIPTIONS[tab]} />
      <FinanceTabs tab={tab} />

      {tab === "budget" && <BudgetTab supabase={supabase} companyId={company.id} params={{ y: sp.y, fy: sp.fy }} today={today} fiscal={fiscal} canEdit={editable} />}
      {tab === "loans" && <LoansTab supabase={supabase} companyId={company.id} loanId={loanIdFromParam(sp.loan)} today={today} fiscal={fiscal} canEdit={editable} />}
      {tab === "tax" && (
        <TaxTab supabase={supabase} companyId={company.id} year={year} thisYear={thisYear} today={today} fiscal={fiscal} canEdit={editable} owner={isOwner(profile.role)} />
      )}
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof requireManagementPage>>["supabase"];

/**
 * 予算タブ：期（既定は今日の期）か暦年の月と、その 12 か月前の月を一度に読む（前は「前期実績 ＋ ◯%」に使う）。
 * 範囲の決め方・選択肢・切り替えは年次レポートと同じ（resolveReportRange / reportRangeOptions / RangeSelector）
 */
async function BudgetTab({
  supabase,
  companyId,
  params,
  today,
  fiscal,
  canEdit: editable,
}: {
  supabase: Supabase;
  companyId: string;
  params: { y?: string | string[]; fy?: string | string[] };
  today: string;
  fiscal: FiscalSettings;
  canEdit: boolean;
}) {
  const thisMonth = monthOfDate(today);
  const range = resolveReportRange(params, thisMonth, fiscal);
  const prev = previousReportRange(range, fiscal);
  const prevMonthList = previousMonths(range.months);
  const kpis = await loadMonthKpiRange(supabase, companyId, monthToDate(prevMonthList[0]), monthToDate(range.to));
  // 選択肢：今日の前後（3 年前〜2 年先）の月をすべて渡して間を空けない ＋ いま見ている範囲
  const options = reportRangeOptions(range.view, monthRange(addMonths(thisMonth, -36), addMonths(thisMonth, 24)), fiscal, [range.from, range.to]);
  return (
    <BudgetPanel
      key={`${range.view}-${range.year}`}
      range={{ label: range.label, title: range.title, prevName: range.prevName, prevLabel: prev.label }}
      selector={
        <RangeSelector
          view={range.view}
          year={range.year}
          options={options}
          showViewToggle={fiscal.fiscalMonth !== 12}
          toggleYears={{ fiscal: range.year, calendar: Number(range.to.slice(0, 4)) }}
        />
      }
      rows={toBudgetRowsForMonths(range.months, kpis)}
      prevRows={toBudgetRowsForMonths(prevMonthList, kpis)}
      canEdit={editable}
    />
  );
}

/** 借入タブ：一覧と今期の返済予定、選ばれている借入の返済予定 */
async function LoansTab({
  supabase,
  companyId,
  loanId,
  today,
  fiscal,
  canEdit: editable,
}: {
  supabase: Supabase;
  companyId: string;
  loanId: string | null;
  today: string;
  fiscal: FiscalSettings;
  canEdit: boolean;
}) {
  const period = fiscalPeriodOfMonth(monthOfDate(today), fiscal);
  const { from, to } = periodDateRange(period);
  const [loans, periodPayments, schedule] = await Promise.all([
    loadLoans(supabase, companyId),
    loadLoanPayments(supabase, companyId, { from, to, limit: PERIOD_PAYMENT_LIMIT }),
    loanId ? loadLoanPayments(supabase, companyId, { loanId, limit: SCHEDULE_LIMIT }) : Promise.resolve([]),
  ]);
  return (
    <LoansPanel
      loans={loans}
      periodPayments={periodPayments}
      period={{ from, to, title: periodTitle(period) }}
      selectedLoanId={loanId}
      schedule={schedule}
      today={today}
      canEdit={editable}
    />
  );
}

/** 税務タブ：すべての期限を読み、その年だけを出す（年セレクタの選択肢にも使う） */
async function TaxTab({
  supabase,
  companyId,
  year,
  thisYear,
  today,
  fiscal,
  canEdit: editable,
  owner,
}: {
  supabase: Supabase;
  companyId: string;
  year: number;
  thisYear: number;
  today: string;
  fiscal: FiscalSettings;
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
      fiscal={fiscal}
      today={today}
      canEdit={editable}
      isOwner={owner}
    />
  );
}
