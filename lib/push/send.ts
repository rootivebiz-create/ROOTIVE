import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { canSendPush, vapidPublicKey, vapidSubject } from "./config";
import type { PushPayload } from "./targets";

/**
 * 端末へのプッシュ通知の送信（サーバー専用）。
 *
 * - **サービスロールで動く＝ RLS が効かない**ので、すべてのクエリを company_id で絞る
 * - 送信先が無効になっていたら（404 / 410）その場で購読を消す。次から無駄に送らない
 * - 1 件の失敗で全体を止めない。通知は「届けばうれしい」もので、業務は止めない
 */

type Admin = SupabaseClient<Database>;

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendPushResult {
  sent: number;
  removed: number;
  failed: number;
}

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  webpush.setVapidDetails(vapidSubject(), vapidPublicKey, process.env.VAPID_PRIVATE_KEY ?? "");
  configured = true;
}

/** この会社の、この人たちの端末を集める */
export async function loadSubscriptions(admin: Admin, companyId: string, profileIds: string[]): Promise<Map<string, PushSubscriptionRow[]>> {
  const out = new Map<string, PushSubscriptionRow[]>();
  if (profileIds.length === 0) return out;
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, profile_id, endpoint, p256dh, auth")
    .eq("company_id", companyId)
    .in("profile_id", profileIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const list = out.get(row.profile_id) ?? [];
    list.push({ id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
    out.set(row.profile_id, list);
  }
  return out;
}

/** 無効になった購読を消す（端末を初期化した・通知を切ったあとなど） */
async function removeSubscription(admin: Admin, companyId: string, id: string): Promise<void> {
  await admin.from("push_subscriptions").delete().eq("company_id", companyId).eq("id", id);
}

/** 端末へ送る。無効な送信先は片付ける */
export async function sendPush(admin: Admin, companyId: string, subs: PushSubscriptionRow[], payload: PushPayload): Promise<SendPushResult> {
  const result: SendPushResult = { sent: 0, removed: 0, failed: 0 };
  if (!canSendPush() || subs.length === 0) return result;
  ensureConfigured();
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 60 * 60 * 12 });
      result.sent += 1;
    } catch (e) {
      const status = typeof e === "object" && e != null && "statusCode" in e ? Number((e as { statusCode?: number }).statusCode) : 0;
      if (status === 404 || status === 410) {
        // 送信先がもう無い（端末側で購読が消えた）。次から送らないように片付ける
        await removeSubscription(admin, companyId, sub.id).catch(() => undefined);
        result.removed += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  if (result.sent > 0) {
    const ids = subs.map((s) => s.id);
    await admin
      .from("push_subscriptions")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .in("id", ids)
      .then(() => undefined, () => undefined);
  }
  return result;
}
