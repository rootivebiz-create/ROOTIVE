import { redirect } from "next/navigation";
import { AuthFrame } from "~/components/auth-frame";
import { LoginForm } from "~/components/auth-forms";
import { currentUser } from "~/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <AuthFrame title="ログイン">
      <LoginForm />
      <p className="mt-6 text-sm text-muted-foreground">パスワードを忘れたときは、社内のオーナーに招待リンクを作り直してもらってください。</p>
    </AuthFrame>
  );
}
