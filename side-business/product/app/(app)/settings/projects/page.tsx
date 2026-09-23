import Link from "next/link";
import { Card, Select } from "@/components/ui";
import { Badge, EmptyState, PageHeader } from "~/components/page";
import { ActionButton } from "~/components/settings/form-kit";
import { Expand, FilterChips, SearchBox } from "~/components/settings/list-bits";
import { ProjectForm } from "~/components/settings/project-form";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { clientPickerOptions, listClients } from "~/server/features/settings/clients";
import { marginOf, rateText } from "~/server/features/settings/format";
import { listProjects, usedProjectIds, type ProjectFilter } from "~/server/features/settings/projects";
import { createProjectAction, deleteProjectAction, setProjectActiveAction, updateProjectAction } from "./actions";

export const metadata = { title: "案件と単価" };

type SP = { q?: string; client?: string; status?: string };

function hrefWith(sp: SP, patch: Partial<SP>): string {
  const next = { ...sp, ...patch };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return qs ? `/settings/projects?${qs}` : "/settings/projects";
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const canEdit = roleAtLeast(user.role, "staff");
  const status: ProjectFilter["status"] = sp.status === "active" || sp.status === "inactive" ? sp.status : "all";
  const q = (sp.q ?? "").slice(0, 50);
  const db = await getDb();
  const [clients, all, used] = await Promise.all([listClients(db, user.tenantId), listProjects(db, user.tenantId), usedProjectIds(db, user.tenantId)]);
  const clientIds = new Set(clients.map((c) => c.id));
  const clientFilter = sp.client === "none" || (sp.client && clientIds.has(sp.client)) ? sp.client : undefined;
  const rows = await listProjects(db, user.tenantId, { q, status, clientId: clientFilter });
  // 案件の元請を選ぶところには、取引をやめた（無効の）元請を出さない
  const clientOptions = clientPickerOptions(clients);
  const inactiveClients = new Set(clients.filter((c) => !c.active).map((c) => c.id));
  const loss = all.filter((p) => p.active && p.payRate > p.billRate).length;

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="案件と単価"
        description="案件（元請 × 仕事の種類）ごとの、受注単価と支払単価（どちらも税抜）です。人ごとに違う支払単価は「人ごとの単価」で。"
      />

      {canEdit && (
        <Card>
          <Expand summary="案件を追加" open={all.length === 0}>
            {clientOptions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {clients.length === 0 ? "先に " : "取引している元請がありません（取引をやめた元請は選べません）。"}
                <Link href="/settings/clients">元請</Link> を足しておくと、案件と元請を結びつけられます（元請なしでも登録できます）。
              </p>
            )}
            <ProjectForm action={createProjectAction} clients={clientOptions} submitLabel="追加する" />
          </Expand>
        </Card>
      )}

      {all.length === 0 ? (
        <EmptyState title="まだ案件がありません">
          <p>案件（例：宅配（個建て）・企業配（日当））と単価を登録すると、稼働の数量から明細を作れます。Excel を取り込むと、案件の名前から候補を出します。</p>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <SearchBox action="/settings/projects" q={q} placeholder="案件・元請・別名で探す" hidden={{ status: status === "all" ? "" : status }}>
            <label className="min-w-0 basis-40">
              <span className="sr-only">元請で絞る</span>
              <Select name="client" defaultValue={clientFilter ?? ""}>
                <option value="">すべての元請</option>
                <option value="none">（元請なし）</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.active ? c.name : `${c.name}（取引をやめた元請）`}
                  </option>
                ))}
              </Select>
            </label>
          </SearchBox>
          <FilterChips
            items={[
              { href: hrefWith(sp, { status: undefined }), label: "すべて", count: all.length, current: status === "all" },
              { href: hrefWith(sp, { status: "active" }), label: "使っている", count: all.filter((p) => p.active).length, current: status === "active" },
              { href: hrefWith(sp, { status: "inactive" }), label: "使わない", count: all.filter((p) => !p.active).length, current: status === "inactive" },
            ]}
          />
          {loss > 0 && <p className="text-sm font-bold text-danger">支払単価が受注単価より高い案件が {loss}件 あります。</p>}

          {rows.length === 0 ? (
            <EmptyState title="当てはまる案件がありません">
              <p>
                <Link href="/settings/projects">条件を外す</Link>
              </p>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {rows.map((p) => {
                const m = marginOf(p.billRate, p.payRate);
                return (
                  <li key={p.id}>
                    <Card className="space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-bold">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.clientName ?? "元請なし"}・単位「{p.unit}」</span>
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">受注単価</dt>
                          <dd className="num">{rateText(p.billRate)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">支払単価</dt>
                          <dd className="num">{rateText(p.payRate)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">粗利／{p.unit}</dt>
                          <dd className={m.loss ? "num font-bold text-danger" : "num"}>{m.label}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-wrap gap-1">
                        {!p.active && <Badge>使わない</Badge>}
                        {p.clientId && inactiveClients.has(p.clientId) && <Badge>取引をやめた元請</Badge>}
                        {m.loss && <Badge tone="red">支払 ＞ 受注</Badge>}
                        {p.billRate === 0 && <Badge tone="yellow">受注単価なし</Badge>}
                        {p.overrides > 0 && (
                          <Link href={`/settings/rates?project=${p.id}`} className="-my-3 inline-flex min-h-11 items-center no-underline">
                            <Badge>人ごとの単価 {p.overrides}件</Badge>
                          </Link>
                        )}
                      </div>
                      {p.aliases.length > 0 && <p className="text-xs text-muted-foreground">別名：{p.aliases.join("、")}</p>}
                      {canEdit && (
                        <Expand summary="直す・使わない・消す">
                          <ProjectForm
                            action={updateProjectAction}
                            clients={clientPickerOptions(clients, p.clientId)}
                            submitLabel="保存"
                            overrides={p.overrides}
                            initial={{
                              id: p.id,
                              clientId: p.clientId ?? "",
                              name: p.name,
                              aliases: p.aliases.join("、"),
                              unit: p.unit,
                              billRate: String(p.billRate),
                              payRate: String(p.payRate),
                              active: p.active,
                            }}
                          />
                          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                            <ActionButton
                              action={setProjectActiveAction}
                              hidden={{ id: p.id, active: p.active ? "0" : "1" }}
                              label={p.active ? "使わないにする" : "使うように戻す"}
                            />
                            {used.has(p.id) ? (
                              <p className="w-full text-xs text-muted-foreground">稼働・明細・支払通知で使われているので消せません（記録を残すため）。</p>
                            ) : (
                              <ActionButton
                                action={deleteProjectAction}
                                hidden={{ id: p.id }}
                                label="消す"
                                danger
                                confirm={
                                  <p>
                                    「{p.name}」を消します。元に戻せません。
                                    {p.overrides > 0 && ` この案件の人ごとの単価 ${p.overrides}件も一緒に消えます。`}
                                  </p>
                                }
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
      )}
    </div>
  );
}
