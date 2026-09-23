import Link from "next/link";
import { makerCopy } from "@/components/kit/maker";
import { compactYen } from "@/lib/format";
import { buildPlans, trialPlan } from "@/lib/plans";
import { SITE } from "@/site.config";
import { PrimaryCta } from "./primary-cta";
import { ArrowIcon, CheckIcon, ctaClass } from "./section";

/** 3 つの約束。作り手の書き方は SITE.makerIsOperator で変わる */
function points() {
  const maker = makerCopy();
  return [
    { title: "今のExcelのルールのまま", body: "単価・控除・端数・元請ごとの締めを、そのまま再現します" },
    { title: "データもシステムも御社のもの", body: "御社のアカウントに作ります。ソースもお渡しします" },
    { title: maker.pointTitle, body: maker.pointBody },
  ];
}

export function Hero() {
  const trial = trialPlan();
  const packs = buildPlans();
  const minMonthly = Math.min(...packs.map((p) => p.monthlyYen));
  const minInitial = Math.min(...packs.map((p) => p.initialYen));
  return (
    <section aria-labelledby="hero-title" className="pt-2 sm:pt-10">
      <p className="text-sm font-bold text-muted-foreground">業務委託ドライバーに毎月支払っている、軽貨物・運送会社向け</p>
      <h1
        id="hero-title"
        className="mt-2 max-w-3xl text-[1.75rem] font-bold leading-snug tracking-tight [word-break:auto-phrase] sm:text-[2.6rem] sm:leading-tight"
      >
        {SITE.tagline}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">
        ドライバーの稼働と単価から、<strong>支払明細のPDF・銀行の振込データ・案件ごとの利益</strong>
        までを出す仕組みを、今のExcelのルールのまま御社のアカウントに作ります。データもシステムも御社のものです。
      </p>

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
        <PrimaryCta className="sm:min-w-72" />
        <p className="mt-2 text-sm text-muted-foreground">オンラインで30分・無料。今の締め方を聞かせてください。売り込みはしません。</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          <Link href="/demo" className={ctaClass("secondary", "sm:px-5 sm:text-base")}>
            デモを触る
          </Link>
          <Link href="/tools/invoice-cost" className={ctaClass("secondary", "sm:px-5 sm:text-base")}>
            負担を計算（無料）
          </Link>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed">
        <span className="font-bold">料金（税抜）</span>：
        {trial ? `お試し${compactYen(trial.initialYen)}（本契約で差し引き）／` : ""}
        作る費用{compactYen(minInitial)}〜＋月額{compactYen(minMonthly)}〜。月額はドライバーが何人でも同じです（サーバー代は別）。
        <a href="#ryokin" className="ml-1 inline-flex min-h-11 items-center underline-offset-2 hover:underline">
          料金を見る
        </a>
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
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
