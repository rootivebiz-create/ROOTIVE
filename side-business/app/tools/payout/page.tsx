import type { Metadata } from "next";
import Link from "next/link";
import { PayoutTool } from "@/components/tools/payout/payout-tool";
import { parsePresetParam } from "@/components/tools/payout/state";
import { Card, buttonClass } from "@/components/ui";
import { PRESETS } from "@/lib/engine/presets";
import { bpText, en, num } from "@/lib/engine/types";
import {
  WITHHOLDING_CATEGORIES,
  WITHHOLDING_RATES,
  applyBp,
  calcWithholding,
  withholdingRateFor,
} from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { jpMonth } from "@/lib/tools/invoice-cost";
import { SITE } from "@/site.config";

const PATH = "/tools/payout";
const TITLE = "業務委託の報酬・源泉徴収・振込額の計算（業種別の見本つき）";

/** いつ時点の制度か（制度が変わったら、ここと本文を直す） */
const AS_OF = "2026年9月";

/* ───────────── 本文の数字（率・額は表から引き、ここに直書きしない） ───────────── */

/** いま施行されている源泉の率の行 */
const RATE = withholdingRateFor();
const BASIC = bpText(RATE.basicBp);
const UPPER = bpText(RATE.upperBp);
const STEP = `${num(RATE.stepThreshold / 10_000)}万円`;
/** 段階の境目までの税額（100万円 × 10.21%） */
const STEP_TAX = applyBp(RATE.stepThreshold, RATE.basicBp);
/** 次に率の表が切り替わる行（見込みのこともある） */
const NEXT_RATE = WITHHOLDING_RATES.find((r) => r.from > RATE.from) ?? null;

const EX_SMALL = 84_000;
const EX_SMALL_TAX = calcWithholding("ko1", EX_SMALL).tax;
const EX_LARGE = 1_500_000;
const EX_LARGE_TAX = calcWithholding("ko1", EX_LARGE).tax;
/** 税抜の報酬 10万円・消費税 1万円のときの源泉（分けて書いてある／いない） */
const EX_FEE = 100_000;
const EX_FEE_INCL = 110_000;
const EX_FEE_TAX = calcWithholding("ko1", EX_FEE).tax;
const EX_FEE_INCL_TAX = calcWithholding("ko1", EX_FEE_INCL).tax;

const REPORT_KO1 = WITHHOLDING_CATEGORIES.ko1.paymentReportOver ?? 0;
const REPORT_GAIKOIN = WITHHOLDING_CATEGORIES.ko4_gaikoin.paymentReportOver ?? 0;

/** 経過措置の最後の段階（控除できなくなる日） */
const LAST_STEP = TRANSITIONAL_STEPS[TRANSITIONAL_STEPS.length - 1];

const SOURCES = [
  {
    label: "国税庁 タックスアンサー No.2792（源泉徴収が必要な報酬・料金等とは）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2795（原稿料や講演料等を支払ったとき）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2795.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2798（弁護士や税理士等に報酬・料金を支払ったとき）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2798.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2801（司法書士や土地家屋調査士等に報酬・料金を支払ったとき）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2801.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2804（外交員や集金人に報酬・料金を支払ったとき）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2804.htm",
  },
  {
    label: "国税庁（インボイス制度開始後の報酬・料金等に対する源泉徴収）",
    url: "https://www.nta.go.jp/law/tsutatsu/kobetsu/shotoku/gensen/111209/01.htm",
  },
  {
    label: "国税庁（復興特別所得税の源泉徴収の資料。1円未満の端数の扱い）",
    url: "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/gensen/fukko/pdf/02.pdf",
  },
  {
    label: "国税庁 所得税基本通達（第204条関係の共通：204-4 報酬又は料金の支払者が負担する旅費）",
    url: "https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/36/02.htm",
  },
  {
    label: "国税庁 タックスアンサー No.7431（「報酬、料金、契約金及び賞金の支払調書」の提出範囲と提出枚数等）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/hotei/7431.htm",
  },
  { label: "国税庁（令和8年度税制改正によるインボイス制度の見直し）", url: TRANSITIONAL_SOURCE },
  { label: "公正取引委員会（フリーランス法のパンフレット）", url: "https://www.jftc.go.jp/file/flpamph.pdf" },
];

