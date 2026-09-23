import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/site.config";

const TITLE = "業種別：業務委託の支払で押さえたいこと";
const DESCRIPTION =
  "運送・出版・IT・美容・講師の業種ごとに、業務委託の個人に払う報酬の決まり方、源泉徴収の要否、インボイスの経過措置、フリーランス法の取引条件と60日の支払期日をまとめています。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/for" },
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: "/for" },
};

const INDUSTRIES = [
  { href: "/for/trucking", name: "軽貨物・運送", what: "個建て・日当・時間の計算、管理費・ロイヤリティの差し引き、全銀の振込データ" },
  { href: "/for/publishing", name: "出版・編集・Webメディア", what: "原稿料・撮影料・イラスト料・印税の源泉徴収と支払明細" },
  { href: "/for/it", name: "IT・SES・Web制作", what: "精算幅（上下割・中間割）と、外注のデザイン料の源泉徴収" },
  { href: "/for/beauty", name: "美容室・ネイル・エステ・リラクゼーション", what: "区分ごとの歩合・段階歩合・最低保証・面貸しの精算" },
  { href: "/for/school", name: "学習塾・スクール・フィットネス", what: "コマ給・月謝の歩合と、講師料の源泉徴収" },
] as const;

export default function ForIndexPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold leading-snug">{TITLE}</h1>
      <p className="mt-2 text-muted-foreground">
        業種ごとに、よくある支払の形と注意点を1ページにまとめ、計算の見本を付けています。ここに無い業種でも、業務委託の個人に払っているなら共通する部分が多いはずです。
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {INDUSTRIES.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className="block h-full rounded-card border border-border bg-card p-4 text-foreground no-underline hover:border-foreground"
            >
              <span className="block font-bold">{i.name}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{i.what}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted-foreground">
        しめ日ラボが仕組みづくりをお受けしているのは、主に運送会社です。ほかの業種でも、毎月の支払を自動にしたい方は
        <Link href="/contact">ご相談ください</Link>。
      </p>
    </div>
  );
}
