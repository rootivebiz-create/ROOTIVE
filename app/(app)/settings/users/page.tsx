import { requirePageRole } from "@/lib/auth/session";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InviteDialog, type DriverOption } from "@/components/settings/users/invite-dialog";
import { UsersTable, type UserRow } from "@/components/settings/users/users-table";
import { InvitationsTable, type InvitationRow, type InvitationStatus } from "@/components/settings/users/invitations-table";

export const metadata = { title: "ユーザー管理" };

const ROLE_ORDER = { owner: 0, admin: 1, clerk: 2, viewer: 3, driver: 4 } as const;

export default async function UsersSettingsPage() {
  const { supabase, company, user } = await requirePageRole(["owner"]);

  const [profilesRes, driversRes, invRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("company_id", company.id).order("created_at"),
    supabase.from("drivers").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("invitations").select("*").eq("company_id", company.id).is("cancelled_at", null).order("created_at", { ascending: false }).limit(200),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (driversRes.error) throw driversRes.error;
  if (invRes.error) throw invRes.error;

  // 最終ログイン日時は auth 側にしかないため、サービスロールで突き合わせる（キーが無い環境では非表示）
  const lastSignIn = new Map<string, string | null>();
  let lastSignInAvailable = false;
  let adminWarning: string | null = null;
  if (hasServiceRoleKey()) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      lastSignInAvailable = true;
      for (const u of data.users) lastSignIn.set(u.id, u.last_sign_in_at ?? null);
    } catch (e) {
      adminWarning = `最終ログイン日時を取得できませんでした（${e instanceof Error ? e.message : "unknown"}）。`;
    }
  } else {
    adminWarning = "サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、最終ログイン日時の表示と招待メールの送信はできません。招待リンクは発行できます。";
  }

  const drivers: DriverOption[] = (driversRes.data ?? []).map((d) => ({ id: d.id, name: d.name, isActive: d.is_active }));
  const driverName = new Map(drivers.map((d) => [d.id, d.name]));

  const users: UserRow[] = (profilesRes.data ?? [])
    .map((p) => ({
      id: p.id,
      email: p.email,
      displayName: p.display_name,
      role: p.role,
      driverId: p.driver_id,
      driverName: p.driver_id ? (driverName.get(p.driver_id) ?? null) : null,
      isActive: p.is_active,
      lastSignInAt: lastSignIn.get(p.id) ?? null,
      createdAt: p.created_at,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.email.localeCompare(b.email));

  const profileByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const now = Date.now();
  const base = appUrl();
  const invitations: InvitationRow[] = [];
  for (const inv of invRes.data ?? []) {
    const expired = new Date(inv.expires_at).getTime() < now;
    const prof = profileByEmail.get(inv.email.toLowerCase());
    // 招待の作成後にログインしている人には不要（メールのマジックリンクでログインした場合など）
    const signedInAfter = Boolean(prof && lastSignInAvailable && prof.lastSignInAt && new Date(prof.lastSignInAt).getTime() > new Date(inv.created_at).getTime());
    let status: InvitationStatus;
    if (!inv.accepted_at) {
      // 未受諾の招待は（本人がログイン済みでも）有効なので一覧に残し、取り消せるようにする
      status = expired ? "expired" : "pending";
    } else {
      // メール招待で auth ユーザー作成済み（受諾扱い）だが、まだログインしていない人にはリンクを再案内できる
      if (inv.link_used_at || expired || signedInAfter) continue;
      status = "registered";
    }
    invitations.push({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      displayName: inv.display_name,
      driverName: inv.driver_id ? (driverName.get(inv.driver_id) ?? null) : null,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      status,
      link: `${base}/invite/${inv.token}`,
    });
  }

  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div>
      <PageHeader title="ユーザー管理" description={`有効 ${activeCount} 名／全 ${users.length} 名。招待・ロール変更・無効化はオーナーのみ行えます。`} actions={<InviteDialog drivers={drivers} />} />
      {adminWarning && (
        <Alert variant="warning" className="mb-4">
          {adminWarning}
        </Alert>
      )}

      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-base font-semibold">ユーザー</h2>
          <UsersTable rows={users} drivers={drivers} selfId={user.id} lastSignInAvailable={lastSignInAvailable} />
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>招待</CardTitle>
              <CardDescription>未受諾の招待と、登録済みでまだログインしていない人への招待リンク。有効期限は作成から 7 日です。</CardDescription>
            </CardHeader>
            <CardContent>
              <InvitationsTable rows={invitations} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
