import type { Metadata } from "next";
import Link from "next/link";
import {
  IT,
  ItMismatchExample,
  ItSettlementExamples,
  ItWithholdingExamples,
  itBurdenCompare,
  itDisclosureExample,
} from "@/components/for/it-example";
import { ItPayModels } from "@/components/for/it-pay-models";
import { ctaClass } from "@/components/landing/section";
import { Card, Money, TableWrap } from "@/components/ui";
import { bpText, en, num } from "@/lib/engine/types";
import { WITHHOLDING_CATEGORIES, WITHHOLDING_RATES, applyBp, withholdingRateFor } from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { SITE } from "@/site.config";

const PATH = "/for/it";
const TITLE = "SES の精算幅（上下割・中間割）と外注デザイン料の源泉徴収（無料の計算ツール）";

/** いつ時点の情報か（制度が変わったら、ここと本文を直す） */
const AS_OF = "2026年9月";

const PAYOUT_TOOL = "/tools/payout?preset=it";

const jpDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日`;
};

const monthOf = (d: string) => `${Number(d.split("-")[1])}月`;

const ymOf = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return `${y}年${m}月`;
};

/* ───────────── 率は表（lib/engine/withholding・lib/payroll/tax）から引く。本文に直書きしない ───────────── */

const RATE = withholdingRateFor(IT.serviceDate);
const BASIC = bpText(RATE.basicBp);
const UPPER = bpText(RATE.upperBp);
const STEP = `${num(RATE.stepThreshold / 10_000)}万円`;
const STEP_TAX = applyBp(RATE.stepThreshold, RATE.basicBp);
/** 2027年からの見込みの行（確定ではない） */
const EXPECTED = WITHHOLDING_RATES.find((r) => r.status === "expected" && r.from > RATE.from) ?? null;
const REPORT_OVER = WITHHOLDING_CATEGORIES.ko1.paymentReportOver;

/** 見本の役務の日が入る経過措置の段階と、その一つ前 */
const STEP_INDEX = TRANSITIONAL_STEPS.findIndex(
  (s) => IT.serviceDate >= s.from && (s.to === null || IT.serviceDate <= s.to),
);
const CURRENT_STEP = STEP_INDEX >= 0 ? TRANSITIONAL_STEPS[STEP_INDEX] : null;
const PREVIOUS_STEP = STEP_INDEX > 0 ? TRANSITIONAL_STEPS[STEP_INDEX - 1] : null;

const DESCRIPTION =
  `IT・SES・受託開発・Web制作で個人に払う報酬の計算を1ページに。精算幅（上下割・中間割）の超過と控除、` +
  `システム開発の報酬に源泉徴収が要らない理由とデザイン料の${BASIC}（1回の支払で${STEP}を超える部分は${UPPER}）、` +
  (CURRENT_STEP && PREVIOUS_STEP
    ? `${jpDate(CURRENT_STEP.from)}からのインボイス経過措置（控除${pct(CURRENT_STEP.rate)}）、`
    : "インボイスの経過措置、") +
  `フリーランス法の明示と60日。架空の例つきで、自分の数字でも無料で試せます。`;

const SOURCES = [
  {
    label: "国税庁 タックスアンサー No.2792（源泉徴収が必要な報酬・料金等とは）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2795（原稿料・デザイン料などの源泉徴収の税額）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2795.htm",
  },
  {
    label: "国税庁（インボイス制度開始後の報酬・料金等に対する源泉徴収）",
    url: "https://www.nta.go.jp/law/tsutatsu/kobetsu/shotoku/gensen/111209/01.htm",
  },
  {
    label: "国税庁 所得税基本通達（第204条関係。デザインの報酬の範囲など）",
    url: "https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/36/02.htm",
  },
  {
    label: "国税庁 タックスアンサー No.7431（支払調書の提出の範囲）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/hotei/7431.htm",
  },
  { label: "国税庁（令和8年度税制改正によるインボイス制度の見直し）", url: TRANSITIONAL_SOURCE },
  {
    label: "公正取引委員会・厚生労働省（フリーランス法の考え方）",
    url: "https://www.jftc.go.jp/file/fl_jftcmhlwguidelines.pdf",
  },
  { label: "公正取引委員会（フリーランス法のパンフレット）", url: "https://www.jftc.go.jp/file/flpamph.pdf" },
  {
    label: "公正取引委員会・中小企業庁（フリーランス法 説明資料）",
    url: "https://www.chusho.meti.go.jp/keiei/torihiki/download/freelance/law_02.pdf",
  },
  {
    label: "公正取引委員会（2025年3月28日 フリーランス法の集中調査の結果）",
    url: "https://www.jftc.go.jp/houdou/pressrelease/2025/mar/250328_FL.html",
  },
  {
    label: "厚生労働省（労働者派遣と請負の区分に関する基準の疑義応答集）",
    url: "https://www.mhlw.go.jp/bunya/koyou/gigi_outou01.html",
  },
  {
    label: "株式会社オロ（ZAC ブログ：SES の精算幅の解説。民間の解説）",
    url: "https://www.oro.com/zac/blog/ses-settlement-rangepost/",
  },
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

export default function ItPage() {
  const compare = itBurdenCompare();
  const disclosure = itDisclosureExample();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">業種別のまとめ：{IT.label}</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug [word-break:auto-phrase] sm:text-3xl">{TITLE}</h1>
      <ul className="mt-4 space-y-1 border-l-4 border-accent pl-3">
        <li>精算幅（上下割・中間割）は法律ではなく契約の慣行です。方式・時間の丸め・単価の端数は契約ごとに決まります。</li>
        <li>
          システム開発の報酬は源泉徴収の対象に挙げられていません。デザイン料・原稿料・研修の講師料などの行は{BASIC}（1回の支払で{STEP}
          を超える部分は{UPPER}）です。
        </li>
        <li>
          {CURRENT_STEP && PREVIOUS_STEP
            ? `${jpDate(CURRENT_STEP.from)}から、免税の方への支払で控除できる割合は${pct(PREVIOUS_STEP.rate)}から${pct(CURRENT_STEP.rate)}になります。`
            : "免税の方への支払で控除できる割合は、経過措置で段階的に下がります。"}
          フリーランス法では、頼んだらすぐに条件を示し（報酬は精算幅の式のような算定方法でも可）、従業員がいる会社は受け取った日から60日以内に払います。
        </li>
      </ul>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link href={PAYOUT_TOOL} className={ctaClass("accent", "w-full sm:w-auto")}>
          自分の数字で計算する（無料）
        </Link>
        <Link href="/contact" className={ctaClass("secondary", "w-full sm:w-auto")}>
          相談する
        </Link>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{AS_OF}時点の制度にもとづきます。例の会社・人はすべて架空です。</p>

      <div className="prose-ja mt-8">
        <h2>この業種の支払でよくあること</h2>
        <p>
          IT・SES・受託開発・Web制作で個人のエンジニアやデザイナーに払う報酬は、準委任の「月額と精算幅」、時間単価、成果物の金額のどれか（または組み合わせ）で決まることが多いです。
        </p>
      </div>
      <ItPayModels />
      <p className="mt-2 text-xs text-muted-foreground">
        例の数字はすべて架空です。源泉の例は、請求書で消費税を分けて書いてあり、税抜の額にかける前提です。
      </p>
      <div className="prose-ja">
        <h3>契約ごとに決めること</h3>
        <p>
          精算幅（例：140〜180時間）や上下割・中間割は、法律で決まっているものではなく、契約の慣行です。次のことは契約ごとに違うので、計算の道具ではそれぞれ選んで設定します。
        </p>
        <ul>
          <li>精算幅（下限〜上限の時間）と、上下割・中間割・固定・時間単価のどれにするか</li>
          <li>実働の丸め（15分・30分・1時間単位など）</li>
          <li>超過・控除の単価の端数（1円・10円・100円未満の切り捨てなど）</li>
          <li>月の途中で入る・抜けるときの日割り（営業日で割り、精算幅も同じ割合で縮めるなど）</li>
          <li>元請への請求の条件と、技術者への支払の条件（別々に決まっていることがよくあります）</li>
        </ul>
      </div>

      <ItSettlementExamples />
      <ItMismatchExample />

      <div className="prose-ja mt-4">
        <h2>源泉徴収</h2>
        <p>
          所得税法204条1項は、支払うときに源泉徴収が必要な報酬・料金を挙げています。
          <strong>システム開発・プログラミングの報酬はこの中に挙げられていません</strong>
          。そのため、個人のエンジニアに開発を頼んで払う報酬からは、源泉徴収をしません（国税庁 タックスアンサー No.2792 の一覧による）。SE・インフラ・PM の業務も同じ考え方です。
        </p>
        <p>
          一方、同じ相手に払うものでも、デザイン料・原稿料・翻訳料・研修の講師料などは1号の報酬で、源泉徴収が必要です。区分は支払先ごとではなく、
          <strong>明細の行ごと</strong>に考えます。
        </p>
      </div>
      <TableWrap>
        <table className="my-4 w-full min-w-[18rem] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="border border-border bg-muted px-2 py-2 text-left">
                支払の項目
              </th>
              <th scope="col" className="border border-border bg-muted px-2 py-2 text-left">
                源泉徴収
              </th>
            </tr>
          </thead>
          <tbody>
            {IT.withholdingHints.map((h) => (
              <tr key={h.item}>
                <th scope="row" className="w-2/5 border border-border px-2 py-2 text-left font-bold">
                  {h.item}
                </th>
                <td className="border border-border px-2 py-2">
                  {h.category === "none" ? "しない" : `する（${WITHHOLDING_CATEGORIES[h.category].short}）`}
                  {h.note && <span className="mt-1 block text-xs text-muted-foreground">{h.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="prose-ja">
        <h3>税額の出し方</h3>
        <ul>
          <li>
            1号の報酬は{BASIC}です。<strong>同一人に対する1回の支払で{STEP}を超える部分だけ</strong>が{UPPER}
            で、税額は（1回の支払額 − {en(RATE.stepThreshold)}）× {UPPER} ＋ {en(STEP_TAX)}
            です。年の合計にかけるものではありません。
          </li>
          <li>1円未満は切り捨てます（四捨五入しません）。</li>
          <li>1回の支払の中で、区分が同じ行（バナーと LP デザインなど）を合計してから計算します。</li>
          <li>
            請求書等で消費税がはっきり分けて書いてあれば、税抜の額にかけてかまいません。インボイス（適格請求書）でない請求書でも同じです。分けて書いていなければ、原則どおり税込の額にかけます。
          </li>
          <li>報酬と一緒に本人へ払う交通費は、原則として源泉の元に入ります（会社が交通機関やホテルへ直接払ったものは入りません）。</li>
          <li>支払先が法人なら、原則として源泉徴収はしません。</li>
        </ul>
        <h3>Web デザインの扱い</h3>
        <p>
          デザインの報酬の範囲は所得税基本通達で例が挙げられていますが、<strong>Web のデザインは明記されていません</strong>
          。税理士の解説では、Web サイトのデザインもグラフィックデザインとして源泉徴収の対象にする扱いが多く見られます（実務の扱い）。コーディング・プログラミングの部分は対象外です。
        </p>
        <p>
          デザインとコーディングを契約や請求書で分けて書いていないと、全額をデザイン料として源泉徴収する（安全側の）扱いもあります。分けられるものは、行を分けて書いておくと区分がはっきりします。迷う項目は、最終的な判断を税理士に確かめてください。
        </p>
        <h3>納付と支払調書</h3>
        <ul>
          <li>
            源泉税は、支払った月の翌月10日までに納めます。半年ごとにまとめて納める特例（納期の特例）の対象は給与や税理士などの報酬で、デザイン料・原稿料・講師料は対象外です。
          </li>
          {REPORT_OVER !== null && (
            <li>同じ人への1年の支払が{en(REPORT_OVER)}を超えたら、翌年1月31日までに支払調書を出します。</li>
          )}
          {EXPECTED && (
            <li>
              {ymOf(EXPECTED.from)}からは、防衛特別所得税の導入にあわせて復興特別所得税の率を下げる見直しが予定されています。合計の率は
              {EXPECTED.basicBp === RATE.basicBp ? `${BASIC}のまま変わらない見込みです` : `${bpText(EXPECTED.basicBp)}になる見込みです`}
              （確定ではありません。計算の道具では、率を始まる日つきの表で持っています）。
            </li>
          )}
        </ul>
      </div>

      <ItWithholdingExamples />

      <div className="prose-ja mt-4">
        <h2>インボイスの経過措置</h2>
        <p>
          インボイス登録をしていない（免税の）エンジニア・デザイナーへの支払は、本来は仕入れの消費税として差し引けません。ただ、経過措置で一定の割合だけは控除できます。割合は令和8年度の税制改正で次のようになりました。
        </p>
      </div>
      <TableWrap>
        <table className="my-4 w-full min-w-[18rem] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="border border-border bg-muted px-2 py-2 text-left">
                仕入れた日
              </th>
              <th scope="col" className="whitespace-nowrap border border-border bg-muted px-2 py-2 text-left">
                控除できる割合
              </th>
            </tr>
          </thead>
          <tbody>
            {TRANSITIONAL_STEPS.map((s) => (
              <tr key={s.from}>
                <td className="border border-border px-2 py-2">
                  {jpDate(s.from)}〜{s.to ? jpDate(s.to) : ""}
                </td>
                <td className="num border border-border px-2 py-2">{s.rate === 0 ? "0%（経過措置なし）" : pct(s.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="prose-ja">
        <ul>
          <li>
            どの割合になるかは、請求書の日付や支払日ではなく、<strong>課税仕入れの日（役務の提供を受けた日）</strong>で決まります。
            {CURRENT_STEP && PREVIOUS_STEP?.to
              ? `${monthOf(PREVIOUS_STEP.to)}に稼働してもらった分を${monthOf(CURRENT_STEP.from)}に払うなら、${pct(PREVIOUS_STEP.rate)}の期間の仕入れです。`
              : ""}
          </li>
          <li>負担が増えるのは、消費税を原則課税で計算している会社です。発注する側が簡易課税や免税事業者なら、この負担は出ません。</li>
          {compare && (
            <li>
              上の例の{compare.name}なら、会社が控除できずに負担する消費税は
              {compare.burdens.map((b, i) => (
                <span key={b.label}>
                  {i > 0 && "、"}
                  {b.label}（控除{pct(b.rate)}）で<Money value={b.burden} />
                </span>
              ))}
              です（原則課税の会社の場合）。
            </li>
          )}
          <li>
            免税であることを理由に、報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になるおそれがあります。見直すときは、相手と協議してください。
          </li>
        </ul>
        <p>
          <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center">
            免税の方への支払で会社が負担する消費税を計算する（無料）
          </Link>
        </p>

        <h2>フリーランス法</h2>
        <p>フリーランス法（2024年11月1日施行）は、従業員を使っていない個人のエンジニア・デザイナーに仕事を頼む会社に関わります。</p>
        <ul>
          <li>
            <strong>取引条件の明示（3条）</strong>
            ：仕事を頼んだら直ちに、業務の内容・報酬の額・支払期日などを、書面かメールなどで示します。報酬の額は、具体的な金額を決められない事情があれば、
            <strong>算定方法（月額と精算幅の式など）で示してもかまいません</strong>。
          </li>
          <li>
            <strong>60日以内の支払（4条）</strong>
            ：従業員を使っている会社は、給付を受け取った日（月単位で締めるなら締切日）から60日以内に支払期日を決めて払います。月末締め・翌月末払いなら60日以内です。「請求書を受け取った月の翌月末」のように、請求書の受け取りから数える決め方は、60日を超えるおそれがあります。
          </li>
          <li>
            <strong>再委託のとき</strong>
            ：①再委託であること、②元委託者の名称、③元委託の支払期日を示していれば、元委託の支払期日から30日以内に払えばよい例外があります。
          </li>
          <li>
            <strong>禁止されること（5条）</strong>
            ：1か月以上の業務委託では、受領拒否・報酬の減額・買いたたき・不当なやり直しなどが禁止されています。合意の無い差し引きや、免税であることを理由に消費税相当額を一方的に差し引くことは、減額・買いたたきにあたるおそれがあります。振込手数料は、支払う側の負担を基本にしてください。
          </li>
          <li>
            <strong>6か月以上続く契約</strong>
            ：途中で解除する・更新しないときは、原則として30日前までに予告します（16条）。長い常駐の案件はあてはまることが多いです。
          </li>
          <li>
            公正取引委員会は2025年3月28日、ゲームソフトウェア業・アニメーション制作業を含む4業種を集中的に調べ、45名の事業者にフリーランス法にもとづく指導をしました。
          </li>
        </ul>
        {disclosure && (
          <>
            <p>たとえば上の{disclosure.name}の条件なら、明示書の「報酬の額」は算定方法として次のように書けます。</p>
            <blockquote>{disclosure.text}</blockquote>
          </>
        )}
        <p>この業種で、明示書に書いておきたいこと：</p>
        <ul>
          {IT.disclosureExtras.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p>
          <Link href="/tools/torihiki-joken" className="inline-flex min-h-11 items-center">
            取引条件明示書をつくる（支払期日の60日チェックつき・無料）
          </Link>
        </p>
      </div>

      <aside aria-labelledby="cautions-title" className="mt-10 rounded-card border-2 border-warning bg-card p-4">
        <h2 id="cautions-title" className="font-bold text-warning">
          ご注意
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            このページと計算の道具は、技術者が労働者（雇用）にあたるか、偽装請負にあたるかを判定しません。
          </li>
          <li>
            準委任（SES）でも、発注する側や常駐先が技術者に作業の進め方や働く時間を直接指示していると、契約の名前ではなく実態で判断され、偽装請負（労働者派遣法の違反）とされることがあります。時間での精算に加えて勤怠の管理や細かい指示がある形は、労働者性が問題になることもあります。判断は弁護士・社会保険労務士などの専門家に確かめてください。
          </li>
          <li>
            税務の個別の判断は保証しません。税務のご相談も受けていません。源泉の区分（デザインかプログラミングかなど）の最終判断は税理士に確かめてください。
          </li>
          <li>扱うのは、この業種でよくある代表的な支払の形だけです。契約によっては当てはまらないことがあります。</li>
          <li>国税庁・公正取引委員会・厚生労働省などの公式の道具ではありません。出典は下にまとめています。</li>
        </ul>
      </aside>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">この例を、自分の数字で試してみませんか</h2>
        <p className="mt-2 text-sm">
          IT の見本を入れた状態で、無料の計算の道具が開きます。月額・精算幅・実働・単価などを自分の数字に変えて、支払額・消費税・源泉・振込額を確かめられます。毎月の支払明細や振込データの作成を仕組みにしたいときは、ご相談ください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href={PAYOUT_TOOL} className={ctaClass("accent", "w-full sm:w-auto")}>
            IT の見本で計算する（無料）
          </Link>
          <Link href="/contact" className={ctaClass("primary", "w-full sm:w-auto")}>
            相談する
          </Link>
        </div>
      </Card>

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
          {AS_OF}時点の制度にもとづきます。精算幅の方式は法律ではなく契約の慣行で、民間の解説を参考にしています。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。
        </p>
      </section>
    </div>
  );
}
