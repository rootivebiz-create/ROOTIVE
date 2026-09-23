import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, Card } from "@/components/ui";
import { Badge, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { settingsOverview } from "~/server/features/settings/overview";

export const metadata = { title: "設定" };

type Tone = "red" | "yellow" | "green" | "gray";
type Item = { href: string; title: string; body: ReactNode; notes: { tone: Tone; text: string }[] };

/** 設定のはじめ：項目ごとの今の状態と、月末の前に直しておきたいところ */
export default async function SettingsHome() {
  const user = await requirePageUser("viewer");
  const db = await getDb();
  const o = await settingsOverview(db, user.tenantId);
  const isOwner = roleAtLeast(user.role, "owner");
  const canEdit = roleAtLeast(user.role, "staff");

  const items: Item[] = [
    {
      href: "/settings/company",
      title: "会社",
      body: (
        <>
          {o.company.name}・{o.company.payRule}
        </>
      ),
      notes: [
        ...o.company.missing.map((m) => ({ tone: "yellow" as const, text: `${m}が未設定` })),
        ...(o.company.feeByDriver ? [{ tone: "red" as const, text: "振込手数料がドライバーの負担" }] : []),
      ],
    },
    {
      href: "/settings/drivers",
      title: "ドライバー",
      body: (
        <>
          有効 {o.drivers.active}人{o.drivers.total > o.drivers.active && `（無効 ${o.drivers.total - o.drivers.active}人）`}
        </>
      ),
      notes: [
        ...(o.drivers.noBank ? [{ tone: "red" as const, text: `口座なし ${o.drivers.noBank}人` }] : []),
        ...(o.drivers.noTerms ? [{ tone: "yellow" as const, text: `取引条件の明示なし ${o.drivers.noTerms}人` }] : []),
        ...(o.drivers.noRegNo ? [{ tone: "yellow" as const, text: `登録番号なし ${o.drivers.noRegNo}人` }] : []),
        ...(o.drivers.unregistered ? [{ tone: "gray" as const, text: `インボイス未登録 ${o.drivers.unregistered}人` }] : []),
      ],
    },
    { href: "/settings/clients", title: "元請", body: <>{o.clients.total}社</>, notes: [] },
    {
      href: "/settings/projects",
      title: "案件と単価",
      body: <>使っている案件 {o.projects.active}件</>,
      notes: [
        ...(o.projects.loss ? [{ tone: "red" as const, text: `支払 ＞ 受注 ${o.projects.loss}件` }] : []),
        ...(o.projects.noBill ? [{ tone: "yellow" as const, text: `受注単価なし ${o.projects.noBill}件` }] : []),
      ],
    },
    {
      href: "/settings/rates",
      title: "人ごとの単価",
      body: <>{o.rates.total}件（標準と違う人だけ）</>,
      notes: o.rates.noAgreedOn ? [{ tone: "yellow", text: `合意した日なし ${o.rates.noAgreedOn}件` }] : [],
    },
    {
      href: "/settings/rules",
      title: "控除",
      body: <>使っている控除 {o.rules.active}件</>,
      notes: o.rules.notAgreed ? [{ tone: "red", text: `合意の記録なし ${o.rules.notAgreed}件` }] : [],
    },
    ...(isOwner ? [{ href: "/settings/users", title: "利用者", body: <>{o.users.active}人</>, notes: [] }] : []),
    {
      href: "/settings/ai",
      title: "AI の同意",
      body: <>{o.company.aiConsent ? "AI を使ってよい（同意あり）" : "AI を使わない（既定）"}</>,
      notes: [],
    },
  ];

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="設定" description="明細・振込データ・見張り番のもとになる台帳です。赤と黄色のところを月末の前に直しておくと、締めがつかえません。" />

      {canEdit && o.drivers.total === 0 && (
        <Card className="space-y-2 border-accent">
          <p className="font-bold">まずはドライバーを登録しましょう</p>
          <p className="text-sm text-muted-foreground">今の Excel の名簿（名前・口座・登録番号）を貼り付けると、まとめて登録できます。</p>
          <Link href="/onboarding/drivers" className={buttonClass("primary")}>
            まとめて登録（Excel・貼り付け）
          </Link>
        </Card>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="block h-full text-foreground no-underline">
              <Card className="h-full space-y-2 hover:border-foreground">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{i.title}</p>
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{i.body}</p>
                {i.notes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {i.notes.map((n) => (
                      <Badge key={n.text} tone={n.tone}>
                        {n.text}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      {canEdit && o.drivers.total > 0 && (
        <p className="text-sm">
          ドライバーを何人もまとめて足すときは <Link href="/onboarding/drivers">まとめて登録（Excel・貼り付け）</Link> が早いです。
        </p>
      )}
    </div>
  );
}
