import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { jpDate } from "@/lib/format";
import { Badge, Notice, PageHeader } from "~/components/page";
import { DriverForm } from "~/components/settings/driver-form";
import { toDriverInitial } from "~/components/settings/driver-initial";
import { DriverSummary } from "~/components/settings/driver-summary";
import { ActionButton } from "~/components/settings/form-kit";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { driverBadges, driverReferences, getDriver } from "~/server/features/settings/drivers";
import { rateText, ruleValueText, todayJst } from "~/server/features/settings/format";
import { listOverrides } from "~/server/features/settings/rates";
import { listRules } from "~/server/features/settings/rules";
import { SOURCES } from "~/server/features/watch/sources";
import { deleteDriverAction, setDriverActiveAction, updateDriverAction } from "../actions";

export const metadata = { title: "ドライバー" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DriverPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requirePageUser("viewer");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = await getDb();
  const d = await getDriver(db, user.tenantId, id);
  if (!d) notFound();
  const canEdit = roleAtLeast(user.role, "staff");
  const [refs, overrides, rules] = await Promise.all([driverReferences(db, user.tenantId, id), listOverrides(db, user.tenantId, { driverId: id }), listRules(db, user.tenantId)]);
  const own = rules.filter((r) => r.driverId === id);
  const everyone = rules.filter((r) => r.driverId === null && r.active);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="mb-2">
          <Link href="/settings/drivers" className="inline-flex min-h-11 items-center text-sm">
            ← ドライバーの一覧へ
          </Link>
        </p>
        <PageHeader title={`${d.code ? `${d.code} ` : ""}${d.name}`} />
        <div className="-mt-4 mb-4 flex flex-wrap gap-1">
          {driverBadges(d).map((b) => (
            <Badge key={b.label} tone={b.tone}>
              {b.label}
            </Badge>
          ))}
        </div>
        {sp.saved === "created" && <Notice tone="ok">登録しました。口座・登録番号・取引条件の日付は、あとから入れられます。</Notice>}
        {sp.saved === "updated" && <Notice tone="ok">保存しました。まだ締めていない月の明細は、作り直すと反映されます。</Notice>}
      </div>

      {canEdit ? (
        <DriverForm
          // 保存するたびに作り直す（保存した形の値を入力欄に出すため）
          key={d.updatedAt.getTime()}
          action={updateDriverAction}
          initial={toDriverInitial(d)}
          submitLabel="保存"
          today={todayJst()}
          sources={{ invoiceRegistry: SOURCES.invoiceRegistry, flLaw: SOURCES.flLaw, mhlwFl: SOURCES.mhlwFl }}
        />
      ) : (
        <DriverSummary d={d} />
      )}

      <section aria-labelledby="own-rates" className="space-y-2">
        <h2 id="own-rates" className="text-lg font-bold">
          この人だけの単価
        </h2>
        {overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">ありません（どの案件も、案件の標準の支払単価で計算します）。</p>
        ) : (
          <ul className="space-y-2">
            {overrides.map((o) => (
              <li key={o.id}>
                <Card className="text-sm">
                  <p className="font-bold">
                    {o.projectName}
                    {o.clientName && <span className="ml-1 font-normal text-muted-foreground">（{o.clientName}）</span>}
                  </p>
                  <p className="mt-1">
                    標準 {rateText(o.standardPayRate)} → <span className="font-bold">この人 {rateText(o.payRate)}</span>／{o.unit}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{o.agreedOn ? `合意した日：${jpDate(o.agreedOn)}` : "合意した日の記録がありません"}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/settings/rates?driver=${d.id}`} className="inline-flex min-h-11 items-center text-sm">
          {canEdit ? "この人の単価を足す・直す" : "人ごとの単価を見る"} →
        </Link>
      </section>

      <section aria-labelledby="own-rules" className="space-y-2">
        <h2 id="own-rules" className="text-lg font-bold">
          控除
        </h2>
        <p className="text-sm text-muted-foreground">
          全員に当てる控除：{everyone.length ? everyone.map((r) => `${r.name}（${ruleValueText(r)}）`).join("・") : "ありません"}
        </p>
        {own.length === 0 ? (
          <p className="text-sm text-muted-foreground">この人だけの控除はありません。</p>
        ) : (
          <ul className="space-y-2">
            {own.map((r) => (
              <li key={r.id}>
                <Card className="text-sm">
                  <p className="font-bold">
                    {r.name} <span className="font-normal">{ruleValueText(r)}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!r.active && <Badge>使わない</Badge>}
                    {r.agreedInWriting ? <Badge tone="green">合意の記録あり</Badge> : <Badge tone="red">合意の記録なし</Badge>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/settings/rules?driver=${d.id}`} className="inline-flex min-h-11 items-center text-sm">
          {canEdit ? "この人の控除を足す・直す" : "控除を見る"} →
        </Link>
      </section>

      {canEdit && (
        <section aria-labelledby="danger" className="space-y-3">
          <h2 id="danger" className="text-lg font-bold">
            {d.active ? "委託をやめたとき" : "無効にした人"}
          </h2>
          <Card className="space-y-3">
            {d.active ? (
              <>
                <p className="text-sm">無効にすると、一覧や選ぶところで後ろに回ります。過去の稼働・明細・記録はそのまま残り、稼働が入った月は明細も作られます。</p>
                <ActionButton
                  action={setDriverActiveAction}
                  hidden={{ id: d.id, active: "0" }}
                  label="無効にする"
                  confirm={<p>{d.name}さんを無効にします。あとで「有効に戻す」ができます。</p>}
                  confirmLabel="無効にする"
                />
              </>
            ) : (
              <>
                <p className="text-sm">無効にしています。また委託するときは、有効に戻してください。</p>
                <ActionButton action={setDriverActiveAction} hidden={{ id: d.id, active: "1" }} label="有効に戻す" variant="primary" />
              </>
            )}
            <div className="border-t border-border pt-3">
              {refs.canDelete ? (
                <>
                  <p className="text-sm">この人には稼働・明細などの記録がありません。間違えて登録したときは消せます。</p>
                  <ActionButton
                    action={deleteDriverAction}
                    hidden={{ id: d.id }}
                    label="消す"
                    danger
                    confirm={
                      <p>
                        {d.name}さんを消します。元に戻せません。
                        {refs.attached.overrides + refs.attached.rules > 0 &&
                          ` この人だけの単価 ${refs.attached.overrides}件・控除 ${refs.attached.rules}件も一緒に消えます。`}
                      </p>
                    }
                    confirmLabel="消す"
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">記録（{refs.history.join("・")}）があるので、消せません。記録を残すため、やめたときは「無効にする」を使ってください。</p>
              )}
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
