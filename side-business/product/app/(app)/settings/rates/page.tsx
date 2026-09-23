import Link from "next/link";
import { buttonClass, Card, Select } from "@/components/ui";
import { jpDate } from "@/lib/format";
import { Badge, EmptyState, PageHeader } from "~/components/page";
import { ActionButton } from "~/components/settings/form-kit";
import { Expand } from "~/components/settings/list-bits";
import { RateForm } from "~/components/settings/rate-form";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listDrivers } from "~/server/features/settings/drivers";
import { RATE_CHANGE_HINT, rateText, todayJst } from "~/server/features/settings/format";
import { listProjects } from "~/server/features/settings/projects";
import { listOverrides, type OverrideItem } from "~/server/features/settings/rates";
import { deleteOverrideAction, saveOverrideAction } from "./actions";

export const metadata = { title: "人ごとの単価" };

type SP = { driver?: string; project?: string };

function diffText(o: OverrideItem): string {
  const d = Math.round((o.payRate - o.standardPayRate) * 1e4) / 1e4;
  return d > 0 ? `+${rateText(d)}` : d < 0 ? `−${rateText(-d)}` : "標準と同じ";
}

export default async function RatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const canEdit = roleAtLeast(user.role, "staff");
  const db = await getDb();
  const [{ rows: drivers }, projects, all] = await Promise.all([
    listDrivers(db, user.tenantId, { status: "all" }),
    listProjects(db, user.tenantId),
    listOverrides(db, user.tenantId),
  ]);
  const driverFilter = sp.driver && drivers.some((d) => d.id === sp.driver) ? sp.driver : undefined;
  const projectFilter = sp.project && projects.some((p) => p.id === sp.project) ? sp.project : undefined;
  const rows = all.filter((o) => (!driverFilter || o.driverId === driverFilter) && (!projectFilter || o.projectId === projectFilter));
  const groups = new Map<string, OverrideItem[]>();
  for (const o of rows) groups.set(o.driverId, [...(groups.get(o.driverId) ?? []), o]);
  const today = todayJst();
  const driverOptions = drivers.map((d) => ({ id: d.id, name: d.name, code: d.code, active: d.active }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, unit: p.unit, payRate: p.payRate, billRate: p.billRate, active: p.active }));
  const existing = all.map((o) => ({ driverId: o.driverId, projectId: o.projectId, payRate: o.payRate, agreedOn: o.agreedOn }));
  const noAgreed = all.filter((o) => !o.agreedOn).length;

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="人ごとの単価"
        description="案件の標準の支払単価と違う人だけ登録します。明細は「この人の単価 → 無ければ案件の標準」の順で使います。"
      />

      {projects.length === 0 || drivers.length === 0 ? (
        <EmptyState title="先にドライバーと案件を登録してください">
          <p>人ごとの単価は、ドライバー × 案件 で決めます。</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link href="/settings/drivers" className={buttonClass("secondary")}>
              ドライバー
            </Link>
            <Link href="/settings/projects" className={buttonClass("secondary")}>
              案件と単価
            </Link>
          </div>
        </EmptyState>
      ) : (
        <>
          {canEdit && (
            <Card>
              <Expand summary="人ごとの単価を登録" open={all.length === 0 || !!driverFilter}>
                <p className="text-xs text-muted-foreground">{RATE_CHANGE_HINT}</p>
                <RateForm
                  key={driverFilter ?? "all"}
                  action={saveOverrideAction}
                  drivers={driverOptions}
                  projects={projectOptions}
                  existing={existing}
                  today={today}
                  initial={driverFilter || projectFilter ? { driverId: driverFilter ?? "", projectId: projectFilter ?? "", payRate: "", agreedOn: "" } : undefined}
                />
              </Expand>
            </Card>
          )}

          <form action="/settings/rates" method="get" className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label>
              <span className="sr-only">ドライバーで絞る</span>
              <Select name="driver" defaultValue={driverFilter ?? ""}>
                <option value="">すべてのドライバー</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code ? `${d.code} ` : ""}
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span className="sr-only">案件で絞る</span>
              <Select name="project" defaultValue={projectFilter ?? ""}>
                <option value="">すべての案件</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <button type="submit" className={buttonClass("secondary")}>
              絞る
            </button>
          </form>
          {noAgreed > 0 && <p className="text-sm text-warning">合意した日の記録が無い単価が {noAgreed}件 あります。</p>}

          {rows.length === 0 ? (
            <EmptyState title={all.length === 0 ? "まだありません" : "当てはまる単価がありません"}>
              <p>{all.length === 0 ? "全員が案件の標準の単価なら、登録しなくて大丈夫です。" : <Link href="/settings/rates">条件を外す</Link>}</p>
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {[...groups.entries()].map(([driverId, items]) => (
                <li key={driverId}>
                  <Card className="space-y-2">
                    <p className="font-bold">
                      <Link href={`/settings/drivers/${driverId}`} className="text-foreground">
                        {items[0].driverCode ? `${items[0].driverCode} ` : ""}
                        {items[0].driverName}
                      </Link>
                      {!items[0].driverActive && (
                        <span className="ml-2">
                          <Badge>無効</Badge>
                        </span>
                      )}
                    </p>
                    <ul className="divide-y divide-border">
                      {items.map((o) => (
                        <li key={o.id} className="space-y-1 py-2">
                          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="font-bold">{o.projectName}</span>
                            {o.clientName && <span className="text-xs text-muted-foreground">{o.clientName}</span>}
                            {!o.projectActive && <Badge>使わない案件</Badge>}
                          </div>
                          <p className="text-sm">
                            標準 {rateText(o.standardPayRate)} → <span className="font-bold">この人 {rateText(o.payRate)}</span>／{o.unit}
                            <span className="ml-2 num text-muted-foreground">（{diffText(o)}）</span>
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {o.agreedOn ? <Badge tone="green">合意 {jpDate(o.agreedOn)}</Badge> : <Badge tone="yellow">合意した日なし</Badge>}
                            {o.payRate > o.billRate && <Badge tone="red">受注単価より高い</Badge>}
                          </div>
                          {canEdit && (
                            <Expand summary="直す・消す">
                              <RateForm
                                action={saveOverrideAction}
                                drivers={driverOptions}
                                projects={projectOptions}
                                existing={existing}
                                today={today}
                                initial={{ driverId: o.driverId, projectId: o.projectId, payRate: String(o.payRate), agreedOn: o.agreedOn ?? "", fixed: true }}
                              />
                              <div className="border-t border-border pt-3">
                                <ActionButton
                                  action={deleteOverrideAction}
                                  hidden={{ id: o.id }}
                                  label="消す（標準の単価に戻す）"
                                  danger
                                  confirm={
                                    <p>
                                      {o.driverName}さんの「{o.projectName}」の単価を消します。これからは標準の {rateText(o.standardPayRate)} で計算します（まだ締めていない月の明細は、作り直すと変わります）。
                                    </p>
                                  }
                                  confirmLabel="消す"
                                />
                              </div>
                            </Expand>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
