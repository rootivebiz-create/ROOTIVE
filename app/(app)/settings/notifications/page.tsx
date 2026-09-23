import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationSettings } from "@/components/settings/notifications/notification-settings";
import { LineLinkCard } from "@/components/driver/line-link-card";
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
      {/* 自分の LINE 連携（外部連携の設定を開けない事務員・閲覧者もここで連携できる） */}
      <div className="mt-4">
        <LineLinkCard
          linked={Boolean((profile.line_user_id ?? "").trim())}
          linkedAt={profile.line_linked_at ?? null}
          description="自分あてのチャット・承認待ちのお知らせを LINE で受け取れます。公式アカウントに「今月どう？」「支払は？」と送ると数字で答えます。"
        />
      </div>
    </div>
  );
}
