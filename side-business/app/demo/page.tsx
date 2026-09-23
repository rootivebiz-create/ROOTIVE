import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { DemoApp } from "@/components/demo/demo-app";

export const metadata: Metadata = {
  title: "デモ：支払明細・利益・振込データ",
  description:
    "業務委託ドライバーの稼働を入れると、支払明細・案件ごとの利益・銀行の振込データ（全銀協の形式）ができるまでを、架空のデータで試せるデモです。インボイス未登録の方への支払で会社が負担する消費税も出します。",
  alternates: { canonical: "/demo" },
};

export default function DemoPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold leading-snug">支払明細・利益・振込データのデモ</h1>
      <div className="mt-4 rounded-card border border-border bg-card p-4 sm:flex sm:items-center sm:gap-6">
        <p className="text-sm leading-relaxed sm:flex-1">
          {"架空のデータで動くデモです。入力はこの端末の中だけに保存され、どこにも送られません。"}
          {"御社のやり方（単価の種類・控除・端数・元請）に合わせて作り直せます。"}
        </p>
        <Link href="/contact" className={buttonClass("accent", "mt-3 w-full sm:mt-0 sm:w-auto")}>
          御社用に作る相談をする
        </Link>
      </div>

      <DemoApp />

      <section className="mt-12 rounded-card bg-plate p-6 text-plate-foreground">
        <h2 className="text-lg font-bold">このデモを、御社の形で</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          {"単価の決め方・差し引くもの・端数の扱い・元請ごとの集計は、会社ごとに違います。"}
          {"今の Excel や明細の形を見せていただければ、そのやり方のまま動くように作ります。"}
        </p>
        <Link href="/contact" className={buttonClass("accent", "mt-4 w-full sm:w-auto")}>
          30分の相談を申し込む
        </Link>
      </section>
    </div>
  );
}
