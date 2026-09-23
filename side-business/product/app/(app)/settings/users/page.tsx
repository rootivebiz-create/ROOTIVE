import { Card } from "@/components/ui";
import { Badge, PageHeader } from "~/components/page";
import { ActionButton } from "~/components/settings/form-kit";
import { InviteForm, RoleForm } from "~/components/settings/user-forms";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { ROLE_HELP, ROLE_LABEL } from "~/server/features/settings/format";
import { listPendingInvites, listUsers } from "~/server/features/settings/users";
import { changeRoleAction, inviteAction, revokeInviteAction, setUserDisabledAction } from "./actions";

export const metadata = { title: "利用者" };

const fmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function UsersPage() {
  const user = await requirePageUser("owner");
  const db = await getDb();
  const [users, invites] = await Promise.all([listUsers(db, user.tenantId), listPendingInvites(db, user.tenantId)]);
  const activeOwners = users.filter((u) => u.role === "owner" && !u.disabledAt).length;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="利用者" description="この会社のしめ日ラボを使う人です。やめた人は消さずに「止める」（操作の記録に名前を残すため）。" />

      <section aria-labelledby="roles" className="space-y-2">
        <h2 id="roles" className="sr-only">
          役割の説明
        </h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          {(["owner", "staff", "viewer"] as const).map((r) => (
            <li key={r} className="rounded-lg border border-border bg-card p-3">
              <p className="font-bold">{ROLE_LABEL[r]}</p>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[r]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="list" className="space-y-2">
        <h2 id="list" className="text-lg font-bold">
          利用者（{users.filter((u) => !u.disabledAt).length}人）
        </h2>
        <ul className="space-y-2">
          {users.map((u) => {
            const self = u.id === user.id;
            const lastOwner = u.role === "owner" && !u.disabledAt && activeOwners <= 1;
            return (
              <li key={u.id}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold">{u.name}</span>
                    <span className="min-w-0 break-all text-sm text-muted-foreground">{u.email}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={u.role === "owner" ? "green" : "gray"}>{ROLE_LABEL[u.role]}</Badge>
                    {self && <Badge>あなた</Badge>}
                    {u.disabledAt && <Badge tone="red">止めています（{fmt.format(u.disabledAt)}から）</Badge>}
                    {!u.hasPassword && !u.disabledAt && <Badge tone="yellow">パスワードをまだ決めていません</Badge>}
                  </div>
                  {lastOwner ? (
                    <p className="text-xs text-muted-foreground">
                      ただ 1 人のオーナーなので、役割を変えたり止めたりできません。先にほかの方をオーナーにしてください。
                    </p>
                  ) : (
                    <>
                      <RoleForm action={changeRoleAction} id={u.id} role={u.role} self={self} name={u.name} />
                      {!self && (
                        <ActionButton
                          action={setUserDisabledAction}
                          hidden={{ id: u.id, disabled: u.disabledAt ? "0" : "1" }}
                          label={u.disabledAt ? "再開する" : "止める"}
                          danger={!u.disabledAt}
                          confirm={
                            u.disabledAt ? undefined : (
                              <p>
                                {u.name}さんを止めます。すぐにログインできなくなります（ログイン中でも切れます）。あとで「再開する」で戻せます。
                              </p>
                            )
                          }
                          confirmLabel="止める"
                        />
                      )}
                    </>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="invite" className="space-y-2">
        <h2 id="invite" className="text-lg font-bold">
          招待する
        </h2>
        <Card>
          <InviteForm action={inviteAction} />
        </Card>
      </section>

      <section aria-labelledby="pending" className="space-y-2">
        <h2 id="pending" className="text-lg font-bold">
          まだ使われていない招待
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">ありません。</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.tokenHash}>
                <Card className="space-y-2 text-sm">
                  <p>
                    <span className="font-bold">{i.name}</span> <span className="break-all text-muted-foreground">{i.email}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABEL[i.role] ?? i.role}・{fmt.format(i.createdAt)} に作成・{fmt.format(i.expiresAt)} まで
                  </p>
                  <p className="text-xs text-muted-foreground">リンクは作ったときにしか表示しません。なくしたときは、もう一度招待すると新しいリンクになります（古いリンクは使えなくなります）。</p>
                  <ActionButton
                    action={revokeInviteAction}
                    hidden={{ token: i.tokenHash }}
                    label="取り消す"
                    danger
                    confirm={<p>{i.email} への招待を取り消します。そのリンクは使えなくなります。</p>}
                    confirmLabel="取り消す"
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
