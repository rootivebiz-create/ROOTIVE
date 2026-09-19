"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Download, EyeOff, Loader2, Search, ShieldCheck, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS, type Alert, type AlertSeverity, type AlertStatus } from "@/lib/db/types";
import { alertCodeInfo, alertSummaryText, sortAlerts, totalCount, type SeverityCounts } from "@/lib/alerts/helpers";
import { detectAnomaliesAction, detectIfStaleAction, setAlertStatusAction } from "@/lib/actions/alerts";
import { alertsCsvUrl } from "@/lib/exports/alerts-csv";
import type { AlertFilter } from "@/lib/schemas/alerts";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { alertIcon, SEVERITY_BADGE, SEVERITY_TEXT } from "./icons";

/** 一覧のタブ（?status=） */
const TABS: { key: AlertFilter; label: string }[] = [
  { key: "open", label: "未対応" },
  { key: "resolved", label: "対応済み" },
  { key: "ignored", label: "対象外" },
  { key: "all", label: "すべて" },
];

const SEVERITIES: AlertSeverity[] = ["high", "medium", "low"];

export interface AlertsViewProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  /** 表示中のタブ */
  status: AlertFilter;
  /** 表示する行（並べ替えは画面側でもう一度かける） */
  alerts: Alert[];
  /** 未対応の件数（v_alert_summary。行が 1 件も無ければ 0） */
  counts: SeverityCounts;
  /** 最終検査時刻（一度も検査していなければ null） */
  lastDetectedAt: string | null;
  /** owner / admin */
  canEdit: boolean;
}

/** 重さごとの件数カード */
function CountCard({ severity, count }: { severity: AlertSeverity; count: number }) {
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <p className="text-xs text-muted-foreground">{ALERT_SEVERITY_LABELS[severity]}</p>
        <p className={cn("num mt-1 text-xl font-bold", count > 0 && SEVERITY_TEXT[severity])}>{count}</p>
      </CardContent>
    </Card>
  );
}

export function AlertsView({ month, status, alerts, counts, lastDetectedAt, canEdit }: AlertsViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoChecking, setAutoChecking] = useState(false);
  /** 自動検査は「月ごとに 1 回だけ」（連打・再描画で何度も走らせない） */
  const autoRanFor = useRef<string | null>(null);

  const rows = useMemo(() => sortAlerts(alerts), [alerts]);
  const openTotal = totalCount(counts);

  const runDetect = useCallback(() => {
    startTransition(async () => {
      const res = await detectAnomaliesAction(month);
      if (res.ok) {
        toast.success(res.message ?? "検査しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }, [month, router]);

  // admin が画面を開いたときの自動検査（最終検査が 1 時間より古いときだけ実行される）
  useEffect(() => {
    if (!canEdit) return;
    if (autoRanFor.current === month) return;
    autoRanFor.current = month;
    let cancelled = false;
    setAutoChecking(true);
    void detectIfStaleAction(month)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data.ran) router.refresh();
        else if (!res.ok) console.warn("[alerts] 自動検査に失敗しました:", res.error);
      })
      .finally(() => {
        if (!cancelled) setAutoChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit, month, router]);

  const changeStatus = (alert: Alert, next: AlertStatus) => {
    setBusyId(alert.id);
    startTransition(async () => {
      const res = await setAlertStatusAction({ id: alert.id, status: next });
      setBusyId(null);
      if (res.ok) {
        toast.success(res.message ?? "状態を変更しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div>
      <PageHeader
        title="気になること"
        description={`${formatMonthJa(month)} の確認したい点（未対応 ${openTotal} 件）`}
        actions={
          <>
            <a href={alertsCsvUrl(month, status)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Download className="h-4 w-4" />
              CSV
            </a>
            {canEdit && (
              <Button size="sm" onClick={runDetect} disabled={pending || autoChecking} aria-busy={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <Search />}
                {pending ? "検査中…" : "今すぐ検査する"}
              </Button>
            )}
          </>
        }
      />

      {/* 件数のサマリー */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {SEVERITIES.map((s) => (
          <CountCard key={s} severity={s} count={counts[s]} />
        ))}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {autoChecking ? "検査中…" : lastDetectedAt ? `最終検査 ${formatDateTimeJa(lastDetectedAt)}` : "まだ検査していません"}
        <span className="mx-1">/</span>
        未対応 {alertSummaryText(counts)}
      </p>

      {/* タブ（?status=）。スマホでは横スクロール */}
      <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex gap-1 rounded-md bg-muted p-1">
          {TABS.map((t) => (
            <MonthLink
              key={t.key}
              href={`/alerts?status=${t.key}`}
              aria-current={status === t.key ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                status === t.key && "bg-card text-foreground shadow",
              )}
            >
              {t.label}
              {t.key === "open" && openTotal > 0 && <span className="num text-xs">({openTotal})</span>}
            </MonthLink>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        status === "open" ? (
          <Empty
            title="いまのところ問題は見つかっていません"
            description={canEdit ? "「今すぐ検査する」でもう一度確認できます。" : "管理者が検査すると最新の状態になります。"}
          >
            <ShieldCheck className="h-6 w-6 text-success" />
          </Empty>
        ) : (
          <Empty title={`${TABS.find((t) => t.key === status)?.label ?? ""}のものはありません`} description="タブを切り替えて他の状態を確認できます。" />
        )
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const Icon = alertIcon(a.code);
            const info = alertCodeInfo(a.code);
            const busy = pending && busyId === a.id;
            return (
              <li key={a.id}>
                <Card>
                  <CardContent className="flex items-start gap-2 p-3 md:p-4">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={SEVERITY_BADGE[a.severity]}>{ALERT_SEVERITY_LABELS[a.severity]}</Badge>
                        <span className="text-xs text-muted-foreground">{info.label}</span>
                        {a.status !== "open" && <Badge variant="outline">{ALERT_STATUS_LABELS[a.status]}</Badge>}
                      </div>
                      <p className="break-words font-medium leading-snug">{a.title}</p>
                      <p className="break-words text-sm text-muted-foreground">{a.detail || info.hint}</p>
                      {a.amount != null && (
                        <p className="text-sm">
                          <Money value={a.amount} />
                        </p>
                      )}
                      {a.note && <p className="break-words text-xs text-muted-foreground">メモ: {a.note}</p>}
                      <p className="text-xs text-muted-foreground">
                        検知 {formatDateTimeJa(a.detected_at)}
                        {a.resolved_at && ` / ${ALERT_STATUS_LABELS[a.status]} ${formatDateTimeJa(a.resolved_at)}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {a.href && (
                          <MonthLink href={a.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                            該当画面を開く
                            <ChevronRight className="h-4 w-4" />
                          </MonthLink>
                        )}
                        {canEdit && a.status === "open" && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => changeStatus(a, "resolved")} disabled={pending} aria-busy={busy}>
                              <CheckCircle2 /> 対応済みにする
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => changeStatus(a, "ignored")} disabled={pending} aria-busy={busy}>
                              <EyeOff /> 対象外にする
                            </Button>
                          </>
                        )}
                        {canEdit && a.status !== "open" && (
                          <Button size="sm" variant="ghost" onClick={() => changeStatus(a, "open")} disabled={pending} aria-busy={busy}>
                            <Undo2 /> 未対応に戻す
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        検査は稼働・単価・請求・経費・資金繰りをまとめて確認します。直ったものは次の検査で自動的に「対応済み」になります。
      </p>
    </div>
  );
}
