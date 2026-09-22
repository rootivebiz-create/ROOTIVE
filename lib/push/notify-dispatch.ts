import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { pushLineMessages } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { appUrl } from "@/lib/env";
import { canSendPush } from "./config";
import { loadSubscriptions, sendPush } from "./send";
import { dispatchLineText, dispatchPushPayload, type DispatchLine } from "./targets";

/**
 * 「明日の配車」をドライバーへ知らせる（サーバー専用・前日の夕方に 1 回）。
 *
 * - **確定した配車だけ**送る（予定のままのものは送らない）
 * - 一度知らせたものは `notified_at` が入るので二度送らない。
 *   内容が変わると `set_dispatch_bulk` が印を外すので、変わったときだけ送り直す
 * - サービスロールで動く＝ RLS が効かないため、すべて company_id で絞る
 */

export interface NotifyDispatchResult {
  drivers: number;
  push: number;
  line: number;
  marked: number;
}

/** 「9月23日（水）」 */
function dateLabel(date: string): string {
  const [, m, d] = date.split("-");
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(m)}月${Number(d)}日（${w}）`;
}

function unitSuffixOf(unit: string | null): string {
  return unit === "day" ? "日" : "個";
}

export async function notifyTomorrowDispatch(companyId: string, onDate: string): Promise<NotifyDispatchResult> {
  const result: NotifyDispatchResult = { drivers: 0, push: 0, line: 0, marked: 0 };
  if (!hasServiceRoleKey()) return result;

  const admin = createAdminClient();
  const [rowsRes, companyRes] = await Promise.all([
    admin
      .from("v_dispatch_list")
      .select("id, on_date, driver_id, driver_name, project_name, item_name, unit, qty_plan, status, notified_at")
      .eq("company_id", companyId)
      .eq("on_date", onDate)
      .eq("status", "confirmed")
      .is("notified_at", null),
    admin.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
  ]);
  if (rowsRes.error) return result;
  const rows = rowsRes.data ?? [];
  if (rows.length === 0) return result;

  const companyName = companyRes.data?.name ?? "";
  const driverIds = [...new Set(rows.map((r) => r.driver_id).filter((v): v is string => Boolean(v)))];

  const [driversRes, profilesRes] = await Promise.all([
    admin.from("drivers").select("id, name, line_user_id").eq("company_id", companyId).in("id", driverIds),
    admin.from("profiles").select("id, driver_id, is_active").eq("company_id", companyId).eq("is_active", true),
  ]);
  const lineOf = new Map((driversRes.data ?? []).map((d) => [d.id, (d.line_user_id ?? "").trim()]));
  const profileOf = new Map<string, string>();
  for (const p of profilesRes.data ?? []) if (p.driver_id) profileOf.set(p.driver_id, p.id);

  const label = dateLabel(onDate);
  const lineItems: { to: string; text: string; label: string }[] = [];
  const pushJobs: { profileId: string; lines: DispatchLine[] }[] = [];
  const sentIds: string[] = [];

  for (const driverId of driverIds) {
    const mine = rows.filter((r) => r.driver_id === driverId);
    if (mine.length === 0) continue;
    result.drivers += 1;
    const lines: DispatchLine[] = mine.map((r) => ({
      label: `${r.project_name ?? ""}${r.item_name && r.item_name !== "標準" ? `（${r.item_name}）` : ""}`,
      qtyPlan: Number(r.qty_plan ?? 0),
      unitSuffix: unitSuffixOf(r.unit),
    }));
    for (const r of mine) if (r.id) sentIds.push(r.id);

    const profileId = profileOf.get(driverId);
    if (profileId) pushJobs.push({ profileId, lines });
    const to = lineOf.get(driverId);
    if (to) {
      lineItems.push({
        to,
        text: dispatchLineText({ companyName, dateLabel: label, lines, appUrl: appUrl() }),
        label: mine[0].driver_name ?? "",
      });
    }
  }

  if (canSendPush() && pushJobs.length > 0) {
    try {
      const byProfile = await loadSubscriptions(admin, companyId, pushJobs.map((j) => j.profileId));
      for (const job of pushJobs) {
        const subs = byProfile.get(job.profileId) ?? [];
        if (subs.length === 0) continue;
        const r = await sendPush(admin, companyId, subs, dispatchPushPayload({ dateLabel: label, lines: job.lines }));
        result.push += r.sent;
      }
    } catch {
      /* 通知が飛ばなくても配車は決まっている */
    }
  }

  if (lineItems.length > 0) {
    try {
      const results = await pushLineMessages(companyId, lineItems);
      result.line = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        await logIntegration(companyId, "line", "dispatch_tomorrow", "error", `${failed.length} 件の送信に失敗しました: ${failed[0].error}`);
      }
    } catch (e) {
      await logIntegration(companyId, "line", "dispatch_tomorrow", "error", e instanceof Error ? e.message : String(e));
    }
  }

  // 知らせた印を付ける（送れた人がいなくても、確定済みの同じ内容を毎日送らないようにする）
  if (sentIds.length > 0) {
    const { data } = await admin.rpc("mark_dispatch_notified", { p_company_id: companyId, p_ids: sentIds });
    result.marked = Number(data ?? 0);
  }
  return result;
}