const FAQ = [
  {
    q: `源泉徴収の${UPPER}は、年の支払の合計が${STEP}を超えたらかかりますか？`,
    a: `かかりません。${UPPER}になるのは、同じ人への1回の支払で${STEP}を超える部分だけです。1回の支払が${en(EX_LARGE)}なら、（${en(EX_LARGE)} − ${en(RATE.stepThreshold)}）× ${UPPER} ＋ ${en(STEP_TAX)} ＝ ${en(EX_LARGE_TAX)}です。年の合計や、月をまたいだ合計にはかけません。1円未満は切り捨てます。`,
  },
  {
    q: "源泉徴収は、消費税を含めた額と含めない額のどちらにかけますか？",
    a: `原則は消費税を含めた額です。請求書などで報酬の額と消費税の額がはっきり分けて書いてあれば、報酬の額（税抜）だけにかけてかまいません。インボイス（適格請求書）でない請求書や、免税事業者の請求書でも同じです。報酬${en(EX_FEE)}・消費税${en(EX_FEE_INCL - EX_FEE)}なら、分けて書いてあれば${en(EX_FEE_TAX)}、分けて書いていなければ${en(EX_FEE_INCL_TAX)}です。`,
  },
  {
    q: "運送・システム開発・美容の施術の報酬にも、源泉徴収は要りますか？",
    a: "所得税法204条1項に挙げられた報酬ではないため、源泉徴収はしません。ただし、同じ相手に原稿料・デザイン料・講習の講師料などを払うなら、その部分は源泉徴収の対象になることがあります。区分に迷うときは税理士に確かめてください。",
  },
];

