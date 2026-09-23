import Link from "next/link";
import { cookies } from "next/headers";
import { Card } from "@/components/ui";
import { Badge, Notice, PageHeader } from "~/components/page";
import { ActionButton, Section } from "~/components/settings/form-kit";
import { PasswordForm } from "~/components/settings/password-form";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { loadAccount, PASSWORD_MIN, RECENT_LOGINS, SESSION_COOKIE, sessionIdFromToken } from "~/server/features/settings/account";
import { jstDateTimeText, ROLE_HELP, ROLE_LABEL } from "~/server/features/settings/format";
import { changePasswordAction, signOutOthersAction } from "./actions";

export const metadata = { title: "自分のアカウント" };

/** 自分のアカウント（どの役割の人も）：パスワードを変える・ほかの端末からログアウト・最近のログイン */
export default async function AccountPage() {
  const user = await requirePageUser("viewer");
  const db = await getDb();
  const jar = await cookies();
  const a = await loadAccount(db, user.tenantId, user.id, sessionIdFromToken(jar.get(SESSION_COOKIE)?.value));
  const demo = process.env.DEMO_MODE === "1";
  const others = a.sessions.filter((x) => !x.current).length;

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="自分のアカウント" description="ログインのパスワードと、ログインの記録です。ここで変えられるのは自分のぶんだけです。" />

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">名前</dt>
          <dd className="min-w-0 break-words font-bold">{a.name}</dd>
          <dt className="text-muted-foreground">メールアドレス</dt>
          <dd className="min-w-0 break-all">{a.email}</dd>
          <dt className="text-muted-foreground">役割</dt>
          <dd className="min-w-0">
            <span className="font-bold">{ROLE_LABEL[a.role]}</span>
            <span className="ml-1 text-muted-foreground">（{ROLE_HELP[a.role]}）</span>
          </dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">名前・メールアドレス・役割を変えるときは、オーナーに頼んでください{user.role === "owner" && <>（<Link href="/settings/users">利用者</Link>の画面）</>}。</p>
      </Card>

      {demo ? (
        <Notice tone="info">デモではパスワードを使いません。お客様の本番では、ここで自分のパスワードを変えられます。</Notice>
      ) : (
        <Section title="パスワードを変える" description="今のパスワードを入れてから、新しいパスワードを 2 回入れてください。変えると、ほかの端末のログインは切れます（この端末はそのままです）。">
          {a.hasPassword ? (
            <PasswordForm action={changePasswordAction} email={a.email} minLength={PASSWORD_MIN} />
          ) : (
            <p className="text-sm">まだパスワードが決まっていません。招待のリンクから決めてください（リンクが切れていたら、オーナーに作り直してもらってください）。</p>
          )}
        </Section>
      )}

      <Section
        title="ログイン中の端末"
        description="スマホ・パソコンなど、いまログインしている所です。心当たりのない所があれば、ほかの端末からログアウトして、パスワードを変えてください。"
      >
        <ul className="space-y-2">
          {a.sessions.map((x, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border p-3 text-sm">
              <span>{jstDateTimeText(x.createdAt)} にログイン</span>
              {x.current && <Badge tone="green">この端末</Badge>}
              <span className="w-full text-xs text-muted-foreground">{jstDateTimeText(x.expiresAt)} まで有効</span>
            </li>
          ))}
        </ul>
        {demo ? null : others > 0 ? (
          <ActionButton
            action={signOutOthersAction}
            hidden={{}}
            label={`ほかの端末（${others}か所）からログアウトする`}
            confirm={<p>この端末のほかの {others}か所 のログインを切ります。その端末では、もう一度ログインが要ります。</p>}
            confirmLabel="ログアウトさせる"
          />
        ) : (
          <p className="text-sm text-muted-foreground">この端末のほかには、ログインしていません。</p>
        )}
      </Section>

      <Section title={`最近のログイン（${RECENT_LOGINS}回まで）`}>
        {a.logins.length === 0 ? (
          <p className="text-sm text-muted-foreground">ログインの記録はまだありません（パスワードでログインすると、ここに残ります）。</p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border text-sm">
            {a.logins.map((at, i) => (
              <li key={i} className="flex min-h-11 items-center px-3 num">
                {jstDateTimeText(at)}
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">身に覚えのないログインがあれば、パスワードを変え、ほかの端末からログアウトしてから、オーナーにも知らせてください。</p>
      </Section>

      <p className="text-sm">
        使い方で困ったときは <Link href="/help">ヘルプ</Link> をご覧ください。
      </p>
    </div>
  );
}
