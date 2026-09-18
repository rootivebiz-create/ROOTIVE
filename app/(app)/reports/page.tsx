import { Download } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { loadMonthPlRange } from "@/lib/db/queries";
import { exportUrls } from "@/lib/exports/urls";
import { currentMonthJST, monthFromParam, monthToDate } from "@/lib/month";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { MonthLink } from "@/components/layout/month-link";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import {
  availableYears,
  compareYears,
  driverRanking,
  expenseKindTotals,
  expenseRanking,
  hasReportData,
  projectRanking,
  resolveReportYear,
  sumReport,
  toReportRows,
  yearOfMonth,
  yearRange,
} from "@/components/reports/helpers";
import { ReportChart } from "@/components/reports/report-chart";
import { ReportMonthlyTable } from "@/components/reports/monthly-table";
import { DriverRankingTable, ExpenseRankingTable, ProjectRankingTable } from "@/components/reports/rankings";
import { ReportSummaryCards, YearComparisonCard } from "@/components/reports/summary-cards";
import { YearSelector } from "@/components/reports/year-selector";

export const metadata = { title: "年次レポート" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const year = resolveReportYear(sp.y, month);
  const thisYear = yearOfMonth(currentMonthJST());
  const { from, to } = yearRange(year);
  const prevRange = yearRange(year - 1);

  const [pl, prevPl, driversRes, projectsRes, expensesRes, monthsRes] = await Promise.all([
    loadMonthPlRange(supabase, company.id, from, to),
    loadMonthPlRange(supabase, company.id, prevRange.from, prevRange.to),
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

  const rows = toReportRows(pl, year);
  const totals = sumReport(rows);
  const prevRows = toReportRows(prevPl, year - 1);
  const comparison = compareYears(totals, hasReportData(prevRows) ? sumReport(prevRows) : null, year - 1);
  const drivers = driverRanking(driversRes.data ?? []);
  const projects = projectRanking(projectsRes.data ?? []);
  const expenses = expenseRanking(expensesRes.data ?? []);
  const expenseTotals = expenseKindTotals(expenses);
  const years = availableYears((monthsRes.data ?? []).map((r) => r.month), [thisYear, year]);
  const hasData = hasReportData(rows);

  return (
    <div className="space-y-4">
      <PageHeader
        title="年次レポート"
        description={`${year}年の推移・前年比・ランキング（金額は税抜）`}
        actions={
          <>
            <YearSelector year={year} years={years} />
            <MonthLink href="/drivers-pl" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              ドライバー別の採算
            </MonthLink>
            <a href={exportUrls.reportCsv(year)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              CSV
            </a>
          </>
        }
      />

      {!hasData ? (
        <Empty title={`${year}年のデータはありません`} description="稼働行・経費・目標のいずれも登録されていません。別の年を選ぶか、稼働入力・経費から登録してください。" />
      ) : (
        <>
          <ReportSummaryCards year={year} totals={totals} />

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
            <YearComparisonCard year={year} comparison={comparison} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>ドライバー別ランキング</CardTitle>
              <CardDescription>{year}年の合計を会社利益の多い順に表示します。</CardDescription>
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
                {year}年の経費（税抜）合計。固定費・変動費の区分はカテゴリの設定によります。
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
