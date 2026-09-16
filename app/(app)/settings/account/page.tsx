import { requireStaff } from "@/lib/auth/session";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForms } from "@/components/settings/account/account-forms";

export const metadata = { title: "アカウント" };

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireStaff();
  const sp = await searchParams;
  const reset = (Array.isArray(sp.reset) ? sp.reset[0] : sp.reset) === "1";

  return (
    <div>
      <PageHeader title="アカウント" description="表示名の変更とパスワードの設定ができます。" />
      {reset && (
        <Alert variant="warning" className="mb-4">
          新しいパスワードを設定してください。
        </Alert>
      )}
      <AccountForms displayName={profile.display_name} email={profile.email} role={profile.role} focusPassword={reset} />
    </div>
  );
}
