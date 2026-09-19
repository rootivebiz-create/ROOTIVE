import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money, Pct } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMonthJa } from "@/lib/month";
import { pct } from "@/lib/format";
import {
  judgeBreakEvenRatio,
  judgeContributionRate,
  judgeOperatingMargin,
  KPI_DESCRIPTIONS,
  KPI_TONE_BADGE,
  KPI_TONE_LABELS,
} from "@/lib/kpi/metrics";
import { kpiTrendSummary, type KpiTrendRow } from "@/lib/kpi/trend";
import { cn } from "@/lib/utils";
import { KpiTrendChart } from "./kpi-chart";

/** 年間平均の 1 枚（判定つき） */
function AverageCard({ label, value, tone, description }: { label: string; value: string; tone: keyof typeof KPI_TONE_LABELS; description: string }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground md:text-sm">{label}</p>
        <Badge variant={KPI_TONE_BADGE[tone]}>{KPI_TONE_LABELS[tone]}</Badge>
      </div>
      <p className="num mt-1 text-lg font-semibold md:text-2xl">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground md:text-xs">{description}</p>
    </div>
  );
}

export interface KpiSectionProps {
  year: number;
  rows: KpiTrendRow[];
}

/**
 * 年次レポートの経営指標セクション（12 か月の推移）。
 * 数字は v_month_kpi の値をそのまま使い、判定は lib/kpi/metrics.ts の純関数で決める。
 */
export function KpiSection({ year, rows }: KpiSectionProps) {
  const summary = kpiTrendSummary(rows);
  const contributionJudge = judgeContributionRate(summary.monthCount > 0 ? summary.contributionRate : null);
  const marginJudge = judgeOperatingMargin(summary.monthCount > 0 ? summary.operatingMargin : null);
  const worstRatio = summary.worst?.breakEvenRatio ?? null;
  const worstJudge = judgeBreakEvenRatio(worstRatio);

  return (
    <Card>
      <CardHeader>
        <CardTitle>経営指標の推移</CardTitle>
        <CardDescription>
          {year}年の限界利益・損益分岐点・1 人当たりの数字です。折れ線の「損益分岐点比率」が 100%（赤い点線）を超えた月は赤字です。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AverageCard
            label="年間の限界利益率"
            value={summary.monthCount > 0 ? pct(summary.contributionRate) : "—"}
            tone={contributionJudge.tone}
            description={KPI_DESCRIPTIONS.contribution_rate}
          />
          <AverageCard
            label="年間の営業利益率"
            value={summary.monthCount > 0 ? pct(summary.operatingMargin) : "—"}
            tone={marginJudge.tone}
            description="売上のうち、経費まで引いたあとに残る割合です（営業利益 ÷ 売上）。"
          />
          <AverageCard
            label="いちばん苦しかった月"
            value={summary.worst ? `${formatMonthJa(summary.worst.month)}／${worstRatio == null ? "—" : pct(worstRatio)}` : "—"}
            tone={worstJudge.tone}
            description={`損益分岐点比率がもっとも高かった月です。年間で赤字だった月は ${summary.belowBreakEvenCount} か月です。`}
          />
        </div>

        {(contributionJudge.advice || marginJudge.advice || worstJudge.advice) && (
          <ul className="space-y-1 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {contributionJudge.advice && <li>限界利益率：{contributionJudge.advice}</li>}
            {marginJudge.advice && <li>営業利益率：{marginJudge.advice}</li>}
            {worstJudge.advice && <li>損益分岐点：{worstJudge.advice}</li>}
          </ul>
        )}

        <KpiTrendChart rows={rows} />

        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">表で見る</summary>
          <Table className="mt-2 text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>月</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">限界利益</TableHead>
                <TableHead className="text-right">限界利益率</TableHead>
                <TableHead className="text-right">損益分岐点売上高</TableHead>
                <TableHead className="text-right">損益分岐点比率</TableHead>
                <TableHead className="text-right">支払比率</TableHead>
                <TableHead className="text-right">1 人当たり売上</TableHead>
                <TableHead className="text-right">1 人当たり利益</TableHead>
                <TableHead className="text-right">1 日当たり売上</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.month} className={cn(!r.hasData && "text-muted-foreground")}>
                  <TableCell className="whitespace-nowrap">{formatMonthJa(r.month)}</TableCell>
                  <TableCell className="text-right">
                    <Money value={r.bill} showZeroAsDash />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.contribution} showZeroAsDash />
                  </TableCell>
                  <TableCell className="text-right">{r.hasData && r.bill > 0 ? <Pct value={r.contributionRate} /> : "—"}</TableCell>
                  <TableCell className="text-right">{r.breakEvenRatio == null ? "—" : <Money value={r.breakEvenBill} />}</TableCell>
                  <TableCell className={cn("text-right", r.breakEvenRatio != null && r.breakEvenRatio >= 1 && "text-destructive")}>
                    {r.breakEvenRatio == null ? "—" : <Pct value={r.breakEvenRatio} />}
                  </TableCell>
                  <TableCell className="text-right">{r.hasData && r.bill > 0 ? <Pct value={r.payoutRate} /> : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Money value={r.billPerDriver} showZeroAsDash />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.profitPerDriver} showZeroAsDash />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.billPerWorkDay} showZeroAsDash />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      </CardContent>
    </Card>
  );
}
