import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { pushLineMessages } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { appUrl } from "@/lib/env";
import { canSendPush } from "./config";
import { loadSubscriptions, sendPush } from "./send";
import { chatLineText, chatPushPayload, shouldNotifyChat, shouldNotifyLine, type NotifyChatMode, type NotifyTarget } from "./targets";

/**
 * チャットの発言を知らせる（サーバー専用）。
 *
 * 発言の保存（RPC chat_post）が成功したあと、`after()` から呼ばれる。
 * **サービスロールで動く＝ RLS が効かない**ため、すべてのクエリを company_id で絞る。
 * 送信に失敗しても発言そのものは成立しているので、例外は投げずに記録だけ残す。
 */

/** チャットを使えるロール（ドライバーは対象外） */
const STAFF_ROLES = new Set(["owner", "admin", "clerk", "viewer"]);

export interface NotifyChatResult {
  push: { sent: number; removed: number; failed: number };
  line: number;
}

export async function notifyChatMessage(opts: {
  companyId: string;
  channelId: string;
  authorId: string;
  body: string;
  mentions: string[];
}): Promise<NotifyChatResult> {
  const result: NotifyChatResult = { push: { sent: 0, removed: 0, failed: 0 }, line: 0 };
  if (!hasServiceRoleKey()) return result;

  const admin = createAdminClient();

  const [channelRes, staffRes] = await Promise.all([
    admin.from("chat_channels").select("id, name").eq("company_id", opts.companyId).eq("id", opts.channelId).maybeSingle(),
    admin
      .from("profiles")
      .select("id, display_name, email, role, is_active, notify_chat, notify_line, line_user_id")
      .eq("company_id", opts.companyId)
      .eq("is_active", true),
  ]);
  if (channelRes.error || staffRes.error) return result;

  const channelName = channelRes.data?.name ?? "";
  const staff = (staffRes.data ?? []).filter((p) => STAFF_ROLES.has(String(p.role)));
  const author = staff.find((p) => p.id === opts.authorId);
  const authorName = (author?.display_name ?? "").trim() || (author?.email ?? "").split("@")[0] || "だれか";

  const targets: NotifyTarget[] = staff.map((p) => ({
    profileId: p.id,
    notifyChat: (p.notify_chat ?? "mention") as NotifyChatMode,
    notifyLine: p.notify_line ?? true,
    lineUserId: (p.line_user_id ?? "").trim(),
  }));

  const pushTargets = targets.filter((t) => shouldNotifyChat(t, { authorId: opts.authorId, mentions: opts.mentions }));
  const lineTargets = targets.filter((t) => shouldNotifyLine(t, { authorId: opts.authorId, mentions: opts.mentions }));

  // ---- 端末への通知 ----
  if (canSendPush() && pushTargets.length > 0) {
    try {
      const byProfile = await loadSubscriptions(admin, opts.companyId, pushTargets.map((t) => t.profileId));
      for (const target of pushTargets) {
        const subs = byProfile.get(target.profileId) ?? [];
        if (subs.length === 0) continue;
        const payload = chatPushPayload({
          channelId: opts.channelId,
          channelName,
          authorName,
          body: opts.body,
          mentioned: opts.mentions.includes(target.profileId),
        });
        const r = await sendPush(admin, opts.companyId, subs, payload);
        result.push.sent += r.sent;
        result.push.removed += r.removed;
        result.push.failed += r.failed;
      }
    } catch {
      // 通知が飛ばなくても発言は保存できている
    }
  }

  // ---- LINE への転送（自分あてだけ） ----
  if (lineTargets.length > 0) {
    const text = chatLineText({ channelName, authorName, body: opts.body, appUrl: appUrl(), channelId: opts.channelId });
    try {
      const results = await pushLineMessages(
        opts.companyId,
        lineTargets.map((t) => ({ to: t.lineUserId, text, label: t.profileId })),
      );
      result.line = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        await logIntegration(opts.companyId, "line", "chat_mention", "error", `${failed.length} 件の送信に失敗しました: ${failed[0].error}`);
      }
    } catch (e) {
      // LINE 未連携なら通知だけ落ちる（記録に残して終わり）
      await logIntegration(opts.companyId, "line", "chat_mention", "error", e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}
