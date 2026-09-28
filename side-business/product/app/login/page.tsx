import { redirect } from "next/navigation";
import { AuthFrame } from "~/components/auth-frame";
import { LoginForm } from "~/components/auth-forms";
import { supportContact } from "~/components/help/content";
import { SupportCard } from "~/components/help/help-parts";
import { currentUser } from "~/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン" };

export default async function LoginPage() {
  if (process.env.DEMO_MODE === "1") redirect("/demo/start");
  if (await currentUser()) redirect("/");
  const contact = supportContact({
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NEXT_PUBLIC_SUPPORT_LINE_URL: process.env.NEXT_PUBLIC_SUPPORT_LINE_URL,
  });
  return (
    <AuthFrame title="ログイン">
      <LoginForm />
      <section aria-labelledby="forgot" className="mt-8 space-y-2 text-sm">
        <h2 id="forgot" className="font-bold">
          パスワードを忘れたとき
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>社内のオーナーに頼んでください。オーナーが「設定 → 利用者」で、あなたを一度「止める」にします</li>
          <li>続けてオーナーが「招待のリンクを作る」を押し、そのリンクをあなたに渡します。リンクを開いて新しいパスワードを決めると入れます</li>
        </ol>
        <p className="text-muted-foreground">オーナーが 1 人だけで、そのオーナーが入れないときは、下の連絡先へご連絡ください。ご本人かを確かめてから、入り直しのリンクをお作りします。</p>
        <SupportCard contact={contact} />
      </section>
    </AuthFrame>
  );
}
