import Link from "next/link";
import { Card } from "@/components/ui";
import { Badge, EmptyState, PageHeader } from "~/components/page";
import { ClientActiveForm } from "~/components/settings/client-active-form";
import { ClientForm } from "~/components/settings/client-form";
import { ActionButton } from "~/components/settings/form-kit";
import { Expand } from "~/components/settings/list-bits";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listClients, restorableProjectCount, type ClientListItem } from "~/server/features/settings/clients";
import { createClientAction, deleteClientAction, setClientActiveAction, updateClientAction } from "./actions";

export const metadata = { title: "元請" };

export default async function ClientsPage() {
  const user = await requirePageUser("viewer");
  const canEdit = roleAtLeast(user.role, "staff");
  const db = await getDb();
  const clients = await listClients(db, user.tenantId);
  const active = clients.filter((c) => c.active);
  const inactive = clients.filter((c) => !c.active);
  // 戻すときに一緒に戻せる案件の数（無効の元請だけ）
  const restorable = new Map(await Promise.all(inactive.map(async (c) => [c.id, await restorableProjectCount(db, user.tenantId, c.id)] as const)));

  const card = (c: ClientListItem) => {
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
            {!c.active && <Badge>取引をやめた元請</Badge>}
            <Badge tone={c.activeProjects ? "green" : "gray"}>案件 {c.activeProjects}件</Badge>
            {c.projects > c.activeProjects && <Badge>使わない案件 {c.projects - c.activeProjects}件</Badge>}
            {c.notices > 0 && <Badge>支払通知 {c.notices}件</Badge>}
          </div>
          {c.notes && <p className="text-sm">{c.notes}</p>}
          <Link href={`/settings/projects?client=${c.id}`} className="inline-flex min-h-11 items-center text-sm">
            この元請の案件と単価 →
          </Link>
          {canEdit && c.active && (
            <Expand summary="直す・取引をやめる・消す">
              <ClientForm
                action={updateClientAction}
                initial={{ id: c.id, name: c.name, aliases: c.aliases.join("、"), closingDay: c.closingDay, notes: c.notes ?? "" }}
                submitLabel="保存"
              />
              <div className="space-y-3 border-t border-border pt-3">
                <ClientActiveForm action={setClientActiveAction} id={c.id} name={c.name} active activeProjects={c.activeProjects} restorableProjects={0} />
                {used ? (
                  <p className="text-sm text-muted-foreground">
                    案件か支払通知で使われているので消せません。取引をやめたときは「取引をやめる（無効にする）」を使ってください。記録はそのまま残ります。
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
          {canEdit && !c.active && (
            <div className="border-t border-border pt-3">
              <ClientActiveForm
                action={setClientActiveAction}
                id={c.id}
                name={c.name}
                active={false}
                activeProjects={c.activeProjects}
                restorableProjects={restorable.get(c.id) ?? 0}
              />
            </div>
          )}
        </Card>
      </li>
    );
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="元請" description="仕事をくれる会社（荷主）です。案件と支払通知の突合に使います。取引をやめた元請は、消さずに「無効」にします。" />

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
        <>
          {active.length === 0 ? (
            <EmptyState title="取引している元請がいません">
              <p>下の「無効の元請」から戻すか、「元請を追加」から足してください。</p>
            </EmptyState>
          ) : (
            <ul className="space-y-2">{active.map(card)}</ul>
          )}
          {inactive.length > 0 && (
            <section aria-labelledby="inactive-clients" className="space-y-2">
              <h2 id="inactive-clients" className="text-lg font-bold">
                無効の元請（{inactive.length}社）
              </h2>
              <p className="text-sm text-muted-foreground">取引をやめた元請です。案件の元請を選ぶところには出ません。過去の案件・お支払通知・明細は残っています。</p>
              <ul className="space-y-2">{inactive.map(card)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
