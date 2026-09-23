import Link from "next/link";
import { Card } from "@/components/ui";
import { Badge, EmptyState, PageHeader } from "~/components/page";
import { ClientForm } from "~/components/settings/client-form";
import { ActionButton } from "~/components/settings/form-kit";
import { Expand } from "~/components/settings/list-bits";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listClients } from "~/server/features/settings/clients";
import { createClientAction, deleteClientAction, updateClientAction } from "./actions";

export const metadata = { title: "元請" };

export default async function ClientsPage() {
  const user = await requirePageUser("viewer");
  const canEdit = roleAtLeast(user.role, "staff");
  const db = await getDb();
  const clients = await listClients(db, user.tenantId);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="元請" description="仕事をくれる会社（荷主）です。案件と支払通知の突合に使います。" />

      {canEdit && (
        <Card>
          <Expand summary="元請を追加" open={clients.length === 0}>
            <ClientForm action={createClientAction} submitLabel="追加する" />
          </Expand>
        </Card>
      )}

      {clients.length === 0 ? (
        <EmptyState title="まだ元請がいません">
          <p>元請を足してから、案件（仕事の種類と単価）を登録します。元請が 1 社だけでも登録しておくと、支払通知との突合に使えます。</p>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => {
            const used = c.projects + c.notices > 0;
            return (
              <li key={c.id}>
                <Card className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold">{c.name}</span>
                    <span className="text-xs text-muted-foreground">締め：{c.closingDay === 0 ? "末日" : `${c.closingDay}日`}</span>
                  </div>
                  {c.aliases.length > 0 && <p className="text-xs text-muted-foreground">別名：{c.aliases.join("、")}</p>}
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={c.activeProjects ? "green" : "gray"}>案件 {c.activeProjects}件</Badge>
                    {c.projects > c.activeProjects && <Badge>使わない案件 {c.projects - c.activeProjects}件</Badge>}
                    {c.notices > 0 && <Badge>支払通知 {c.notices}件</Badge>}
                  </div>
                  {c.notes && <p className="text-sm">{c.notes}</p>}
                  <Link href={`/settings/projects?client=${c.id}`} className="inline-flex min-h-11 items-center text-sm">
                    この元請の案件と単価 →
                  </Link>
                  {canEdit && (
                    <Expand summary="直す・消す">
                      <ClientForm
                        action={updateClientAction}
                        initial={{ id: c.id, name: c.name, aliases: c.aliases.join("、"), closingDay: c.closingDay, notes: c.notes ?? "" }}
                        submitLabel="保存"
                      />
                      <div className="border-t border-border pt-3">
                        {used ? (
                          <p className="text-sm text-muted-foreground">
                            案件か支払通知で使われているので消せません。使わなくなったときは、この元請の案件を「使わない」にすれば、取り込みの候補に出なくなります。
                          </p>
                        ) : (
                          <ActionButton
                            action={deleteClientAction}
                            hidden={{ id: c.id }}
                            label="消す"
                            danger
                            confirm={<p>「{c.name}」を消します。元に戻せません。</p>}
                            confirmLabel="消す"
                          />
                        )}
                      </div>
                    </Expand>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
