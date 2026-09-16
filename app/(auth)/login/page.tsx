import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";

export const metadata = { title: "ログイン" };
export const dynamic = "force-dynamic";

/** URL の error は固定コードのみ受け付ける（任意文言の表示によるフィッシング防止） */
const ERROR_MESSAGES: Record<string, string> = {
  expired: "リンクの有効期限が切れているか、無効です。もう一度ログインをお試しください。",
  invalid: "リンクが不正です。",
  failed: "ログインに失敗しました。もう一度お試しください。",
  inactive: "このアカウントは無効化されています。管理者にお問い合わせください。",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const code = typeof sp.error === "string" ? sp.error : undefined;
  const error = code ? ERROR_MESSAGES[code] : undefined;
  const nextRaw = typeof sp.next === "string" ? sp.next : "/dashboard";
  const next = /^\/(?![\/\\])[^\s]*$/.test(nextRaw) && !nextRaw.includes("\\") ? nextRaw : "/dashboard";

  // 既にログイン済みなら適切な画面へ。認証はあるが有効なプロフィールが無い（無効化・招待なし）場合はその旨を表示
  const ctx = await getSessionContext();
  if (ctx) redirect(ctx.profile.role === "driver" ? "/driver" : next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ログインできません</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">このアカウントは無効化されているか、招待が取り消されています。管理者（オーナー）にお問い合わせください。</Alert>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline" className="w-full">
              別のアカウントでログインする
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
        <CardDescription>招待されたメールアドレスでログインしてください。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}
        <LoginForm next={next} />
      </CardContent>
    </Card>
  );
}
