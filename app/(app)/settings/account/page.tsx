import { requireStaff } from "@/lib/auth/session";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForms } from "@/components/settings/account/account-forms";
import { StartPageCard } from "@/components/settings/account/start-page-card";
import { startPageOf } from "@/lib/schemas/office";

export const metadata = { title: "アカウント" };

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireStaff();
  const sp = await searchParams;
  const reset = (Array.isArray(sp.reset) ? sp.reset[0] : sp.reset) === "1";

  return (
    <div>
      <PageHeader title="アカウント" description="表示名・パスワード・最初に開く画面を変えられます。" />
      {reset && (
        <Alert variant="warning" className="mb-4">
          新しいパスワードを設定してください。
        </Alert>
      )}
      <div className="space-y-6">
        <AccountForms displayName={profile.display_name} email={profile.email} role={profile.role} focusPassword={reset} />
        <StartPageCard initial={startPageOf(profile.start_page)} canUseOffice={profile.role === "owner" || profile.role === "admin"} />
      </div>
    </div>
  );
}
