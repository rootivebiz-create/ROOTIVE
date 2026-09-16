import { requireDriver } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForms } from "@/components/driver/account-forms";

export const metadata = { title: "アカウント" };

export default async function DriverAccountPage() {
  const { profile } = await requireDriver();
  return (
    <div>
      <PageHeader title="アカウント" description="表示名の変更とパスワードの設定ができます。" />
      <AccountForms displayName={profile.display_name} email={profile.email} />
    </div>
  );
}
