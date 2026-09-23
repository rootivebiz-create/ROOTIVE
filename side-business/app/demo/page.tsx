import type { Metadata } from "next";
import { DemoApp } from "@/components/demo/demo-app";
import { PrimaryCta } from "@/components/landing/primary-cta";
import { SITE } from "@/site.config";

const TITLE = "デモ：支払明細・利益・振込データ";
const DESCRIPTION =
  "業務委託ドライバーの稼働を入れると、支払明細・案件ごとの利益・銀行の振込データ（全銀協の形式）ができるまでを、架空のデータで試せるデモです。インボイス未登録の方への支払で会社が負担する消費税も出します。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/demo" },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: "/demo" },
};

const TRY_STEPS = [
  "「稼働」で、どれか 1 つの数量を変える",
  "「支払明細」と「振込データ」の金額が、すぐ変わるのを見る",
  "「利益」で、案件ごと・元請ごとの儲けを見る",
] as const;

export default function DemoPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold leading-snug">支払明細・利益・振込データのデモ</h1>
      <div className="mt-4 rounded-card border border-border bg-card p-4 sm:flex sm:items-start sm:gap-6">
        <div className="text-sm leading-relaxed sm:flex-1">
          <p>
            {"架空のデータで動くデモです（登録なし）。入力はこの端末の中だけに保存され、どこにも送られません。"}
          </p>
          <p className="mt-2 font-bold">まずはここから</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {TRY_STEPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <p className="mt-2 text-muted-foreground">
            {"御社のやり方（単価の種類・控除・端数・元請）に合わせて作り直せます。"}
          </p>
        </div>
        <PrimaryCta className="mt-3 sm:mt-0" />
      </div>

      <DemoApp />

      <section className="mt-12 rounded-card bg-plate p-6 text-plate-foreground">
        <h2 className="text-lg font-bold">このデモを、御社の形で</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          {"単価の決め方・差し引くもの・端数の扱い・元請ごとの集計は、会社ごとに違います。"}
          {"今の Excel や明細の形を見せていただければ、そのやり方のまま動くように作ります。"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          {"オンラインで30分・無料。御社の形で作れるかをお伝えします。売り込みはしません。"}
        </p>
        <PrimaryCta className="mt-4" />
      </section>
    </div>
  );
}
