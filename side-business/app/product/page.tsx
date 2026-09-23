import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_COMPANY, DEMO_MONTH_LABEL, reconcileExample } from "@/components/kit/content";
import { ProductDemoButton } from "@/components/landing/hero";
import { PrimaryCta } from "@/components/landing/primary-cta";
import {
  MONTH_STEPS,
  NEVER,
  PROMISES,
  REQUIREMENTS,
  SCREENS,
  type PackId,
  type Screen,
} from "@/components/landing/product-content";
import { ArrowIcon, CheckIcon, ctaClass, NewTabNote } from "@/components/landing/section";
import { Money } from "@/components/ui";
import { compactYen } from "@/lib/format";
import { buildPlans } from "@/lib/plans";
import { PLANS, PRODUCT, SHARE_IMAGE, SITE } from "@/site.config";

const PATH = "/product";
const TITLE = "製品のご紹介";
const DESCRIPTION =
  "しめ日ラボの製品（軽貨物・運送会社向けの月末の締めの仕組み）の画面と、ひと月の流れ・親切の約束・しないこと・使うために必要なもの。今のExcelのままの取り込み、ドライバーの確認の記録、締め前の見張り番、元請の支払通知との突き合わせ。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale・siteName・共有の画像もここで入れる
  openGraph: {
    type: "website",
    locale: SITE.locale,
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
    images: [SHARE_IMAGE],
  },
};

const TOC = [
  { href: "#nagare", label: "ひと月の流れ" },
  { href: "#gamen", label: "画面ごとの中身" },
  { href: "#yakusoku", label: "親切の約束" },
  { href: "#shinai", label: "しないこと" },
  { href: "#hitsuyou", label: "使うために必要なもの" },
  { href: "#pack", label: "どのパックで使えるか" },
] as const;

/** 「支払明細パックから」「利益まるごとパック」 */
function packLabel(pack: PackId): string {
  const plan = PLANS.find((p) => p.id === pack);
  if (!plan) return "";
  return pack === "payroll" ? `${plan.name}から` : plan.name;
}

