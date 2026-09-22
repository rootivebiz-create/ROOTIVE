import { requireDriver } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForms } from "@/components/driver/account-forms";
import { LineLinkCard } from "@/components/driver/line-link-card";
import { DeviceNotificationCard } from "@/components/settings/notifications/device-card";
import { isPushConfigured, vapidPublicKey } from "@/lib/push/config";

export const metadata = { title: "アカウント" };

export default async function DriverAccountPage() {
  const { supabase, profile, driverId } = await requireDriver();
  const [{ data: driver }, { data: devices }] = await Promise.all([
    supabase.from("drivers").select("line_user_id, line_linked_at").eq("id", driverId).maybeSingle(),
    // 自分の端末だけ（RLS が他人の端末を隠す）
    supabase.from("push_subscriptions").select("id, label, created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }),
  ]);
  const linked = (driver?.line_user_id ?? "").trim().length > 0;

  return (
    <div>
      <PageHeader title="アカウント" description="表示名の変更とパスワードの設定、LINE との連携と通知の受け取りができます。" />
      <AccountForms displayName={profile.display_name} email={profile.email} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <LineLinkCard linked={linked} linkedAt={driver?.line_linked_at ?? null} />
        <DeviceNotificationCard
          pushConfigured={isPushConfigured()}
          vapidPublicKey={vapidPublicKey}
          devices={(devices ?? []).map((d) => ({ id: d.id, label: d.label ?? "", createdAt: d.created_at ?? "" }))}
          description="稼働の承認・差戻しの結果を、この端末に通知で受け取れます。"
        />
      </div>
    </div>
  );
}
