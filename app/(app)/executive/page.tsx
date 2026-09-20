import Link from "next/link";
import { ArrowRight, Landmark, ShieldCheck, Stamp, TrendingUp } from "lucide-react";
import { requirePageRole } from "@/lib/auth/session";
import { loadCashForecast, loadCashSnapshots, loadMonthPl } from "@/lib/db/queries";
import { loadExecutiveSummary, loadExecutiveTasks } from "@/lib/executive/queries";
import { calcCockpit, COCKPIT_SIGNAL_LABELS } from "@/lib/executive/cockpit";
import { calcRunway, runwayText, RUNWAY_STATUS_LABELS, type RunwayResult } from "@/lib/executive/runway";
import { explainVariance, sortVarianceByImpact } from "@/lib/executive/variance";
import { executiveBrief } from "@/lib/executive/brief";
import { forecastMonth } from "@/lib/calc";
import { currentMonthJST, formatMonthJa } from "@/lib/month";
import { pct, yen } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Empty } from "@/components/ui/empty";
import { EXECUTIVE_TASK_LABELS } from "@/lib/db/types";
import { dateText } from "@/components/executive/helpers";

export const metadata = { title: "代表" };

/** 資金繰りを何日先まで見るか（3 か月ぶん見れば「安全」の判定ができる） */
const CASH_DAYS = 120;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 日本時間の今日 "YYYY-MM-DD" */
function todayJst(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const SIGNAL_TONE: Record<string, { card: string; badge: "default" | "secondary" | "destructive" | "outline" }> = {
  good: { card: "border-primary/40", badge: "secondary" },
  warn: { card: "border-amber-500/50", badge: "outline" },
  bad: { card: "border-destructive/60", badge: "destructive" },
};

const SEVERITY_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  high: "destructive",
  medium: "outline",
  low: "secondary",
};