function Block({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-14 scroll-mt-20 sm:mt-20">
      <span aria-hidden className="block h-1 w-10 rounded-full bg-accent" />
      <h2 id={`${id}-title`} className="mt-3 text-[1.35rem] font-bold leading-snug [word-break:auto-phrase] sm:text-2xl">
        {title}
      </h2>
      {lead && <div className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">{lead}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** 突き合わせの画面の見え方（製品のデモの架空の会社と同じ数字。components/kit/content.ts） */
function ReconcileExample() {
  const ex = reconcileExample();
  const qty = (n: number) => n.toLocaleString("ja-JP");
  return (
    <figure className="mt-4 rounded-lg border border-border bg-muted p-3">
      <figcaption className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <span className="rounded bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">架空の例</span>
        <span className="min-w-0">
          {DEMO_COMPANY}・{ex.client}の{DEMO_MONTH_LABEL}
        </span>
      </figcaption>
      {ex.short > 0 && (
        <p className="mt-2 text-sm font-bold">
          通知が自社の記録より <Money value={ex.short} /> 少ない可能性（{ex.shortCount}件）
        </p>
      )}
      <ul className="mt-2 space-y-2 text-sm">
        {ex.lines.map((l) => (
          <li key={l.project} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-bold">{l.project}</span>
              <span className="text-xs text-muted-foreground">{l.kind}</span>
            </p>
            <p className="num mt-0.5 text-xs leading-relaxed text-muted-foreground">
              自社の記録 {qty(l.ours.qty)}
              {l.unit} × <Money value={l.ours.price} /> ／ 通知 {qty(l.theirs.qty)}
              {l.unit} × <Money value={l.theirs.price} />
            </p>
            <p className="mt-0.5 flex items-baseline justify-between gap-3">
              <span className="text-xs">差（通知 − 自社の記録）</span>
              <Money value={l.diff} className="font-bold" />
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        製品のデモに入っている架空の会社の数字です。実際の差は、御社の記録と元請の通知で変わります。差が見つからない月もあります。
      </p>
    </figure>
  );
}

function ScreenCard({ screen }: { screen: Screen }) {
  return (
    <li id={screen.id} className="flex scroll-mt-20 flex-col rounded-card border border-border bg-card p-4 sm:p-5">
      <p className="text-xs font-bold text-muted-foreground">{packLabel(screen.pack)}</p>
      <h3 className="mt-1 text-lg font-bold leading-snug [word-break:auto-phrase]">{screen.name}</h3>
      <p className="mt-1 text-[15px] font-bold leading-relaxed">{screen.summary}</p>
      <p className="mt-3 text-xs font-bold text-muted-foreground">見られること・できること</p>
      <ul className="mt-1 space-y-1.5 text-sm leading-relaxed">
        {screen.shows.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckIcon small className="mt-1" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
      {screen.id === "reconcile" && <ReconcileExample />}
      <p className="mt-3 text-xs font-bold text-muted-foreground">なぜ</p>
      <p className="mt-1 text-sm leading-relaxed">{screen.why}</p>
    </li>
  );
}

export default function ProductPage() {
  const packs = buildPlans();
  const payrollPack = packs.find((p) => p.id === "payroll");
  const hasDemo = Boolean(PRODUCT.demoUrl);
  const screenName = (id: string) => SCREENS.find((s) => s.id === id)?.name ?? id;

  return (
    <div>
      <p className="text-sm font-bold text-muted-foreground">業務委託ドライバーに支払う、軽貨物・運送会社向け</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug [word-break:auto-phrase] sm:text-3xl">{TITLE}</h1>
      <div className="mt-4 max-w-3xl space-y-3 leading-relaxed">
        <p>
          {SITE.name}
          の製品は、月末の締めをまとめて引き受ける Web の仕組みです。今の Excel をそのまま取り込み、支払明細・ドライバーの確認・振込データ・締めまでを、上から順に進めます。元請の支払通知は自社の記録と突き合わせ、少ない可能性がある差を金額で出します。
        </p>
        <p>
          製品は御社ごとに、御社の Vercel（サーバー）と Postgres（データベース）に置きます。データは御社のものです。置くのも最初の設定も、当方が行います。
        </p>
      </div>

      <div className="no-print mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <ProductDemoButton className="w-full px-5 text-base sm:w-auto" />
        <PrimaryCta label="無料で相談する（30分）" />
        <Link href="/demo" className="inline-flex min-h-11 items-center justify-center gap-1 text-sm font-bold">
          計算のデモ（ブラウザだけ）
          <ArrowIcon />
        </Link>
      </div>
      {hasDemo && (
        <p className="mt-2 text-sm text-muted-foreground">
          製品のデモは別のサイトで開きます。登録なしで、来た方ごとに架空の会社を作り、24時間で消えます。
        </p>
      )}

      <nav aria-label="このページの目次" className="no-print mt-8 rounded-card border border-border bg-card p-4">
        <p className="text-sm font-bold">目次</p>
        <ul className="mt-2 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOC.map((t) => (
            <li key={t.href}>
              <a href={t.href} className="inline-flex min-h-11 items-center">
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Block
        id="nagare"
        title="ひと月の流れ"
        lead={
          <p>
            画面は締めの順に並んでいます。ホームの「次にやること」を上から進めれば、その月の締めが終わります。最初の 1〜2
            か月は、今の Excel と並べて 1 円まで比べます（並行運用）。
          </p>
        }
      >
        <ol className="space-y-3">
          {MONTH_STEPS.map((step, i) => (
            <li key={step.screenId} className="flex gap-3 rounded-card border border-border bg-card p-4">
              <span
                aria-hidden
                className="num inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-plate text-sm font-bold text-plate-foreground print:border print:border-black print:bg-white print:text-black"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-bold leading-snug">
                  <span className="sr-only">{i + 1}. </span>
                  <a href={`#${step.screenId}`}>{step.label}</a>
                </h3>
                <p className="mt-1 text-sm leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Block>

      <Block
        id="gamen"
        title="画面ごとの中身"
        lead={<p>それぞれの画面で何が見えて、なぜあるのか。画面の名前は製品のメニューと同じです。</p>}
      >
        <ul className="grid gap-4 md:grid-cols-2">
          {SCREENS.map((s) => (
            <ScreenCard key={s.id} screen={s} />
          ))}
        </ul>
      </Block>

      <Block
        id="yakusoku"
        title="親切の約束"
        lead={<p>使う人ごとに、製品が守ることです。</p>}
      >
        <ul className="grid gap-4 lg:grid-cols-3">
          {PROMISES.map((p) => (
            <li key={p.who} className="rounded-card border border-border bg-card p-4 sm:p-5">
              <h3 className="text-lg font-bold">{p.who}</h3>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                {p.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckIcon small className="mt-1" />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Block>

      <Block id="shinai" title="しないこと">
        <ul className="grid gap-4 md:grid-cols-3">
          {NEVER.map((n) => (
            <li key={n.title} className="rounded-card border border-border border-l-4 border-l-accent bg-card p-4 sm:p-5">
              <h3 className="font-bold leading-snug">{n.title}</h3>
              <p className="mt-2 text-sm leading-relaxed">{n.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          点呼・業務記録などの運行の記録は、製品の標準には入っていません。ご相談のうえ、オプションで御社向けに作ります。
        </p>
      </Block>

      <Block
        id="hitsuyou"
        title="使うために必要なもの"
        lead={<p>用意していただくのはアカウントだけです。置くのも設定も当方が行います。</p>}
      >
        <dl className="rounded-card border border-border bg-card px-4 sm:px-5">
          {REQUIREMENTS.map((r) => (
            <div key={r.title} className="border-b border-border py-3 last:border-b-0 sm:flex sm:gap-4">
              <dt className="font-bold sm:w-56 sm:shrink-0">{r.title}</dt>
              <dd className="mt-1 text-sm leading-relaxed sm:mt-0">{r.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          使う方の役割は、オーナー（すべて・利用者の管理・締めの解除）・事務（取り込み・明細・振込・締め）・閲覧（見るだけ）の 3 つです。ドライバーはログインしません。
        </p>
      </Block>

      <Block id="pack" title="どのパックで使えるか" lead={<p>金額はすべて税抜です。月額はドライバーが何人でも同じです。</p>}>
        <ul className="grid gap-4 md:grid-cols-2">
          {packs.map((plan) => {
            const own = SCREENS.filter((s) => s.pack === plan.id);
            return (
              <li key={plan.id} className="rounded-card border border-border bg-card p-4 sm:p-5">
                <h3 className="text-lg font-bold">{plan.name}</h3>
                <p className="num mt-1 text-sm text-muted-foreground">
                  初期費用{compactYen(plan.initialYen)}＋月額{compactYen(plan.monthlyYen)}
                </p>
                <p className="mt-3 text-sm leading-relaxed">
                  {plan.id === "profit" && payrollPack ? `${payrollPack.name}の画面に加えて：` : "使える画面："}
                  {own.map((s) => screenName(s.id)).join("・")}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-4">
          <Link href="/#ryokin" className="inline-flex min-h-11 items-center gap-1 font-bold">
            料金とお試しの中身を見る
            <ArrowIcon />
          </Link>
        </p>
      </Block>

      <section
        aria-labelledby="product-cta-title"
        className="no-print mt-16 rounded-card border border-border bg-plate p-6 text-white sm:mt-20 sm:p-10"
      >
        <h2 id="product-cta-title" className="text-[1.35rem] font-bold leading-snug text-plate-foreground [word-break:auto-phrase] sm:text-2xl">
          御社の先月分で、確かめてみませんか
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-white/85">
          お試しでは、御社の先月分の Excel で明細を計算し、今の振込額と 1 円単位で比べます。元請の支払通知があれば、突き合わせた差も金額でお伝えします。
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <PrimaryCta label="無料で相談する（30分）" />
          {PRODUCT.demoUrl && (
            <a
              href={PRODUCT.demoUrl}
              target="_blank"
              rel="noopener nofollow"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/40 px-5 text-base font-bold text-white no-underline transition hover:bg-white/10 sm:w-auto"
            >
              製品のデモを触る
              <NewTabNote />
            </a>
          )}
          <Link href="/demo" className={ctaClass("secondary", "w-full px-5 text-base sm:w-auto")}>
            計算のデモ（ブラウザだけ）
          </Link>
        </div>
      </section>
    </div>
  );
}
