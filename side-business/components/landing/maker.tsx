import Link from "next/link";
import { ArrowIcon, Section } from "./section";

export function Maker() {
  return (
    <Section id="hito" title="作っている人">
      <div className="rounded-card border border-border border-l-4 border-l-accent bg-card p-5 sm:p-6">
        <p className="max-w-3xl text-[17px] leading-relaxed">
          作っているのは、軽貨物の運送会社を経営している本人です。自分の会社でも、支払明細と利益の管理を仕組みにして毎月使っています。AIを使って作るので、早く、手ごろに作れます。
        </p>
        <Link href="/about" className="mt-2 inline-flex min-h-11 items-center gap-1 font-bold">
          運営者について
          <ArrowIcon />
        </Link>
      </div>
    </Section>
  );
}
