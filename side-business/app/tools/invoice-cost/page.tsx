import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceCostCalculator } from "@/components/tools/invoice-cost";
import { buttonClass, Card } from "@/components/ui";
import { pct } from "@/lib/payroll/money";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS, nonDeductibleTax } from "@/lib/payroll/tax";
import { RULES_AS_OF_LABEL, creditableTaxOf, groupDigits, jpDate } from "@/lib/tools/invoice-cost";
import { SITE } from "@/site.config";

const PATH = "/tools/invoice-cost";
const TITLE = "免税ドライバーへの支払で会社が負担する消費税の計算（2026年10月から70%）";
const DESCRIPTION =
  "インボイス未登録（免税）の業務委託ドライバーへの支払で、控除できずに会社が負担する消費税を計算します。2026年10月から控除できる割合は80%から70%へ。月の支払額を入れると、2031年10月までの負担が期間ごとに分かります。";

const SOURCES = [
  { label: "国税庁（インボイス制度の見直し）", url: TRANSITIONAL_SOURCE },
  {
    label: "国税庁（インボイス Q&A 問113：免税事業者等からの仕入れの経過措置）",
    url: "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/113.pdf",
  },
  {
    label: "公正取引委員会（インボイス制度に関する Q&A）",
    url: "https://www.jftc.go.jp/dk/guideline/unyoukijun/invoice_qanda.html",
  },
];

/** 例：税込 11 万円を払ったとき（2026年9月まで／10月から） */
const EXAMPLE_PAID = 110_000;
const EXAMPLE_BEFORE = nonDeductibleTax(EXAMPLE_PAID, "2026-09-30");
const EXAMPLE_AFTER = nonDeductibleTax(EXAMPLE_PAID, "2026-10-01");
const EXAMPLE_CREDITABLE = creditableTaxOf(EXAMPLE_PAID);
const n = groupDigits;

