import { canEdit, requireStaff } from "@/lib/auth/session";
import { toAccessOverrides } from "@/lib/auth/access";
import { ROLE_LABELS } from "@/lib/db/types";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessSummary } from "@/components/settings/users/access-summary";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForms } from "@/components/settings/account/account-forms";
import { StartPageCard } from "@/components/settings/account/start-page-card";
import { startPageOf } from "@/lib/schemas/office";

export const metadata = { title: "アカウント" };

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile, access } = await requireStaff();
  // 最初に開く画面を選べるのは、ホーム（経営の数字）を見る人だけ（事務員はいつも事務。0027・0029）
  const choosesStart = profile.role !== "clerk" && access.management;
  const sp = await searchParams;
  const reset = (Array.isArray(sp.reset) ? sp.reset[0] : sp.reset) === "1";

  return (
    <div>
      <PageHeader title="アカウント" description={choosesStart ? "表示名・パスワード・最初に開く画面を変えられます。" : "表示名・パスワードを変えられます。"} />
      {reset && (
        <Alert variant="warning" className="mb-4">
          新しいパスワードを設定してください。
        </Alert>
      )}
      <div className="space-y-6">
        <AccountForms displayName={profile.display_name} email={profile.email} role={profile.role} focusPassword={reset} />
        {/* 事務員（0027）と、経営の数字を見せない設定の人（0029）はホームを開かないので選ばせない */}
        {choosesStart && <StartPageCard initial={startPageOf(profile.start_page)} canUseOffice={canEdit(profile.role)} />}
        <Card>
          <CardHeader>
            <CardTitle>見られる範囲</CardTitle>
            <CardDescription>
              {profile.role === "owner"
                ? "代表はすべて見られます。"
                : `${ROLE_LABELS[profile.role]}としての範囲です。変えたいときは代表に頼んでください（設定 → ユーザー管理）。`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccessSummary access={access} overrides={toAccessOverrides(profile.access_overrides)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
