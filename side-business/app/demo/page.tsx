import type { Metadata } from "next";
import Link from "next/link";
import { DemoApp } from "@/components/demo/demo-app";
import { PrimaryCta } from "@/components/landing/primary-cta";
import { ArrowIcon, NewTabNote } from "@/components/landing/section";
import { PRODUCT, SHARE_IMAGE, SITE } from "@/site.config";

const TITLE = "計算のデモ（ブラウザだけ）：支払明細・利益・振込データ";
const DESCRIPTION =
  "業務委託ドライバーの稼働を入れると、支払明細・案件ごとの利益・銀行の振込データ（全銀協の形式）ができるまでを、架空のデータとブラウザの中だけで試せる計算のデモです。インボイス未登録の方への支払で会社が負担する消費税も出します。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/demo" },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: {
      images: [SHARE_IMAGE], type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: "/demo" },
};

const TRY_STEPS = [
  "「稼働」で、どれか 1 つの数量を変える",
  "「支払明細」と「振込データ」の金額が、すぐ変わるのを見る",
  "「利益」で、案件ごと・元請ごとの儲けを見る",
] as const;

/**
 * このページは「計算のデモ（ブラウザだけ）」。製品そのもの（取り込み・見張り番・ドライバーの確認・元請との突き合わせ）は、
 * 別に公開している製品のデモ（NEXT_PUBLIC_PRODUCT_DEMO_URL）で触れる。未設定なら製品のご紹介（/product）へ案内する。
 */
export default function DemoPage() {
  const productDemo = PRODUCT.demoUrl;
  return (
    <div>
      <h1 className="text-2xl font-bold leading-snug">計算のデモ（ブラウザだけ）</h1>
      <div className="mt-4 rounded-card border border-border bg-card p-4 sm:flex sm:items-start sm:gap-6">
        <div className="text-sm leading-relaxed sm:flex-1">
          <p>
            {"支払明細・利益・振込データの計算を、架空のデータで試せる簡単なデモです（登録なし）。計算はこのブラウザの中だけで行い、入力はこの端末の中だけに保存されて、どこにも送られません。"}
          </p>
          <p className="mt-2 font-bold">まずはここから</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {TRY_STEPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
        <PrimaryCta className="mt-3 sm:mt-0" />
      </div>

      <aside aria-labelledby="product-demo-title" className="mt-4 rounded-card border-2 border-foreground bg-card p-4">
        <h2 id="product-demo-title" className="font-bold leading-snug">
          製品の画面を一通り触りたいときは
        </h2>
        <p className="mt-1 text-sm leading-relaxed">
          Excel の取り込み・見張り番・ドライバーの「確認しました」・元請の支払通知との突き合わせなど、製品の画面は
          {productDemo ? "製品のデモで触れます（別のサイト。登録なしで、架空の会社は24時間で消えます）。" : "製品のご紹介でまとめています。"}
        </p>
        <p className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
          {productDemo && (
            <a href={productDemo} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 font-bold">
              製品のデモを触る
              <NewTabNote />
              <ArrowIcon />
            </a>
          )}
          <Link href="/product" className="inline-flex min-h-11 items-center gap-1 font-bold">
            製品のご紹介を見る
            <ArrowIcon />
          </Link>
        </p>
      </aside>

      <DemoApp />

      <section className="mt-12 rounded-card bg-plate p-6 text-plate-foreground">
        <h2 className="text-lg font-bold">この計算を、御社の先月分で</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          {"単価の決め方・差し引くもの・端数の扱い・元請ごとの集計は、会社ごとに違います。"}
          {"製品は今の Excel をそのまま取り込み、控除は今の取引条件のとおりに登録して計算します。お試しでは、御社の先月分で今の振込額と 1 円単位で比べます。"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          {"オンラインで30分・無料。御社の形で使えるかをお伝えします。売り込みはしません。"}
        </p>
        <PrimaryCta className="mt-4" />
      </section>
    </div>
  );
}
