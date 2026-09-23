import Link from "next/link";
import { makerCopy } from "@/components/kit/maker";
import { compactYen } from "@/lib/format";
import { buildPlans, trialPlan } from "@/lib/plans";
import { PRODUCT } from "@/site.config";
import { PrimaryCta } from "./primary-cta";
import { HERO } from "./product-content";
import { ArrowIcon, CheckIcon, ctaClass, NewTabNote } from "./section";

/** 4 つの約束。作り手の書き方は SITE.makerIsOperator で変わる */
function points() {
  const maker = makerCopy();
  return [
    { title: "今の Excel のまま", body: "形を変えずに置くだけ。ファイルの形と名前の表記ゆれを覚えます" },
    { title: "1 円まで確かめてから", body: "今の Excel の振込額と 1 人ずつ比べ、合うか差の理由が分かってから本番へ" },
    { title: "データは御社のもの", body: "御社の Vercel と Postgres に置きます。全データをいつでも書き出せます" },
    { title: maker.pointTitle, body: maker.pointBody },
  ];
}

/** 製品のデモ（別のサイト）へのボタン。URL が無ければ何も出さない */
export function ProductDemoButton({
  url = PRODUCT.demoUrl,
  className,
  label = "製品のデモを触る",
}: {
  url?: string | null;
  className?: string;
  label?: string;
}) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener" className={ctaClass("primary", className)}>
      {label}
      <NewTabNote />
    </a>
  );
}

export function Hero() {
  const trial = trialPlan();
  const packs = buildPlans();
  const minMonthly = Math.min(...packs.map((p) => p.monthlyYen));
  const minInitial = Math.min(...packs.map((p) => p.initialYen));
  const hasDemo = Boolean(PRODUCT.demoUrl);
  return (
    <section aria-labelledby="hero-title" className="pt-2 sm:pt-10">
      <p className="text-sm font-bold text-muted-foreground">{HERO.eyebrow}</p>
      <h1
        id="hero-title"
        className="mt-2 max-w-3xl text-[1.6rem] font-bold leading-snug tracking-tight [word-break:auto-phrase] sm:text-[2.4rem] sm:leading-tight"
      >
        {HERO.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">{HERO.body}</p>

      <Link
        href="/tools/invoice-cost"
        className="group mt-6 flex min-h-11 max-w-2xl items-center gap-3 rounded-card bg-plate px-4 py-3 text-plate-foreground no-underline print:border print:border-black print:bg-white print:text-black"
      >
        <span className="shrink-0 rounded bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">期限</span>
        <span className="flex-1 text-sm font-bold leading-snug sm:text-base">
          2026年10月から、免税ドライバーへの支払の控除は80%→70%
        </span>
        <ArrowIcon className="transition group-hover:translate-x-0.5" />
      </Link>

      <div className="no-print mt-6 max-w-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <ProductDemoButton className="w-full px-5 text-base sm:w-auto sm:min-w-60" />
          <PrimaryCta label="無料で相談する（30分）" className={hasDemo ? "sm:min-w-60" : "sm:min-w-72"} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasDemo
            ? "製品のデモは登録なしで触れます（架空の会社で、24時間で消えます）。相談はオンラインで30分・無料。売り込みはしません。"
            : "オンラインで30分・無料。今の締め方を聞かせてください。売り込みはしません。"}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          <Link href="/product" className={ctaClass("secondary", "sm:px-5 sm:text-base")}>
            製品のご紹介
          </Link>
          <Link href="/demo" className={ctaClass("secondary", "sm:px-5 sm:text-base")}>
            計算のデモ
          </Link>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed">
        <span className="font-bold">料金（税抜）</span>：
        {trial ? `お試し${compactYen(trial.initialYen)}（本契約で差し引き）／` : ""}
        初期費用{compactYen(minInitial)}〜＋月額{compactYen(minMonthly)}〜。月額はドライバーが何人でも同じです（サーバー代は別に御社から直接）。
        <a href="#ryokin" className="ml-1 inline-flex min-h-11 items-center underline-offset-2 hover:underline">
          料金を見る
        </a>
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {points().map((p) => (
          <li key={p.title} className="flex gap-3 rounded-card border border-border bg-card p-4">
            <CheckIcon className="mt-0.5" />
            <span>
              <span className="block font-bold leading-snug">{p.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{p.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
