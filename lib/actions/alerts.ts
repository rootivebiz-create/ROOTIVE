"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/actions/result";
import { loadAlertSummary } from "@/lib/db/queries";
import { ALERT_STATUS_LABELS, type AlertStatus } from "@/lib/db/types";
import { detectAnomaliesSchema, setAlertStatusSchema, type SetAlertStatusInput } from "@/lib/schemas/alerts";
import { detectMessage, isStale, STALE_MINUTES, type DetectAnomaliesResult, type DetectIfStaleResult } from "@/lib/alerts/helpers";
import { monthToDate } from "@/lib/month";

/** アラートの変更が影響する画面 */
function revalidateAlerts(): void {
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** RPC の jsonb → DetectAnomaliesResult */
function toDetectResult(data: unknown): DetectAnomaliesResult {
  const o = (data ?? {}) as Record<string, unknown>;
  return { detected: toNumber(o.detected), open: toNumber(o.open), auto_resolved: toNumber(o.auto_resolved) };
}

/** 状態を変えたときのメッセージ */
function statusMessage(status: AlertStatus): string {
  return status === "open" ? "未対応に戻しました" : `${ALERT_STATUS_LABELS[status]}にしました`;
}

/**
 * その月の異常を洗い出す（admin 以上）。
 * 直っていたものは RPC 側で自動的に対応済みになる。件数入りの日本語メッセージを返す。
 */
export async function detectAnomaliesAction(month: string): Promise<ActionResult<DetectAnomaliesResult>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = detectAnomaliesSchema.parse({ month });
    const rpc = await supabase.rpc("detect_anomalies", { p_month: monthToDate(v.month) });
    if (rpc.error) throw rpc.error;
    revalidateAlerts();
    return toDetectResult(rpc.data);
  });
  return res.ok ? { ...res, message: detectMessage(res.data) } : res;
}

/**
 * 最終検査が 1 時間より古い（または 1 件も無い）ときだけ検査する（admin 以上）。
 * 画面を開いたときの自動検査に使う。実行しなかったときは ran: false（トーストも出さない）。
 */
export async function detectIfStaleAction(month: string): Promise<ActionResult<DetectIfStaleResult>> {
  const res = await runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = detectAnomaliesSchema.parse({ month });

    const summary = await loadAlertSummary(supabase, company.id, v.month);
    const lastDetectedAt = summary?.last_detected_at ?? null;
    if (!isStale(lastDetectedAt, new Date(), STALE_MINUTES)) {
      return { ran: false, last_detected_at: lastDetectedAt, detected: 0, open: toNumber(summary?.open_count), auto_resolved: 0 };
    }

    const rpc = await supabase.rpc("detect_anomalies", { p_month: monthToDate(v.month) });
    if (rpc.error) throw rpc.error;
    revalidateAlerts();
    return { ran: true, last_detected_at: lastDetectedAt, ...toDetectResult(rpc.data) };
  });
  return res.ok && res.data.ran ? { ...res, message: detectMessage(res.data) } : res;
}

/** アラートの状態を変える（admin 以上）。対応済み・対象外にすると未対応の一覧から外れる */
export async function setAlertStatusAction(input: SetAlertStatusInput): Promise<ActionResult<{ id: string; status: AlertStatus }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = setAlertStatusSchema.parse(input);
    const rpc = await supabase.rpc("set_alert_status", { p_alert_id: v.id, p_status: v.status, p_note: v.note });
    if (rpc.error) throw rpc.error;
    revalidateAlerts();
    return { id: v.id, status: v.status };
  });
  return res.ok ? { ...res, message: statusMessage(res.data.status) } : res;
}
