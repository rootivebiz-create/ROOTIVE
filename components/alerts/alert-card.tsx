/**
 * ダッシュボードに差し込むカード（props だけで動く。サーバー部品としてそのまま使える）
 * 未対応の上位 3 件と件数を出し、0 件なら「問題なし」の一言だけを出す。
 */
import { ChevronRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { ALERT_SEVERITY_LABELS, type Alert } from "@/lib/db/types";
import { alertCodeInfo, alertSummaryText, countsOf, sortAlerts, totalCount, type SeverityCounts } from "@/lib/alerts/helpers";
import { cn } from "@/lib/utils";
import { alertIcon, SEVERITY_BADGE } from "./icons";

/** カードに必要な列だけ（alerts の 1 行） */
export type AlertCardItem = Pick<Alert, "id" | "code" | "severity" | "title" | "detail" | "amount" | "href" | "detected_at">;

export interface AlertCardProps {
  /** 未対応のアラート（並べ替えと上位 3 件の抽出はカード側で行う） */
  alerts: AlertCardItem[];
  /**
   * 未対応の件数（v_alert_summary）。省略すると alerts から数える。
   * alerts を絞って渡すときは必ず渡すこと。
   */
  counts?: SeverityCounts;
  /** 一覧に出す件数（既定 3） */
  max?: number;
  className?: string;
}

/** 未対応 1 件の行 */
function AlertRow({ alert }: { alert: AlertCardItem }) {
  const Icon = alertIcon(alert.code);
  const info = alertCodeInfo(alert.code);
  return (
    <MonthLink
      href={alert.href || "/alerts"}
      className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
      title={info.hint}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={SEVERITY_BADGE[alert.severity]}>{ALERT_SEVERITY_LABELS[alert.severity]}</Badge>
          <span className="min-w-0 break-words font-medium">{alert.title}</span>
        </span>
        {alert.amount != null && (
          <span className="mt-0.5 block">
            <Money value={alert.amount} />
          </span>
        )}
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </MonthLink>
  );
}

export function AlertCard({ alerts, counts, max = 3, className }: AlertCardProps) {
  const sorted = sortAlerts(alerts);
  const effective = counts ?? countsOf(alerts);
  const open = totalCount(effective);
  const top = sorted.slice(0, Math.max(0, max));
  const rest = open - top.length;

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          {open > 0 ? <TriangleAlert className="h-4 w-4 text-warning" /> : <ShieldCheck className="h-4 w-4 text-success" />}
          気になること
        </CardTitle>
        {open > 0 && <span className="text-xs text-muted-foreground">{alertSummaryText(effective)}</span>}
      </CardHeader>
      <CardContent>
        {open === 0 ? (
          <p className="text-sm font-medium text-success">問題なし。気になる点は見つかっていません。</p>
        ) : (
          <>
            <div className="-mx-2 space-y-0.5">
              {top.map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
            </div>
            <MonthLink href="/alerts" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {rest > 0 ? `ほか ${rest} 件をすべて見る` : "すべて見る"}
              <ChevronRight className="h-4 w-4" />
            </MonthLink>
          </>
        )}
      </CardContent>
    </Card>
  );
}
