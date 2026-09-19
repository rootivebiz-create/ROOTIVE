import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadAlertSummary, loadAlerts } from "@/lib/db/queries";
import { monthFromParam } from "@/lib/month";
import { alertFilterFromParam } from "@/lib/schemas/alerts";
import { AlertsView } from "@/components/alerts/alerts-view";
import type { SeverityCounts } from "@/lib/alerts/helpers";

export const metadata = { title: "気になること" };

/** 一覧の上限（検知はふつう数十件まで） */
const LIST_LIMIT = 200;

/**
 * 異常の検知とアラート（/alerts）
 * 稼動月は ?m=YYYY-MM、状態の絞り込みは ?status=open|resolved|ignored|all（既定は未対応）。
 * 件数は DB ビュー v_alert_summary（未対応のみ）を使う。
 */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const status = alertFilterFromParam(sp.status);
  const { supabase, profile, company } = await requireStaff();

  const [alerts, summary] = await Promise.all([
    loadAlerts(supabase, company.id, { status, month, limit: LIST_LIMIT }),
    loadAlertSummary(supabase, company.id, month),
  ]);

  const counts: SeverityCounts = {
    high: Number(summary?.high_count ?? 0),
    medium: Number(summary?.medium_count ?? 0),
    low: Number(summary?.low_count ?? 0),
  };

  return (
    <AlertsView
      month={month}
      status={status}
      alerts={alerts}
      counts={counts}
      lastDetectedAt={summary?.last_detected_at ?? null}
      canEdit={canEdit(profile.role)}
    />
  );
}
