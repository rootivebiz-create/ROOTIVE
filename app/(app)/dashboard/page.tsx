import { Suspense } from "react";
import { Lock } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadDashboardData } from "@/lib/db/queries-dashboard";
import { loadAlerts, loadAlertSummary, loadExpenseSummary, loadMonthPl } from "@/lib/db/queries";
import { isAiInsightsEnabled } from "@/lib/ai/config";
import { normalizeFindings } from "@/lib/ai/findings";
import { formatMonthJa, monthFromParam, monthToDate, prevMonth } from "@/lib/month";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money, Pct } from "@/components/ui/money";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { RevenueBreakdown } from "@/components/dashboard/revenue-breakdown";
import { ProfitTrendChart } from "@/components/dashboard/profit-trend-chart";
import { DriverSummaryTable, type DriverSummaryRow } from "@/components/dashboard/driver-summary-table";
import { DashboardWarnings } from "@/components/dashboard/warnings";
import { AiInsightsCard } from "@/components/dashboard/ai-insights-card";
import { TargetCard } from "@/components/dashboard/target-card";
import { ForecastCard } from "@/components/dashboard/forecast-card";
import { ExpenseCard } from "@/components/dashboard/expense-card";
import { expenseBreakdown, needsExpenseWarning } from "@/components/dashboard/helpers";
import { AlertCard } from "@/components/alerts/alert-card";

export const metadata = { title: "ダッシュボード" };
/** AI 月次分析（Server Action）は応答に数十秒かかることがある */
export const maxDuration = 60;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const [data, pl, prevPlRes, expenseRows, openAlerts, alertSummary] = await Promise.all([
    loadDashboardData(supabase, company.id, month),
    loadMonthPl(supabase, company.id, month),
    supabase.from("v_month_pl").select("*").eq("company_id", company.id).eq("month", monthToDate(prevMonth(month))).maybeSingle(),
    loadExpenseSummary(supabase, company.id, month),
    loadAlerts(supabase, company.id, { status: "open", month, limit: 3 }),
    loadAlertSummary(supabase, company.id, month),
  ]);
  if (prevPlRes.error) throw prevPlRes.error;
  const aiEnabled = isAiInsightsEnabled();
  const breakdown = expenseBreakdown(expenseRows);

  const driverRows: DriverSummaryRow[] = data.drivers.map((d) => {
    const bill = Number(d.bill ?? 0);
    const profit = Number(d.driver_profit ?? 0);
    return {
      driverId: d.driver_id ?? "",
      driverName: d.driver_name ?? "",
      isActive: Boolean(d.driver_is_active),
      entryCount: Number(d.entry_count ?? 0),
      bill,
      profit,
      payout: Number(d.payout ?? 0),
      profitRate: bill !== 0 ? profit / bill : 0,
    };
  });
  const totals = {
    entryCount: Number(data.summary.entry_count ?? 0),
    bill: Number(data.summary.bill ?? 0),
    profit: Number(data.summary.profit ?? 0),
    payout: Number(data.summary.payout ?? 0),
    profitRate: Number(data.summary.profit_rate ?? 0),
  };

  const insight = data.insight ? { model: data.insight.model, createdAt: data.insight.created_at, findings: normalizeFindings(data.insight.findings) } : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="ダッシュボード"
        description={`${formatMonthJa(month)} の経営状況`}
        actions={
          <>
            {data.isClosed && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> 締め済み
              </Badge>
            )}
            {data.isFuture && !data.isClosed && <Badge variant="outline">予定</Badge>}
          </>
        }
      />

      <KpiCards summary={data.summary} prev={data.prevSummary} pl={pl} prevPl={prevPlRes.data ?? null} />

      <Suspense fallback={null}>
        <DashboardWarnings
          warnings={data.warnings}
          noExpenses={needsExpenseWarning({ isClosed: data.isClosed, entryCount: Number(data.summary.entry_count ?? 0), expenseCount: Number(pl.expense_count ?? 0) })}
        />
      </Suspense>

      <ForecastCard month={month} monthLabel={formatMonthJa(month)} pl={pl} isClosed={data.isClosed} />

      <AlertCard
        alerts={openAlerts}
        counts={{
          high: Number(alertSummary?.high_count ?? 0),
          medium: Number(alertSummary?.medium_count ?? 0),
          low: Number(alertSummary?.low_count ?? 0),
        }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TargetCard
          month={month}
          monthLabel={formatMonthJa(month)}
          billTarget={Number(pl.bill_target ?? 0)}
          profitTarget={Number(pl.profit_target ?? 0)}
          memo={pl.target_memo ?? ""}
          bill={Number(pl.bill ?? 0)}
          operatingProfit={Number(pl.operating_profit ?? 0)}
          canEdit={canEdit(profile.role)}
        />
        <ExpenseCard breakdown={breakdown} fixed={Number(pl.expense_fixed ?? 0)} variable={Number(pl.expense_variable ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>売上の内訳</CardTitle>
            <CardDescription>会社売上 ＝ 支払 ＋ 単価差額利益 ＋ ロイヤリティ ＋ 管理費 ＋ 調整（利益計上分）</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueBreakdown summary={data.summary} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>会社利益の推移</CardTitle>
            <CardDescription>直近 12 か月（{formatMonthJa(data.trend[0]?.month ?? month)}〜{formatMonthJa(month)}）。棒に触れると内訳を表示します。</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfitTrendChart data={data.trend} />
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">表で見る</summary>
              <Table className="mt-2 text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>月</TableHead>
                    <TableHead className="text-right">会社売上</TableHead>
                    <TableHead className="text-right">会社利益</TableHead>
                    <TableHead className="text-right">支払合計</TableHead>
                    <TableHead className="text-right">利益率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trend.map((t) => (
                    <TableRow key={t.month} className={t.isCurrent ? "bg-accent/40 font-semibold" : undefined}>
                      <TableCell className="whitespace-nowrap">{formatMonthJa(t.month)}</TableCell>
                      <TableCell className="text-right">
                        <Money value={t.bill} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={t.profit} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={t.payout} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Pct value={t.profitRate} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ドライバー別サマリー</CardTitle>
          <CardDescription>タップすると支払明細を開きます。</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <DriverSummaryTable rows={driverRows} totals={totals} />
          </Suspense>
        </CardContent>
      </Card>

      {aiEnabled && <AiInsightsCard month={month} insight={insight} canRun={canEdit(profile.role)} />}
    </div>
  );
}
