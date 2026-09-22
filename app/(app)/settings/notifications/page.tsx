import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationSettings } from "@/components/settings/notifications/notification-settings";
import { isPushConfigured, vapidPublicKey } from "@/lib/push/config";
import type { NotifyChatMode } from "@/lib/push/targets";

export const metadata = { title: "通知" };

export default async function NotificationSettingsPage() {
  const { supabase, profile } = await requireStaff();

  // 自分の端末だけ（RLS が他人の端末を隠す）
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, label, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="通知" description="チャットや承認の結果を、端末や LINE で受け取れるようにします。" />
      <NotificationSettings
        notifyChat={(profile.notify_chat ?? "mention") as NotifyChatMode}
        notifyLine={profile.notify_line ?? true}
        lineLinked={Boolean((profile.line_user_id ?? "").trim())}
        pushConfigured={isPushConfigured()}
        vapidPublicKey={vapidPublicKey}
        devices={(data ?? []).map((d) => ({ id: d.id, label: d.label ?? "", createdAt: d.created_at ?? "" }))}
      />
    </div>
  );
}
