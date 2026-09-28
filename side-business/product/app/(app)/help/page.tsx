import Link from "next/link";
import { PageHeader } from "~/components/page";
import { FAQS, MONTH_END_STEPS, supportContact, WATCH_DOES, WATCH_DOES_NOT } from "~/components/help/content";
import { FaqItem, HelpLinks, HelpSection, SupportCard } from "~/components/help/help-parts";
import { requirePageUser, roleAtLeast } from "~/server/auth";

export const metadata = { title: "ヘルプ" };

const TOC = [
  { id: "flow", label: "月末の流れ" },
  { id: "faq", label: "よくある質問" },
  { id: "watch", label: "見張り番のこと" },
  { id: "data", label: "データの置き場所" },
  { id: "contact", label: "困ったとき" },
];

/** ヘルプ（どの役割の人も）：月末の流れ・よくある質問・見張り番のすること／しないこと・データの置き場所・連絡先 */
export default async function HelpPage() {
  const user = await requirePageUser("viewer");
  const isOwner = roleAtLeast(user.role, "owner");
  const contact = supportContact({
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NEXT_PUBLIC_SUPPORT_LINE_URL: process.env.NEXT_PUBLIC_SUPPORT_LINE_URL,
  });

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="ヘルプ" description="月末の締めの流れと、よく聞かれることをまとめました。分からないときは、いちばん下の連絡先へどうぞ。" />

      <nav aria-label="このページの中" className="-mt-2">
        <ul className="flex flex-wrap gap-2 text-sm">
          {TOC.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-foreground no-underline hover:bg-muted">
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <HelpSection id="flow" title="月末の流れ（6 つ）">
        <p className="text-sm text-muted-foreground">毎月この順で進めます。ホームの「今月の締め」には、いまどこまで進んだかと「次にやること」が出ます。</p>
        <ol className="space-y-3">
          {MONTH_END_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3 rounded-lg border border-border bg-card p-3">
              <span aria-hidden className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <p className="font-bold">
                  <span className="sr-only">{i + 1}. </span>
                  {step.title}
                </p>
                <p className="text-sm">{step.body}</p>
                <HelpLinks links={step.links} role={user.role} />
              </div>
            </li>
          ))}
        </ol>
      </HelpSection>

      <HelpSection id="faq" title="よくある質問">
        <div className="space-y-2">
          {FAQS.map((f) => (
            <FaqItem key={f.id} id={`faq-${f.id}`} q={f.q}>
              {f.a.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <HelpLinks links={f.links} role={user.role} />
            </FaqItem>
          ))}
        </div>
      </HelpSection>

      <HelpSection id="watch" title="見張り番がすること・しないこと">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 font-bold">すること</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {WATCH_DOES.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 font-bold">しないこと</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {WATCH_DOES_NOT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-sm">
          <Link href="/watch" className="inline-flex min-h-11 items-center font-bold">
            見張り番を開く →
          </Link>
        </p>
      </HelpSection>

      <HelpSection id="data" title="データの置き場所">
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>このしめ日ラボは、この会社のために用意したものです。データはお客様のサーバー（導入のときに決めた置き場所）にあり、ほかの会社とは別に置いています。</li>
          <li>
            データはお客様のものです。オーナーは「全データの書き出し」から、いつでも全部を 1 つの ZIP（表ごとの CSV・明細の全部の版・説明書き）で持ち帰れます。やめるときも同じです。
            {isOwner ? (
              <>
                {" "}
                <Link href="/data" className="font-bold">
                  全データの書き出し →
                </Link>
              </>
            ) : (
              "（オーナーの方が使えます）"
            )}
          </li>
          <li>だれが・いつ・何をしたかは、操作の記録として残ります。消したり書き換えたりはできません。</li>
          <li>ドライバーに見せる明細では、口座番号は下 3 桁だけを出します。</li>
          <li>
            AI の読み取りは、オーナーが同意したときだけ使います（はじめは使いません）。{" "}
            <Link href="/settings/ai">AI の同意</Link>
          </li>
        </ul>
      </HelpSection>

      <HelpSection id="contact" title="困ったとき">
        <SupportCard contact={contact} />
        <p className="text-sm">
          パスワードを変えるときは <Link href="/settings/account">自分のアカウント</Link> から。
        </p>
      </HelpSection>
    </div>
  );
}
