"use server";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/actions/result";
import { notifyPrefsSchema, pushSubscriptionSchema, type NotifyPrefsInput, type PushSubscriptionInput } from "@/lib/schemas/notifications";
import { canSendPush } from "@/lib/push/config";

/**
 * 通知の Server Actions
 *
 * 購読と設定は **本人のもの** だけを触る（ドライバーも自分の通知を受け取れる）。
 * DB 側も RLS と RPC（save_push_subscription / delete_push_subscription / set_notify_prefs）で本人に限定している。
 */

/** ログインしていれば誰でも（ドライバーを含む） */
const ANY_ROLE = ["owner", "admin", "clerk", "viewer", "driver"] as const;

function revalidateNotifications(): void {
  revalidatePath("/settings/notifications");
}

/** この端末で通知を受け取る（同じ端末を登録し直しても増えない） */
export async function savePushSubscriptionAction(input: PushSubscriptionInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase } = await requireActionRole([...ANY_ROLE]);
    const v = pushSubscriptionSchema.parse(input);
    const { data, error } = await supabase.rpc("save_push_subscription", {
      p_endpoint: v.endpoint,
      p_p256dh: v.p256dh,
      p_auth: v.auth,
      p_user_agent: v.user_agent,
      p_label: v.label,
    });
    if (error) throw error;
    revalidateNotifications();
    return { id: String(data ?? "") };
  }, "この端末で通知を受け取ります");
}

/** この端末の通知をやめる */
export async function deletePushSubscriptionAction(endpoint: string): Promise<ActionResult<{ removed: number }>> {
  return runAction(async () => {
    const { supabase } = await requireActionRole([...ANY_ROLE]);
    const { data, error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
    if (error) throw error;
    revalidateNotifications();
    return { removed: Number(data ?? 0) };
  }, "この端末の通知をやめました");
}

/** 受け取り方を変える */
export async function setNotifyPrefsAction(input: NotifyPrefsInput): Promise<ActionResult<{ notify_chat: string }>> {
  return runAction(async () => {
    const { supabase } = await requireActionRole([...ANY_ROLE]);
    const v = notifyPrefsSchema.parse(input);
    const { error } = await supabase.rpc("set_notify_prefs", { p_notify_chat: v.notify_chat, p_notify_line: v.notify_line });
    if (error) throw error;
    revalidateNotifications();
    return { notify_chat: v.notify_chat };
  }, "通知の設定を保存しました");
}

/** 自分の端末へテストの通知を送る（ちゃんと届くか、その場で確かめる） */
export async function sendTestPushAction(): Promise<ActionResult<{ sent: number }>> {
  return runAction(async () => {
    const ctx = await requireActionRole([...ANY_ROLE]);
    if (!canSendPush()) throw new ActionError("この環境では端末への通知を使えません（管理者に VAPID の設定を確認してください）。");

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { loadSubscriptions, sendPush } = await import("@/lib/push/send");
    const admin = createAdminClient();
    const byProfile = await loadSubscriptions(admin, ctx.company.id, [ctx.profile.id]);
    const subs = byProfile.get(ctx.profile.id) ?? [];
    if (subs.length === 0) throw new ActionError("この端末はまだ通知を受け取る設定になっていません。");

    const result = await sendPush(admin, ctx.company.id, subs, {
      title: "ROOTIVE 利益管理",
      body: "テストの通知です。これが見えていれば設定は完了しています。",
      url: "/settings/notifications",
      tag: "test",
    });
    if (result.sent === 0) throw new ActionError("通知を送れませんでした。端末の設定でこのサイトの通知が許可されているか確認してください。");
    return { sent: result.sent };
  }, "テストの通知を送りました");
}
