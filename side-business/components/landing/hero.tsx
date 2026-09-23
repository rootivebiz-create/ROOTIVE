import Link from "next/link";
import { SITE } from "@/site.config";
import { buildPlans, trialPlan } from "./pricing";
import { ArrowIcon, CheckIcon, compactYen, ctaClass } from "./section";

const POINTS = [
  { title: "今のExcelのルールのまま", body: "単価・控除・端数・元請ごとの締めを、そのまま再現します" },
  { title: "データもシステムも御社のもの", body: "御社のアカウントに作ります。ソースもお渡しします" },
  { title: "月額は定額", body: "ドライバーは何人でも同じ料金です" },
] as const;

export function Hero() {
  const trial = trialPlan();
  const minMonthly = Math.min(...buildPlans().map((p) => p.monthlyYen));
  return (
    <section aria-labelledby="hero-title" className="pt-2 sm:pt-10">
      <p className="text-sm font-bold text-muted-foreground">軽貨物・運送会社の、業務委託ドライバーの支払に</p>
      <h1
        id="hero-title"
        className="mt-2 max-w-3xl text-[1.75rem] font-bold leading-snug tracking-tight [word-break:auto-phrase] sm:text-[2.6rem] sm:leading-tight"
      >
        {SITE.tagline}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">
        今のExcelのルールのまま。御社のアカウントに作るので、データもシステムも御社のもの。
      </p>

      <Link
        href="/tools/invoice-cost"
        className="group mt-6 flex min-h-11 max-w-2xl items-center gap-3 rounded-card bg-plate px-4 py-3 text-plate-foreground! no-underline"
      >
        <span className="shrink-0 rounded bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">期限</span>
        <span className="flex-1 text-sm font-bold leading-snug sm:text-base">
          2026年10月から、免税ドライバーへの支払の控除は80%→70%
        </span>
        <ArrowIcon className="transition group-hover:translate-x-0.5" />
      </Link>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link href="/tools/invoice-cost" className={ctaClass("accent", "w-full px-5 text-base sm:w-auto")}>
          70%の負担を計算する（無料）
        </Link>
        <Link href="/demo" className={ctaClass("primary", "w-full px-5 text-base sm:w-auto")}>
          デモを触る
        </Link>
        <Link href="/contact" className={ctaClass("secondary", "w-full px-5 text-base sm:w-auto")}>
          無料で相談する
        </Link>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        料金は
        {trial ? `お試し${compactYen(trial.initialYen)}、` : ""}
        月額{compactYen(minMonthly)}から（税抜）。
        <a href="#ryokin" className="ml-1 inline-flex min-h-11 items-center underline-offset-2 hover:underline">
          料金を見る
        </a>
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {POINTS.map((p) => (
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
