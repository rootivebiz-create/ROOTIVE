import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { pushLineMessages } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { appUrl } from "@/lib/env";
import { canSendPush } from "./config";
import { loadSubscriptions, sendPush } from "./send";
import { formatDayLabel, reportReminderLineText, reportReminderPushPayload } from "./targets";

/**
 * 「今日の報告がまだです」をドライバー本人へ知らせる（サーバー専用。0026 の事務から）。
 *
 * 宛先は RPC `record_report_reminders` が「今日まだ催促していなかった人」として返した人だけ
 * （同じ日に二度送らない判定は DB 側で済んでいる）。
 * **サービスロールで動く＝ RLS が効かない**ので company_id で必ず絞る。
 */

export interface NotifyReportReminderResult {
  push: number;
  line: number;
}

export async function notifyReportReminders(opts: { companyId: string; workDate: string; driverIds: string[] }): Promise<NotifyReportReminderResult> {
  const result: NotifyReportReminderResult = { push: 0, line: 0 };
  const driverIds = Array.from(new Set(opts.driverIds.filter(Boolean)));
  if (!hasServiceRoleKey() || driverIds.length === 0) return result;

  const admin = createAdminClient();
  const [companyRes, driversRes, profilesRes] = await Promise.all([
    admin.from("companies").select("id, name").eq("id", opts.companyId).maybeSingle(),
    admin.from("drivers").select("id, name, line_user_id").eq("company_id", opts.companyId).in("id", driverIds),
    admin.from("profiles").select("id, driver_id, is_active").eq("company_id", opts.companyId).eq("is_active", true),
  ]);
  if (driversRes.error) return result;

  const companyName = companyRes.data?.name ?? "";
  const dateLabel = formatDayLabel([opts.workDate]);
  const profileByDriver = new Map<string, string>();
  for (const p of profilesRes.data ?? []) {
    if (p.driver_id) profileByDriver.set(p.driver_id, p.id);
  }

  const profileIds: string[] = [];
  const lineItems: { to: string; text: string; label: string }[] = [];
  for (const driver of driversRes.data ?? []) {
    const profileId = profileByDriver.get(driver.id);
    if (profileId) profileIds.push(profileId);
    const to = (driver.line_user_id ?? "").trim();
    if (to) {
      lineItems.push({ to, label: driver.name, text: reportReminderLineText({ companyName, driverName: driver.name, dateLabel, appUrl: appUrl() }) });
    }
  }

  // ---- 端末への通知 ----
  if (canSendPush() && profileIds.length > 0) {
    try {
      const byProfile = await loadSubscriptions(admin, opts.companyId, profileIds);
      for (const profileId of profileIds) {
        const subs = byProfile.get(profileId) ?? [];
        if (subs.length === 0) continue;
        const r = await sendPush(admin, opts.companyId, subs, reportReminderPushPayload({ dateLabel }));
        result.push += r.sent;
      }
    } catch {
      /* 通知が飛ばなくても催促の記録そのものは残っている */
    }
  }

  // ---- LINE ----
  if (lineItems.length > 0) {
    try {
      const results = await pushLineMessages(opts.companyId, lineItems);
      result.line = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        await logIntegration(opts.companyId, "line", "report_reminder", "error", `${failed.length} 件の送信に失敗しました: ${failed[0].error}`);
      }
    } catch (e) {
      await logIntegration(opts.companyId, "line", "report_reminder", "error", e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}
