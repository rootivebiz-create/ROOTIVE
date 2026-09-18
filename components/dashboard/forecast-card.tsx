import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { pct, yen } from "@/lib/format";
import { forecastMonth } from "@/lib/calc";
import { currentMonthJST } from "@/lib/month";
import { cn } from "@/lib/utils";
import type { MonthPl } from "@/lib/db/types";
import { hasTarget, targetProgress, type TargetProgress } from "./helpers";

export interface ForecastCardProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  monthLabel: string;
  /** 会社 × 月の損益（v_month_pl）の実績 */
  pl: MonthPl;
  isClosed: boolean;
  /** 判定の基準時刻（既定は現在時刻。日本時間で判定する） */
  now?: Date;
}

/** 見込みベースの達成率（月次目標カードの進捗バーと同じ見た目） */
function ForecastProgressRow({ label, progress }: { label: string; progress: TargetProgress }) {
  if (progress.rate == null) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("num text-sm font-semibold", progress.achieved ? "text-success" : undefined)}>{pct(progress.rate)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}の見込み達成率 ${pct(progress.rate)}`}>
        <div className={cn("h-full rounded-full", progress.achieved ? "bg-success" : "bg-primary")} style={{ width: `${progress.barRatio * 100}%` }} />
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>
          見込み <Money value={progress.actual} className="text-xs" /> ／ 目標 <Money value={progress.target} className="text-xs" />
        </span>
        <span>{progress.achieved ? "達成の見込み" : `残り ${yen(progress.remaining)}`}</span>
      </p>
    </div>
  );
}

/**
 * 今月の着地見込み（月末の予測）カード
 * 当月かつ未締めのときだけ表示する。計算は lib/calc の forecastMonth（純関数）に任せる。
 */
export function ForecastCard({ month, monthLabel, pl, isClosed, now = new Date() }: ForecastCardProps) {
  // 過去月・未来月・締め済みの月には出さない
  if (isClosed || pl.status === "closed" || month !== currentMonthJST(now)) return null;

  const f = forecastMonth({
    month,
    now,
    isClosed,
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
  });

  const [, mm, dd] = (f.asOfDate ?? `${month}-01`).split("-");
  const asOfLabel = `${Number(mm)}月${Number(dd)}日時点・${pct(f.progress, 0)} 経過`;
  const billTarget = Number(pl.bill_target ?? 0);
  const profitTarget = Number(pl.profit_target ?? 0);
  const showTargets = hasTarget(billTarget, profitTarget) && f.basis !== "none";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> 今月の着地見込み
        </CardTitle>
        <CardDescription>
          {monthLabel}／{asOfLabel}。このままのペースで進んだ場合の月末の見込みです。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {f.basis === "none" ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            まだ稼働が入力されていません。稼働を入力すると着地見込みを表示します。
          </p>
        ) : (
          <>
            {f.reliability === "low" && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">まだ月初のため参考値です。</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground md:text-sm">売上の見込み</p>
                <p className="mt-1 text-xl font-semibold md:text-2xl">
                  <Money value={f.billForecast} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  実績 <Money value={f.bill} className="text-xs" />
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground md:text-sm">営業利益の見込み</p>
                <p className="mt-1 text-xl font-semibold md:text-2xl">
                  <Money value={f.operatingProfitForecast} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  実績 <Money value={f.operatingProfit} className="text-xs" />
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              ドライバー支払 {yen(f.payoutForecast)}（税抜）／ 経費 {yen(f.expenseForecast)}。管理費と固定費は按分せず、そのままの額で見込みます。
            </p>

            {showTargets && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs text-muted-foreground">見込みベースの目標達成率</p>
                <ForecastProgressRow label="売上" progress={targetProgress(f.billForecast, billTarget)} />
                <ForecastProgressRow label="営業利益" progress={targetProgress(f.operatingProfitForecast, profitTarget)} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
