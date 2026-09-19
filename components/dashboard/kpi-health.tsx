import { Activity, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildKpiMetrics, kpiAlerts, kpiHeadline, type KpiMetric, type KpiTone, type KpiValues } from "@/lib/kpi/metrics";
import { cn } from "@/lib/utils";

/** 見出しの色（危険＝赤、注意＝黄、健全＝緑） */
const HEADLINE_CLASS: Record<KpiTone, string> = {
  good: "border-success/40 bg-success/10 text-foreground",
  ok: "border-border bg-muted text-foreground",
  warn: "border-warning/40 bg-warning/10 text-foreground",
  bad: "border-destructive/40 bg-destructive/10 text-foreground",
  info: "border-dashed border-border bg-muted/50 text-muted-foreground",
};

function ChangeText({ metric }: { metric: KpiMetric }) {
  const change = metric.change;
  if (!change) return <span className="text-muted-foreground">前月比 —</span>;
  const tone = change.tone === "good" ? "text-success" : change.tone === "bad" ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={cn("flex flex-wrap items-baseline gap-x-1", tone)}>
      <span className="text-muted-foreground">前月比</span>
      <span className="num">{change.text}</span>
    </span>
  );
}

function MetricCard({ metric }: { metric: KpiMetric }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground md:text-sm">{metric.label}</p>
        <Badge variant={metric.badge}>{metric.toneLabel}</Badge>
      </div>
      <p className={cn("mt-1 num text-lg font-semibold md:text-2xl", metric.tone === "bad" && "text-destructive")}>{metric.text}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground md:text-xs">{metric.note}</p>
      <p className="mt-1 text-[11px] md:text-xs">
        <ChangeText metric={metric} />
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground md:text-xs">{metric.description}</p>
      {metric.advice && (
        <p className={cn("mt-1.5 flex gap-1 text-[11px] leading-relaxed md:text-xs", metric.tone === "bad" ? "text-destructive" : "text-warning")}>
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{metric.advice}</span>
        </p>
      )}
    </div>
  );
}

export interface KpiHealthCardProps {
  /** 当月の経営指標（v_month_kpi） */
  kpi: KpiValues;
  /** 前月（前月比に使う。無ければ null） */
  prev: KpiValues | null;
  monthLabel: string;
}

/**
 * 経営の健康診断（限界利益・損益分岐点・支払比率・1 人／1 日当たり）
 * 数字は v_month_kpi の値をそのまま表示し、判定と助言は lib/kpi/metrics.ts の純関数で決める。
 */
export function KpiHealthCard({ kpi, prev, monthLabel }: KpiHealthCardProps) {
  const metrics = buildKpiMetrics(kpi, prev);
  const headline = kpiHeadline(kpi);
  const alerts = kpiAlerts(metrics);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" /> 経営の健康診断
        </CardTitle>
        <CardDescription>{monthLabel} の数字を、利益が出る体質かどうかの目で見たものです（金額は税抜）。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={cn("flex items-start gap-2 rounded-md border p-3 text-sm", HEADLINE_CLASS[headline.tone])}>
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{headline.text}</span>
        </p>

        {alerts.length > 0 && (
          <ul className="space-y-1 rounded-md border border-dashed p-3 text-sm">
            <li className="font-medium">いま見直すとよいこと（{alerts.length} 件）</li>
            {alerts.map((m) => (
              <li key={m.key} className="flex gap-1.5 text-muted-foreground">
                <span className="shrink-0 font-medium text-foreground">{m.label}：</span>
                <span>{m.advice}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((m) => (
            <MetricCard key={m.key} metric={m} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