const DESCRIPTION = `業務委託の個人に払う報酬を、数量×単価・歩合・段階歩合・最低保証・精算幅・人数の加算から選んで計算。消費税・源泉徴収税額（${BASIC}、1回の支払で${STEP}を超える部分は${UPPER}）・控除・振込額と、免税の方への支払で発注する側が負担する消費税が分かります。軽貨物・出版・IT・美容・スクールの架空の見本つき。`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PayoutPage({ searchParams }: Props) {
  const initialPreset = parsePresetParam((await searchParams).preset);
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
        業務委託の報酬・源泉徴収・振込額の計算
        <span className="mt-1 block text-lg sm:text-xl">（業種別の見本つき）</span>
      </h1>
      <p className="mt-3">
        業務委託の個人に払う報酬の決め方（数量×単価・歩合・段階歩合・最低保証・精算幅・人数の加算）と、インボイス登録の有無、源泉徴収の区分を入れると、消費税・源泉徴収税額・控除・振込額が分かります。免税の方への支払で発注する側が負担する消費税も出します。
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        軽貨物・出版・IT・美容・スクールの架空の見本から始められます。扱うのは、それぞれの業種でよくある代表的な支払の形だけで、すべての業種・契約に当てはまるわけではありません。
      </p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-2 py-1 font-bold text-foreground">{AS_OF}時点の制度にもとづく計算です</span>
        <span className="py-1">入れた内容はこの画面の中だけで計算し、送信も保存もしません。</span>
      </p>

      <div className="mt-6">
        <PayoutTool initialPreset={initialPreset} />
      </div>

      <div className="prose-ja mt-12">
        <h2>源泉徴収のきまり（要点）</h2>
        <h3>源泉徴収が要る報酬、要らない報酬</h3>
        <p>
          個人に払う報酬のうち、源泉徴収が要るのは所得税法204条1項に挙げられたものだけです。支払先が法人なら、ここで扱う報酬の源泉徴収はしません。
        </p>
        <ul>
          <li>
            <strong>1号</strong>：原稿料・撮影料・挿絵料・デザイン料・翻訳料・講演料・技芸やスポーツや知識の教授料・著作権の使用料（印税）など
          </li>
          <li>
            <strong>2号</strong>：弁護士・税理士・社会保険労務士・建築士・測量士などへの報酬。司法書士・土地家屋調査士・海事代理士は計算のしかたが違います（下へ）
          </li>
          <li>
            <strong>4号</strong>：外交員・集金人などへの報酬（外交員にあたるかは契約しだいで、個別の判断が要ります）
          </li>
          <li>
            <strong>挙げられていないもの</strong>：運送・システム開発・プログラミング・美容や施術の報酬などは、源泉徴収をしません。同じ相手でも、デザイン料・原稿料・研修の講師料の部分だけは1号になることがあります
          </li>
        </ul>
        <p>Web デザインをデザインの報酬として扱うのは実務の扱いで、通達に Web と書いてあるわけではありません。区分に迷うときは税理士に確かめてください。</p>

        <h3>税率と1円未満の扱い</h3>
        <p>
          1号・2号の税率は{BASIC}です。<strong>同じ人への1回の支払で{STEP}を超える部分だけ</strong>が{UPPER}になります。年の合計にはかけません。1円未満は切り捨てます。
        </p>
        <ul>
          <li>
            1回の支払が{en(EX_SMALL)}なら、{en(EX_SMALL)} × {BASIC} ＝ {en(EX_SMALL_TAX)}
          </li>
          <li>
            1回の支払が{en(EX_LARGE)}なら、（{en(EX_LARGE)} − {en(RATE.stepThreshold)}）× {UPPER} ＋ {en(STEP_TAX)} ＝ {en(EX_LARGE_TAX)}
          </li>
        </ul>
        <p>
          司法書士・土地家屋調査士・海事代理士は、（1回の支払額 − {en(RATE.shihoshoshiDeduction)}）× {BASIC}。外交員は、月ごとに（報酬 − {en(RATE.gaikoinMonthlyDeduction)}。同じ月に給与を払うなら{en(RATE.gaikoinMonthlyDeduction)}から給与を引いた額を引く）× {BASIC}です。どちらも{UPPER}の段階はありません。
        </p>
        {NEXT_RATE && (
          <p>
            {jpMonth(NEXT_RATE.from)}からの率は、{NEXT_RATE.note}。この道具は率を日付つきの表で持っていて、支払日の率で計算します。
          </p>
        )}

        <h3>源泉の元は、税込？税抜？</h3>
        <p>
          原則は消費税を含めた額です。請求書などで報酬の額と消費税の額が<strong>はっきり分けて書いてあれば、報酬の額（税抜）だけ</strong>にかけてかまいません。インボイスでない請求書や、免税事業者の請求書でも同じです。消費税相当額を上乗せしない免税の方なら、支払う報酬の額がそのまま元になります。
        </p>
        <p>
          報酬{en(EX_FEE)}・消費税{en(EX_FEE_INCL - EX_FEE)}なら、分けて書いてあれば{en(EX_FEE_TAX)}、分けて書いていなければ{en(EX_FEE_INCL_TAX)}です。
        </p>

        <h3>交通費と控除</h3>
        <p>
          報酬と一緒に本人へ渡す交通費・宿泊費は、原則として源泉の元に入ります。発注者が交通機関やホテルへ直接払ったもの（通常必要な範囲）は入りません（所得税基本通達204-4）。
        </p>
        <p>
          教室の使用料・材料費などを報酬から差し引く（相殺する）ときは、源泉を計算したあとで差し引く形にしています。差し引いても源泉の元は減りません。扱いに迷うときは税理士に確かめてください。
        </p>

        <h3>納付と支払調書</h3>
        <p>
          源泉徴収した税は、原則として支払った月の翌月10日までに納めます。給与などの源泉を半年ごとにまとめて納める「納期の特例」を受けていても、1号の報酬（原稿料・デザイン料・講師料など）の源泉は特例の対象外なので、支払った月の翌月10日までに納めます（所得税法216条）。同じ人への年の支払の合計が、1号・2号は{en(REPORT_KO1)}、外交員は{en(REPORT_GAIKOIN)}を超えたら、「報酬、料金、契約金及び賞金の支払調書」を翌年1月31日までに出します。
        </p>

        <h2>免税の方への支払と、インボイスの経過措置</h2>
        <p>
          インボイス登録をしていない方への支払は、発注する側が原則課税なら、含まれる消費税相当額を全額は控除できません。控除できる割合は段階的に下がり、{jpMonth(LAST_STEP.from)}からは控除できません。どの割合になるかは、請求書の日付や支払日ではなく、<strong>役務の提供を受けた日（課税仕入れの日）</strong>で決まります。
        </p>
        <ul>
          {TRANSITIONAL_STEPS.map((s) => (
            <li key={s.from}>
              {jpMonth(s.from)}〜{s.to ? jpMonth(s.to) : ""}：{s.rate === 0 ? "控除できない（経過措置なし）" : `控除できるのは${pct(s.rate)}`}
            </li>
          ))}
        </ul>
        <p>
          発注する側が簡易課税・2割特例・免税事業者なら、この負担は出ません。{jpMonth(LAST_STEP.from)}までの期間ごとの負担は
          <Link href="/tools/invoice-cost">インボイスの負担の計算</Link>で確かめられます。
        </p>

        <h2>支払の決め方と、取引条件の明示</h2>
        <p>
          従業員を使わない個人など（フリーランス）に業務委託で仕事を頼んだら、報酬の額や支払期日などの取引条件を、すぐに書面やメールなどで示します（フリーランス法）。歩合や精算幅のように金額を前もって決められない報酬は、算定方法（どの売上に何%か、税込か税抜か、精算幅と端数、差し引くもの）で示せます。上の結果の「算定方法」の文は、その下書きに使えます。
        </p>
        <p>
          従業員を使っている発注者は、給付を受け取った日から60日以内に払います。取引条件として示し、合意していない差し引きは、フリーランス法の「減額」にあたるおそれがあります。
          軽貨物のドライバー向けには、<Link href="/tools/torihiki-joken">取引条件明示書のひな形</Link>もあります。
        </p>
      </div>

      <section aria-labelledby="industries-title" className="mt-10">
        <h2 id="industries-title" className="text-lg font-bold">
          業種別の説明
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <Link
                href={`/for/${p.id}`}
                className="flex min-h-11 items-center rounded-card border border-border bg-card px-4 py-3 text-sm font-bold no-underline hover:bg-muted"
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <aside aria-labelledby="cautions-title" className="mt-10 rounded-card border-2 border-warning bg-card p-4">
        <h2 id="cautions-title" className="font-bold text-warning">
          ご注意
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            この道具は、相手が労働者（雇用）にあたるか、偽装請負にあたるかを判定しません。日数に結びついた最低保証・罰金・勤怠と結びついた固定の支払などには「リスクのある設計」とだけ知らせます。判断は弁護士・社会保険労務士などの専門家に確かめてください。
          </li>
          <li>税務の個別の判断はしません。源泉徴収の区分・源泉の元の最終判断は税理士に確かめてください。</li>
          <li>扱うのは、業務委託の個人に払う報酬の代表的な支払の形だけです。契約によっては当てはまらないことがあります。</li>
          <li>免税であることを理由に、報酬や消費税相当額を一方的に下げることは勧めません。フリーランス法の減額・買いたたきなどの問題になりえます。</li>
          <li>国税庁・公正取引委員会などの公式の道具ではありません。出典は下にまとめています。</li>
        </ul>
      </aside>

      <section aria-labelledby="sources-title" className="mt-8 rounded-card border border-border bg-card p-4 text-sm">
        <h2 id="sources-title" className="font-bold">
          出典・参考
        </h2>
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
          {AS_OF}時点の制度にもとづく計算です。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。
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
        <h2 className="text-lg font-bold leading-snug">御社の支払ルールで、毎月の計算を自動に</h2>
        <p className="mt-2 text-sm">
          {SITE.name}は、おもに運送会社（軽貨物の業務委託ドライバー）向けに、月末の締め・支払明細・振込データの仕組みを作っています。ほかの業種の方も、<Link href="/contact">お問い合わせ</Link>からお気軽にご相談ください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href="/contact" className={buttonClass("accent")}>
            御社の支払ルールで毎月自動に（相談する）
          </Link>
          <Link href="/demo" className={buttonClass("secondary")}>
            軽貨物のデモをさわる
          </Link>
        </div>
      </Card>
    </div>
  );
}