export default async function ExecutivePage() {
  const { supabase, company } = await requirePageRole(["owner"]);
  const now = new Date();
  const today = todayJst(now);
  const month = currentMonthJST(now);

  const [summary, tasks, pl, cashEvents, snapshots] = await Promise.all([
    loadExecutiveSummary(supabase, company.id),
    loadExecutiveTasks(supabase, company.id, 5),
    loadMonthPl(supabase, company.id, month),
    // 資金繰りとアラートは補助情報なので、取れなくても画面は出す
    loadCashForecast(supabase, today, addDays(today, CASH_DAYS)).catch(() => null),
    loadCashSnapshots(supabase, company.id, 1).catch(() => []),
  ]);

  const runway: RunwayResult | null = cashEvents
    ? calcRunway({
        from: today,
        to: addDays(today, CASH_DAYS),
        openingBalance: Number(snapshots[0]?.balance ?? 0),
        events: cashEvents,
      })
    : null;

  const cockpit = calcCockpit({ summary, pl, runway });

  const forecast = pl
    ? forecastMonth({
        month,
        now,
        isClosed: pl.status === "closed",
        actual: {
          bill: Number(pl.bill ?? 0),
          payout: Number(pl.payout ?? 0),
          profit: Number(pl.profit ?? 0),
          mgmtFee: Number(pl.mgmt_fee ?? 0),
          expenseTotal: Number(pl.expense_total ?? 0),
          expenseFixed: Number(pl.expense_fixed ?? 0),
          expenseVariable: Number(pl.expense_variable ?? 0),
          operatingProfit: Number(pl.operating_profit ?? 0),
          entryCount: Number(pl.entry_count ?? 0),
          billTarget: Number(pl.bill_target ?? 0),
          profitTarget: Number(pl.profit_target ?? 0),
        },
      })
    : null;

  const variance = pl
    ? sortVarianceByImpact(
        explainVariance(
          { bill: Number(pl.bill_target ?? 0), operatingProfit: Number(pl.profit_target ?? 0) },
          {
            bill: Number(pl.bill ?? 0),
            margin: Number(pl.margin ?? 0),
            profit: Number(pl.profit ?? 0),
            expenseTotal: Number(pl.expense_total ?? 0),
            operatingProfit: Number(pl.operating_profit ?? 0),
            activeDriverCount: Number(pl.active_driver_count ?? 0),
          },
        ),
      )
    : [];

  const brief = executiveBrief({
    date: today,
    cockpit,
    runway,
    forecast: forecast
      ? {
          month,
          billForecast: forecast.billForecast,
          operatingProfitForecast: forecast.operatingProfitForecast,
          profitTargetRate: forecast.profitTargetRate,
        }
      : null,
    variance,
  });

  const tone = SIGNAL_TONE[cockpit.signal] ?? SIGNAL_TONE.warn;
  const monthLabel = formatMonthJa(month);

  return (
    <div className="space-y-4">
      <PageHeader
        title="代表"
        description="決裁・資金繰り・今月の着地を 1 画面で。ここは代表だけが見られます。"
      />

      {/* ① 今日のひとこと（信号） */}
      <Card className={tone.card}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone.badge}>{COCKPIT_SIGNAL_LABELS[cockpit.signal]}</Badge>
            <CardTitle className="text-base">{cockpit.headline}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">{brief}</p>
          {cockpit.reasons.length > 0 && (
            <ul className="space-y-1 text-sm">
              {cockpit.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">
                    ・
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ② 決裁 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stamp className="h-4 w-4" aria-hidden />
              決裁
            </CardTitle>
            <CardDescription>代表が承認か却下を決めるもの</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums">{cockpit.pendingApprovals}</span>
              <span className="text-sm text-muted-foreground">件 待っています</span>
              {cockpit.overdueApprovals > 0 && <Badge variant="destructive">期限切れ {cockpit.overdueApprovals} 件</Badge>}
            </div>
            <Link href="/executive/approvals" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              決裁の画面へ
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>

        {/* ③ 現金 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" aria-hidden />
              現金
            </CardTitle>
            <CardDescription>今日から {CASH_DAYS} 日先までの入金と支払から</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runway ? (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge variant={runway.status === "danger" ? "destructive" : runway.status === "watch" ? "outline" : "secondary"}>
                    {RUNWAY_STATUS_LABELS[runway.status]}
                  </Badge>
                  <span className="text-sm">{runwayText(runway)}</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">いちばん少ない残高</dt>
                    <dd>
                      <Money value={runway.minBalance} /> <span className="text-muted-foreground">（{dateText(runway.minBalanceOn)}）</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">期間の終わりの残高</dt>
                    <dd>
                      <Money value={runway.endingBalance} />
                    </dd>
                  </div>
                </dl>
                <Link href="/cashflow" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  資金繰りの画面へ
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                資金繰りの材料がまだありません。<Link href="/cashflow" className="text-primary hover:underline">資金繰り</Link>で今の残高を登録してください。
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ④ 今月の着地 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" aria-hidden />
            {monthLabel}の着地
          </CardTitle>
          <CardDescription>
            {forecast?.asOfDate ? `${dateText(forecast.asOfDate)}時点・${pct(forecast.progress, 0)} 経過` : "実績"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {forecast ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">売上の見込み</dt>
                  <dd className="text-base font-semibold">
                    <Money value={forecast.billForecast} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">営業利益の見込み</dt>
                  <dd className="text-base font-semibold">
                    <Money value={forecast.operatingProfitForecast} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">営業利益の目標</dt>
                  <dd>{cockpit.profitTarget > 0 ? <Money value={cockpit.profitTarget} /> : <span className="text-muted-foreground">未設定</span>}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">目標に対して</dt>
                  <dd>{forecast.profitTargetRate != null ? pct(forecast.profitTargetRate) : <span className="text-muted-foreground">—</span>}</dd>
                </div>
              </dl>
              {variance.length > 0 && (
                <div className="space-y-1 border-t pt-3">
                  <p className="text-xs text-muted-foreground">目標との差の内訳（営業利益）</p>
                  <ul className="space-y-1 text-sm">
                    {variance.slice(0, 3).map((v) => (
                      <li key={v.key} className="flex items-baseline justify-between gap-2">
                        <span>{v.label}</span>
                        <span className={v.direction === "minus" ? "font-medium text-destructive" : "font-medium"}>
                          {v.direction === "minus" ? "−" : "＋"}
                          {yen(Math.abs(v.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link href={`/dashboard?m=${month}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                ダッシュボードへ
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{monthLabel}の稼働がまだありません。</p>
          )}
        </CardContent>
      </Card>

      {/* ⑤ いま見るべきこと */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            いま見るべきこと
          </CardTitle>
          <CardDescription>決裁・見直し日・保険の満了・役員の任期・委任の期限</CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <Empty title="いまは何もありません" description="決裁や期限が近づくとここに出ます。" />
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={`${t.kind}-${t.ref_id}`} className="rounded-md border p-3">
                  <Link href={t.href ?? "/executive"} className="block space-y-1 hover:opacity-80">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SEVERITY_BADGE[t.severity ?? "low"] ?? "secondary"}>
                        {EXECUTIVE_TASK_LABELS[t.kind ?? ""] ?? "その他"}
                      </Badge>
                      <span className="font-medium">{t.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ⑥ 人と会社 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">人と会社</CardTitle>
          <CardDescription>いま背負っているものと、会社の手続き</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">稼働ドライバー</dt>
              <dd className="text-base font-semibold tabular-nums">{Number(pl?.active_driver_count ?? 0)} 名</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">借入の残高</dt>
              <dd className="text-base font-semibold">
                <Money value={Number(summary?.loan_balance ?? 0)} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">個人保証</dt>
              <dd className="text-base font-semibold">
                <Money value={Number(summary?.guarantee_total ?? 0)} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">会社の手続き</dt>
              <dd className="text-base font-semibold tabular-nums">{cockpit.companyTasks} 件</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href="/executive/company" className="font-medium text-primary hover:underline">
              会社の台帳
            </Link>
            <Link href="/executive/plan" className="font-medium text-primary hover:underline">
              中期計画
            </Link>
            <Link href="/executive/decisions" className="font-medium text-primary hover:underline">
              意思決定ログ
            </Link>
            <Link href="/executive/security" className="font-medium text-primary hover:underline">
              守り
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