const FAQ = [
  {
    q: "2026年10月から何が変わりますか？",
    a: "インボイス登録をしていない免税のドライバーなどへの支払について、仕入税額相当額のうち控除できる割合が80%から70%に下がります。2028年10月から50%、2030年10月から30%になり、2031年10月からは控除できなくなります（令和8年度税制改正）。",
  },
  {
    q: "会社が負担する消費税はどう計算しますか？",
    a: `税込の支払額 × 10/110 × （1 − 控除できる割合）です。税込${n(EXAMPLE_PAID)}円なら、2026年9月までは${n(EXAMPLE_BEFORE)}円、2026年10月からは${n(EXAMPLE_AFTER)}円です。`,
  },
  {
    q: "簡易課税や2割特例でも負担は増えますか？",
    a: "増えません。簡易課税や2割特例は売上の消費税をもとに納める額を計算するので、相手がインボイス登録をしていなくても、納める消費税は変わりません。影響があるのは原則課税の会社です。",
  },
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

export default function InvoiceCostPage() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <div className="mx-auto max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }}
      />
      <p className="text-sm font-bold text-muted-foreground">無料の計算ツール</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug sm:text-3xl">
        免税ドライバーへの支払で、会社が負担する消費税はいくら？
        <span className="mt-1 block text-lg sm:text-xl">（2026年10月から70%）</span>
      </h1>
      <p className="mt-3">
        インボイス登録をしていない（免税の）ドライバーへの月の支払を入れると、控除できずに会社がかぶる消費税が、2031年10月まで期間ごとに分かります。
      </p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-2 py-1 font-bold text-foreground">{RULES_AS_OF_LABEL}時点の制度にもとづく計算です</span>
        <span className="py-1">入れた金額はこの画面の中だけで計算し、送信しません。</span>
      </p>

      <div className="mt-6">
        <InvoiceCostCalculator />
      </div>

      <div className="prose-ja mt-12">
        <h2>「経過措置」とは</h2>
        <p>
          インボイス制度では、仕入れの消費税を差し引く（仕入税額控除）には、原則として相手が出すインボイス（適格請求書）が必要です。インボイス登録をしていない免税のドライバーへの支払は、本来は差し引けません。
        </p>
        <p>
          ただ、いきなり全額を差し引けなくなると影響が大きいため、しばらくの間は、免税事業者などからの仕入れでも
          <strong>仕入税額相当額の一定割合だけは控除できる</strong>
          ことになっています。これが「経過措置」です。割合は令和8年度税制改正で次のようになりました。
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">仕入れた日</th>
              {/* 見出しは折り返さない（.prose-ja th）ので、幅 375px に収まるようスマホだけ 2 行にする */}
              <th scope="col">
                控除できる
                <span className="sm:hidden">
                  <br />
                </span>
                割合
              </th>
              <th scope="col">
                会社が
                <span className="sm:hidden">
                  <br />
                </span>
                かぶる割合
              </th>
            </tr>
          </thead>
          <tbody>
            {TRANSITIONAL_STEPS.map((s) => (
              <tr key={s.from}>
                <td>
                  {jpDate(s.from)}〜{s.to ? jpDate(s.to) : ""}
                </td>
                <td className="num">{s.rate === 0 ? "0%（経過措置なし）" : pct(s.rate)}</td>
                <td className="num">{pct(1 - s.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>経過措置を使うには、帳簿に経過措置の対象であることを書き、請求書などを保存しておく必要があります。</p>

        <h2>計算のしかた</h2>
        <p className="rounded-card border border-border bg-card p-4 font-bold">
          会社が負担する消費税 ＝ 税込の支払額 × 10/110 × （1 − 控除できる割合）
        </p>
        <p>10/110 は、税込の金額にふくまれる消費税（10%）の分です。これを「仕入税額相当額」といいます。</p>
        <h3>例：税込{n(EXAMPLE_PAID)}円を払ったとき</h3>
        <ul>
          <li>
            仕入税額相当額は {n(EXAMPLE_PAID)}円 × 10/110 ＝ {n(EXAMPLE_CREDITABLE)}円
          </li>
          <li>
            2026年9月まで（80%を控除）：{n(EXAMPLE_CREDITABLE)}円 × （1 − 80%） ＝ <strong>{n(EXAMPLE_BEFORE)}円</strong>
          </li>
          <li>
            2026年10月から（70%を控除）：{n(EXAMPLE_CREDITABLE)}円 × （1 − 70%） ＝ <strong>{n(EXAMPLE_AFTER)}円</strong>
          </li>
        </ul>
        <p>
          1人あたり月{n(EXAMPLE_AFTER - EXAMPLE_BEFORE)}円の差でも、同じ金額の人が10人いれば月{n((EXAMPLE_AFTER - EXAMPLE_BEFORE) * 10)}円、年
          {n((EXAMPLE_AFTER - EXAMPLE_BEFORE) * 10 * 12)}円になります。
        </p>

        <h2>影響があるのは「原則課税」の会社だけ</h2>
        <p>
          消費税を原則課税（一般課税）で計算している会社は、仕入れの消費税を実際の額で差し引くので、この負担が出ます。簡易課税や2割特例の会社は、売上の消費税をもとに納める額を計算するため、相手がインボイス登録をしていなくても、納める消費税は変わりません。
        </p>
        <p>どちらで計算しているか分からなければ、顧問の税理士に確かめてください。</p>

        <h2>割合は「仕入れた日」で決まる</h2>
        <p>
          どの割合になるかは、お金を払った日ではなく、課税仕入れを行った日（ドライバーに仕事をしてもらった日）で決まります。たとえば2026年9月に走ってもらった分を10月に払うなら、80%の期間の仕入れです。
        </p>
        <p>月の途中で締めている場合など、どの日になるか迷うときは税理士に確かめてください。</p>

        <h2>1つの相手から年1億円を超える分は対象外</h2>
        <p>
          2026年10月1日以後に始まる課税期間からは、1つの免税の相手からの仕入れが1年（会社なら1事業年度）で1億円を超えると、超えた部分には経過措置が使えません。個人のドライバー1人への支払がここまで大きくなることは、ほとんどありません。
        </p>
      </div>

      <aside aria-labelledby="price-caution" className="mt-8 rounded-card border-2 border-warning bg-card p-4">
        <h2 id="price-caution" className="font-bold text-warning">
          単価を見直す前に
        </h2>
        <p className="mt-2">
          単価を一方的に下げると、独占禁止法（優越的地位の濫用）・取適法・フリーランス法の問題になるおそれがあります。見直すときはドライバーと協議してください。
        </p>
      </aside>

      <section className="mt-8 rounded-card border border-border bg-card p-4 text-sm">
        <h2 className="font-bold">出典・参考</h2>
        <ul className="mt-2 space-y-1">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="block min-h-11 py-2">
                {s.label}
                <span className="block break-all text-xs text-muted-foreground">{s.url}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted-foreground">
          {RULES_AS_OF_LABEL}時点の制度にもとづく計算です。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。個別の判断は税理士に確かめてください。
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">よくある質問</h2>
        <dl className="mt-3 space-y-3">
          {FAQ.map((f) => (
            <Card key={f.q}>
              <dt className="font-bold">{f.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed">{f.a}</dd>
            </Card>
          ))}
        </dl>
      </section>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">支払明細・振込データ・利益表を、御社のやり方のまま自動にしませんか</h2>
        <p className="mt-2 text-sm">
          インボイス未登録のドライバーの分の負担も、支払の計算といっしょに月ごとに出せます。まずはデモをさわってみてください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href="/demo" className={buttonClass("primary")}>
            デモをさわる
          </Link>
          <Link href="/contact" className={buttonClass("accent")}>
            30分の相談を申し込む
          </Link>
        </div>
      </Card>
    </div>
  );
}
