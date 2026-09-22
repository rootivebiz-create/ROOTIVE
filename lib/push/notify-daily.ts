import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { pushLineMessages } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { appUrl } from "@/lib/env";
import { canSendPush } from "./config";
import { loadSubscriptions, sendPush } from "./send";
import { dayEntryLineText, dayEntryPushPayload, formatDayLabel } from "./targets";

/**
 * 稼働報告の承認・差戻しをドライバー本人へ知らせる（サーバー専用）。
 *
 * ドライバーにとって「出した報告がどうなったか」は待っている情報なので、
 * チャットの設定（notify_chat）とは分けて、連携していれば必ず送る。
 * **サービスロールで動く＝ RLS が効かない**ので company_id で必ず絞る。
 */

export interface NotifyDayEntriesResult {
  push: number;
  line: number;
}

export async function notifyDayEntriesDecision(opts: {
  companyId: string;
  approved: boolean;
  reason: string;
  /** 対象の行（driver_id と work_date） */
  rows: { driver_id: string; work_date: string }[];
}): Promise<NotifyDayEntriesResult> {
  const result: NotifyDayEntriesResult = { push: 0, line: 0 };
  if (!hasServiceRoleKey() || opts.rows.length === 0) return result;

  const admin = createAdminClient();
  const driverIds = Array.from(new Set(opts.rows.map((r) => r.driver_id).filter(Boolean)));
  if (driverIds.length === 0) return result;

  const [companyRes, driversRes, profilesRes] = await Promise.all([
    admin.from("companies").select("id, name").eq("id", opts.companyId).maybeSingle(),
    admin.from("drivers").select("id, name, line_user_id").eq("company_id", opts.companyId).in("id", driverIds),
    admin.from("profiles").select("id, driver_id, is_active").eq("company_id", opts.companyId).eq("is_active", true),
  ]);
  if (driversRes.error) return result;

  const companyName = companyRes.data?.name ?? "";
  const profileByDriver = new Map<string, string>();
  for (const p of profilesRes.data ?? []) {
    if (p.driver_id) profileByDriver.set(p.driver_id, p.id);
  }

  const lineItems: { to: string; text: string; label: string }[] = [];
  const pushJobs: { profileId: string; count: number; dateLabel: string }[] = [];

  for (const driver of driversRes.data ?? []) {
    const mine = opts.rows.filter((r) => r.driver_id === driver.id);
    if (mine.length === 0) continue;
    const dateLabel = formatDayLabel(mine.map((r) => r.work_date));
    const profileId = profileByDriver.get(driver.id);
    if (profileId) pushJobs.push({ profileId, count: mine.length, dateLabel });

    const to = (driver.line_user_id ?? "").trim();
    if (to) {
      lineItems.push({
        to,
        label: driver.name,
        text: dayEntryLineText({ companyName, approved: opts.approved, count: mine.length, dateLabel, reason: opts.reason, appUrl: appUrl() }),
      });
    }
  }

  // ---- 端末への通知 ----
  if (canSendPush() && pushJobs.length > 0) {
    try {
      const byProfile = await loadSubscriptions(admin, opts.companyId, pushJobs.map((j) => j.profileId));
      for (const job of pushJobs) {
        const subs = byProfile.get(job.profileId) ?? [];
        if (subs.length === 0) continue;
        const r = await sendPush(
          admin,
          opts.companyId,
          subs,
          dayEntryPushPayload({ approved: opts.approved, count: job.count, dateLabel: job.dateLabel, reason: opts.reason }),
        );
        result.push += r.sent;
      }
    } catch {
      /* 通知が飛ばなくても承認そのものは終わっている */
    }
  }

  // ---- LINE ----
  if (lineItems.length > 0) {
    try {
      const results = await pushLineMessages(opts.companyId, lineItems);
      result.line = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        await logIntegration(opts.companyId, "line", "day_entry_decision", "error", `${failed.length} 件の送信に失敗しました: ${failed[0].error}`);
      }
    } catch (e) {
      await logIntegration(opts.companyId, "line", "day_entry_decision", "error", e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}
