import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";
import { jpDate } from "@/lib/format";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { FilterChips, SearchBox } from "~/components/settings/list-bits";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { driverBadges, listDrivers, type DriverFilter } from "~/server/features/settings/drivers";
import { ACCOUNT_TYPE_LABEL, hasBank, maskAccount } from "~/server/features/settings/format";

export const metadata = { title: "ドライバー" };

type SP = { q?: string; status?: string; flag?: string; saved?: string };

function hrefWith(sp: SP, patch: Partial<SP>): string {
  const next = { ...sp, ...patch, saved: undefined };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return qs ? `/settings/drivers?${qs}` : "/settings/drivers";
}

export default async function DriversPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const canEdit = roleAtLeast(user.role, "staff");
  const status: DriverFilter["status"] = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const flag: DriverFilter["flag"] = sp.flag === "unregistered" || sp.flag === "no_bank" || sp.flag === "no_terms" ? sp.flag : "";
  const q = (sp.q ?? "").slice(0, 50);
  const db = await getDb();
  const { rows, counts } = await listDrivers(db, user.tenantId, { q, status, flag });

  return (
    <div>
      <PageHeader
        title="ドライバー"
        description="明細・振込データ・見張り番に使う台帳です。口座・インボイス・取引条件の明示の抜けが、ここで分かります。"
        actions={
          canEdit && (
            <>
              <Link href="/settings/drivers/new" className={buttonClass("primary")}>
                追加
              </Link>
              <Link href="/onboarding/drivers" className={buttonClass("secondary")}>
                まとめて登録（Excel・貼り付け）
              </Link>
            </>
          )
        }
      />
      {sp.saved === "deleted" && (
        <div className="mb-4">
          <Notice tone="ok">消しました。</Notice>
        </div>
      )}

      {counts.total === 0 ? (
        <EmptyState title="まだドライバーがいません">
          <p>今の Excel の名簿を貼り付けると、まとめて登録できます。1 人ずつなら「追加」から。</p>
          {canEdit && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Link href="/onboarding/drivers" className={buttonClass("primary")}>
                まとめて登録（Excel・貼り付け）
              </Link>
              <Link href="/settings/drivers/new" className={buttonClass("secondary")}>
                1 人ずつ追加
              </Link>
            </div>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <SearchBox action="/settings/drivers" q={q} placeholder="名前・フリガナ・番号・別名で探す" hidden={{ status: status === "active" ? "" : status, flag }} />
          <FilterChips
            items={[
              { href: hrefWith(sp, { status: undefined }), label: "有効", count: counts.active, current: status === "active" },
              { href: hrefWith(sp, { status: "inactive" }), label: "無効", count: counts.total - counts.active, current: status === "inactive" },
              { href: hrefWith(sp, { status: "all" }), label: "すべて", count: counts.total, current: status === "all" },
            ]}
          />
          <FilterChips
            items={[
              { href: hrefWith(sp, { flag: undefined }), label: "しるしで絞らない", current: !flag },
              { href: hrefWith(sp, { flag: "no_bank" }), label: "口座なし", count: counts.noBank, current: flag === "no_bank", tone: "red" },
              { href: hrefWith(sp, { flag: "no_terms" }), label: "取引条件の明示なし", count: counts.noTerms, current: flag === "no_terms", tone: "yellow" },
              { href: hrefWith(sp, { flag: "unregistered" }), label: "インボイス未登録", count: counts.unregistered, current: flag === "unregistered" },
            ]}
          />
          <p className="text-xs text-muted-foreground">しるしの数は、有効な人だけを数えています。</p>

          {rows.length === 0 ? (
            <EmptyState title="当てはまる人がいません">
              <p>
                言葉や絞り込みを変えてみてください。<Link href="/settings/drivers">すべての条件を外す</Link>
              </p>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {rows.map((d) => (
                <li key={d.id}>
                  <Link href={`/settings/drivers/${d.id}`} className="block text-foreground no-underline">
                    <Card className="hover:border-foreground">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {d.code && <span className="num text-sm text-muted-foreground">{d.code}</span>}
                        <span className="font-bold">{d.name}</span>
                        {d.kana && <span className="text-xs text-muted-foreground">{d.kana}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {driverBadges(d).map((b) => (
                          <Badge key={b.label} tone={b.tone}>
                            {b.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {hasBank(d)
                          ? `口座：${d.bankCode}-${d.branchCode} ${ACCOUNT_TYPE_LABEL[d.accountType === "checking" ? "checking" : "ordinary"]} ${canEdit ? d.accountNumber : maskAccount(d.accountNumber)}`
                          : "口座：未登録（振込データに入りません）"}
                        {d.termsIssuedOn && `・明示 ${jpDate(d.termsIssuedOn)}`}
                        {d.endOn && `・終了 ${jpDate(d.endOn)}`}
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">{rows.length}人を表示しています。</p>
        </div>
      )}
    </div>
  );
}
