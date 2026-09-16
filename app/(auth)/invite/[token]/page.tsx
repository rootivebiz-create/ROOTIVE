import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { ROLE_LABELS } from "@/lib/db/types";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "招待" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!hasServiceRoleKey()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>招待リンク</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が不足しています。管理者に連絡してください。</Alert>
        </CardContent>
      </Card>
    );
  }
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invitations").select("email, role, display_name, expires_at, accepted_at, cancelled_at, link_used_at, company_id").eq("token", token).maybeSingle();
  const company = inv ? (await admin.from("companies").select("name").eq("id", inv.company_id).maybeSingle()).data : null;

  let problem: string | null = null;
  if (!inv) problem = "招待リンクが見つかりません。URL を確認してください。";
  else if (inv.cancelled_at) problem = "この招待は取り消されています。";
  else if (inv.link_used_at) problem = "この招待リンクは既に使用されています。ログイン画面からメールアドレスでログインしてください。";
  else if (new Date(inv.expires_at).getTime() < Date.now()) problem = "招待リンクの有効期限が切れています。オーナーに再送を依頼してください。";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{company?.name ?? "ROOTIVE 利益管理"} への招待</CardTitle>
        <CardDescription>{inv && !problem ? "下のボタンを押すとログインします（メール不要）。" : "招待の確認"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {problem ? (
          <>
            <Alert variant="destructive">{problem}</Alert>
            <a href="/login" className="block text-center text-sm text-primary underline">
              ログイン画面へ
            </a>
          </>
        ) : (
          inv && (
            <>
              <dl className="grid grid-cols-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">メール</dt>
                <dd className="col-span-2 break-all">{inv.email}</dd>
                <dt className="text-muted-foreground">権限</dt>
                <dd className="col-span-2">{ROLE_LABELS[inv.role]}</dd>
                {inv.display_name && (
                  <>
                    <dt className="text-muted-foreground">表示名</dt>
                    <dd className="col-span-2">{inv.display_name}</dd>
                  </>
                )}
              </dl>
              <AcceptInviteForm token={token} />
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
