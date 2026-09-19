import { requireDriver } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForms } from "@/components/driver/account-forms";
import { LineLinkCard } from "@/components/driver/line-link-card";

export const metadata = { title: "アカウント" };

export default async function DriverAccountPage() {
  const { supabase, profile, driverId } = await requireDriver();
  const { data: driver } = await supabase.from("drivers").select("line_user_id, line_linked_at").eq("id", driverId).maybeSingle();
  const linked = (driver?.line_user_id ?? "").trim().length > 0;

  return (
    <div>
      <PageHeader title="アカウント" description="表示名の変更とパスワードの設定、LINE との連携ができます。" />
      <AccountForms displayName={profile.display_name} email={profile.email} />
      <div className="mt-4">
        <LineLinkCard linked={linked} linkedAt={driver?.line_linked_at ?? null} />
      </div>
    </div>
  );
}
