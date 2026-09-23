import { Download } from "lucide-react";
import { requireManagementPage } from "@/lib/auth/session";
import { loadMonthKpiRange, loadMonthPlRange } from "@/lib/db/queries";
import { exportUrls } from "@/lib/exports/urls";
import { currentMonthJST, monthFromParam, monthToDate } from "@/lib/month";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { MonthLink } from "@/components/layout/month-link";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import {
  compareYears,
  driverRanking,
  expenseKindTotals,
  expenseRanking,
  hasReportData,
  previousReportRange,
  projectRanking,
  reportRangeOptions,
  resolveReportRange,
  sumReport,
  toReportRowsForMonths,
} from "@/components/reports/helpers";
import { ReportChart } from "@/components/reports/report-chart";
import { KpiSection } from "@/components/reports/kpi-section";
import { ReportMonthlyTable } from "@/components/reports/monthly-table";
import { DriverRankingTable, ExpenseRankingTable, ProjectRankingTable } from "@/components/reports/rankings";
import { ReportSummaryCards, YearComparisonCard } from "@/components/reports/summary-cards";
import { RangeSelector } from "@/components/reports/range-selector";
import { toKpiTrendRowsForMonths } from "@/lib/kpi/trend";
import { fiscalSettingsOf } from "@/lib/fiscal";

export const metadata = { title: "年次レポート" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requireManagementPage();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  // 期（決算月で区切る）か暦年か（0030）。指定が無ければ、いま見ている月が入る期
  const fiscal = fiscalSettingsOf(company);
  const range = resolveReportRange({ y: sp.y, fy: sp.fy }, month, fiscal);
  const prev = previousReportRange(range, fiscal);
  const { from, to } = range;

  const [pl, prevPl, kpiRows, driversRes, projectsRes, expensesRes, monthsRes] = await Promise.all([
    loadMonthPlRange(supabase, company.id, from, to),
    loadMonthPlRange(supabase, company.id, prev.from, prev.to),
    loadMonthKpiRange(supabase, company.id, monthToDate(from), monthToDate(to)),
    supabase
      .from("v_driver_month_summary")
      .select("*")
      .eq("company_id", company.id)
      .gte("month", monthToDate(from))
      .lte("month", monthToDate(to))
      .order("month"),
    supabase
      .from("v_project_summary")
      .select("*")
      .eq("company_id", company.id)
      .gte("month", monthToDate(from))
      .lte("month", monthToDate(to))
      .order("month"),
    supabase
      .from("v_expense_summary")
      .select("*")
      .eq("company_id", company.id)
      .gte("month", monthToDate(from))
      .lte("month", monthToDate(to))
      .order("category_sort_order"),
    supabase.from("v_month_pl").select("month").eq("company_id", company.id).order("month"),
  ]);
  if (driversRes.error) throw driversRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (monthsRes.error) throw monthsRes.error;

  const rows = toReportRowsForMonths(pl, range.months);
  const totals = sumReport(rows);
  const prevRows = toReportRowsForMonths(prevPl, prev.months);
  const comparison = compareYears(totals, hasReportData(prevRows) ? sumReport(prevRows) : null, prev.label);
  const drivers = driverRanking(driversRes.data ?? []);
  const projects = projectRanking(projectsRes.data ?? []);
  const expenses = expenseRanking(expensesRes.data ?? []);
  const expenseTotals = expenseKindTotals(expenses);
  const options = reportRangeOptions(range.view, (monthsRes.data ?? []).map((r) => r.month), fiscal, [currentMonthJST(), range.to]);
  const kpiRowsByMonth = toKpiTrendRowsForMonths(kpiRows, range.months);
  const hasData = hasReportData(rows);

  return (
    <div className="space-y-4">
      <PageHeader
        title="年次レポート"
        description={`${range.title}の推移・${range.prevName}比・ランキング（金額は税抜）`}
        actions={
          <>
            <RangeSelector
              view={range.view}
              year={range.year}
              options={options}
              showViewToggle={fiscal.fiscalMonth !== 12}
              // 暦年 2026 → 2026年に決算を迎える期、期 → その期が終わる年
              toggleYears={{ fiscal: range.year, calendar: Number(range.to.slice(0, 4)) }}
            />
            <MonthLink href="/drivers-pl" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              ドライバー別の採算
            </MonthLink>
            <a href={range.view === "fiscal" ? exportUrls.reportCsvFiscal(range.year) : exportUrls.reportCsv(range.year)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              CSV
            </a>
          </>
        }
      />

      {!hasData ? (
        <Empty
          title={`${range.label}のデータはありません`}
          description={`稼働行・経費・目標のいずれも登録されていません。別の${range.view === "fiscal" ? "期" : "年"}を選ぶか、稼働入力・経費から登録してください。`}
        />
      ) : (
        <>
          <ReportSummaryCards label={range.label} totals={totals} />

          <KpiSection label={range.label} rows={kpiRowsByMonth} />

          <Card>
            <CardHeader>
              <CardTitle>月次の推移</CardTitle>
              <CardDescription>棒＝売上・経費、折れ線＝会社利益・営業利益（営業利益 ＝ 会社利益 − 経費）。棒や線に触れると内訳を表示します。</CardDescription>
            </CardHeader>
            <CardContent>
              <ReportChart rows={rows} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>月次の内訳</CardTitle>
                <CardDescription>支払（税込）は消費税を含むドライバーへの実際の支払額です。</CardDescription>
              </CardHeader>
              <CardContent className="px-0 md:px-0">
                <ReportMonthlyTable rows={rows} totals={totals} />
              </CardContent>
            </Card>
            <YearComparisonCard label={range.label} prevName={range.prevName} prevLabel={prev.label} comparison={comparison} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>ドライバー別ランキング</CardTitle>
              <CardDescription>{range.label}の合計を会社利益の多い順に表示します。</CardDescription>
            </CardHeader>
            <CardContent className="px-0 md:px-0">
              <DriverRankingTable rows={drivers} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>案件別ランキング</CardTitle>
              <CardDescription>案件（内容）ごとの合計を利益の多い順に表示します。利益 ＝ 単価差額利益 ＋ ロイヤリティ（管理費・調整は含みません）。</CardDescription>
            </CardHeader>
            <CardContent className="px-0 md:px-0">
              <ProjectRankingTable rows={projects} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>経費のカテゴリ別内訳</CardTitle>
              <CardDescription>
                {range.label}の経費（税抜）合計。固定費・変動費の区分はカテゴリの設定によります。
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 md:px-0">
              <ExpenseRankingTable rows={expenses} fixed={expenseTotals.fixed} variable={expenseTotals.variable} total={expenseTotals.total} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
