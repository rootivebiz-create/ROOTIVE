import type { Metadata } from "next";
import Link from "next/link";
import {
  BEAUTY,
  BeautySamples,
  BeautyWithholdingExample,
  beautyBurdenCompare,
  beautyDisclosureExample,
  beautyDueExamples,
} from "@/components/for/beauty-example";
import { BeautyPayModels } from "@/components/for/beauty-pay-models";
import { ctaClass } from "@/components/landing/section";
import { Card, Money, TableWrap } from "@/components/ui";
import { bpText, en, num } from "@/lib/engine/types";
import { WITHHOLDING_CATEGORIES, WITHHOLDING_RATES, applyBp, withholdingRateFor } from "@/lib/engine/withholding";
import { jpDate } from "@/lib/format";
import { pct } from "@/lib/payroll/money";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { SITE } from "@/site.config";

const PATH = "/for/beauty";
const TITLE = "業務委託の美容師・ネイリスト・セラピストの歩合計算と支払明細（無料の計算ツール）";

/** いつ時点の情報か（制度が変わったら、ここと本文を直す） */
const AS_OF = "2026年9月";

const PAYOUT_TOOL = "/tools/payout?preset=beauty";

const monthOf = (d: string) => `${Number(d.split("-")[1])}月`;

/* ───────────── 率は表（lib/engine/withholding・lib/payroll/tax）から引く。本文に直書きしない ───────────── */

const RATE = withholdingRateFor(BEAUTY.serviceDate);
const BASIC = bpText(RATE.basicBp);
const UPPER = bpText(RATE.upperBp);
const STEP = `${num(RATE.stepThreshold / 10_000)}万円`;
const STEP_TAX = applyBp(RATE.stepThreshold, RATE.basicBp);
/** 2027年からの見込みの行（確定ではない） */
const EXPECTED = WITHHOLDING_RATES.find((r) => r.status === "expected" && r.from > RATE.from) ?? null;
/** 1号（講師料・デザイン料）の支払調書の基準（年の支払の合計がこれを超えたら） */
const REPORT_OVER = WITHHOLDING_CATEGORIES.ko1.paymentReportOver;
const KO1 = WITHHOLDING_CATEGORIES.ko1.short;

/** 見本の役務の日が入る経過措置の段階と、その一つ前 */
const STEP_INDEX = TRANSITIONAL_STEPS.findIndex(
  (s) => BEAUTY.serviceDate >= s.from && (s.to === null || BEAUTY.serviceDate <= s.to),
);
const STEP_NOW = STEP_INDEX >= 0 ? TRANSITIONAL_STEPS[STEP_INDEX] : null;
const STEP_PREV = STEP_INDEX > 0 ? TRANSITIONAL_STEPS[STEP_INDEX - 1] : null;

const DESCRIPTION =
  "美容室・ネイル・アイラッシュ・エステ・リラクゼーションで、業務委託のスタッフに払う歩合の計算を1ページに。" +
  "フリー・指名・店販の区分の歩合、段階歩合、最低保証、面貸しの精算、施術の報酬に源泉徴収が要らない理由、" +
  (STEP_NOW ? `${jpDate(STEP_NOW.from)}からのインボイス経過措置（控除${pct(STEP_NOW.rate)}）、` : "インボイスの経過措置、") +
  "フリーランス法の明示と60日。架空の例つきで、自分の数字でも無料で試せます。";

/** 源泉徴収の区分の目安（最終判断は税理士へ） */
const WITHHOLDING_ROWS: { item: string; answer: string; note: string }[] = [
  {
    item: "施術の報酬（カット・カラー・ネイル・まつげエクステ・エステ・リラクゼーションなど）",
    answer: "しない",
    note: "所得税法204条1項に挙げられていない",
  },
  { item: "面貸し・シェアサロンの精算", answer: "しない", note: "報酬の支払ではなく、預かった売上の精算" },
  { item: "講習・セミナーの講師料", answer: `する（${KO1}）`, note: "講演料・技芸や知識の教授料にあたる" },
  { item: "デザイン料（チラシ・ロゴなどのデザインを別に頼んだとき）", answer: `する（${KO1}）`, note: "" },
  { item: "モデル料（ヘアモデルなどに払うとき）", answer: "する（4号）", note: `税率は${KO1}と同じ` },
  {
    item: "映画・演劇・テレビ放送のヘアメイク（美粧）の報酬",
    answer: "する（5号）",
    note: `芸能の演出の報酬にあたる。税率は${KO1}と同じ（写真撮影のヘアメイクは不要）`,
  },
];

/** よくある差し引き（取引条件として明示し、合意したものだけ） */
const DEDUCTIONS = [
  "材料費（薬剤・ジェル・グルー・エクステなど。売上 × % か、使った分の実費）",
  "カード・QR 決済の手数料の按分",
  "タオル・クリーニング・備品の代金",
  "本人が希望して受けた講習・練習会の費用",
];

/** 明示書に書いておきたいこと（プリセットの項目に足す） */
const DISCLOSURE_MORE = [
  "段階歩合なら、全額スライドか超過累進か",
  "当日キャンセル・無断キャンセルのときの扱い",
  "締め日と支払日（例：毎月末日締め・翌月25日払い）",
];

const SOURCES = [
  {
    label: "国税庁 タックスアンサー No.2792（源泉徴収が必要な報酬・料金等とは）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm",
  },
  {
    label: "国税庁 質疑応答事例（スタイリスト料及びヘアメイク料）",
    url: "https://www.nta.go.jp/law/shitsugi/gensen/05/08.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2795（原稿料や講演料等を支払ったとき）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2795.htm",
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
    label: "国税庁 タックスアンサー No.2505（源泉所得税及び復興特別所得税の納付期限と納期の特例）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2505.htm",
  },
  {
    label: "国税庁 タックスアンサー No.7431（支払調書の提出の範囲）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/hotei/7431.htm",
  },
  {
    label: "国税庁（防衛特別所得税及び復興特別所得税の源泉徴収のあらまし。令和9年1月以後）",
    url: "https://www.nta.go.jp/publication/pamph/pdf/0026005-024_02.pdf",
  },
  { label: "国税庁（令和8年度税制改正によるインボイス制度の見直し）", url: TRANSITIONAL_SOURCE },
  {
    label: "公正取引委員会（2025年3月28日 フリーランス法の集中調査の結果）",
    url: "https://www.jftc.go.jp/houdou/pressrelease/2025/mar/250328_FL.html",
  },
  {
    label: "時事通信（2025年3月28日 フリーランス法の集中調査の報道）",
    url: "https://www.jiji.com/jc/article?k=2025032800964&g=eco",
  },
  { label: "公正取引委員会（フリーランス法のパンフレット）", url: "https://www.jftc.go.jp/file/flpamph.pdf" },
  {
    label: "公正取引委員会・厚生労働省（フリーランス法の考え方）",
    url: "https://www.jftc.go.jp/file/fl_jftcmhlwguidelines.pdf",
  },
  { label: "厚生労働省（美容師法の概要）", url: "https://www.mhlw.go.jp/bunya/kenkou/seikatsu-eisei04/06.html" },
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

const th = "border border-border bg-muted px-2 py-2 text-left";
const td = "border border-border px-2 py-2";

export default function BeautyPage() {
  const compare = beautyBurdenCompare();
  const disclosure = beautyDisclosureExample();
  const due = beautyDueExamples();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">業種別のまとめ：{BEAUTY.label}</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug [word-break:auto-phrase] sm:text-3xl">{TITLE}</h1>
      <ul className="mt-4 space-y-1 border-l-4 border-accent pl-3">
        <li>
          美容・ネイル・アイラッシュ・エステ・リラクゼーションの施術の報酬は、源泉徴収の対象に挙げられていません。講習の講師料・デザイン料・モデル料や、映画・テレビ・舞台のヘアメイクの報酬を別に払うときは、その分だけ
          {BASIC}（1回の支払で{STEP}を超える部分は{UPPER}）です。
        </li>
        <li>
          歩合は「どの売上に何%か・税込か税抜か・差し引くもの」を算定方法として明示します。従業員を使っているサロンは、施術（役務）の提供を受けた日から60日以内に払います。
        </li>
        <li>
          {STEP_NOW && STEP_PREV
            ? `${jpDate(STEP_NOW.from)}から、免税のスタッフへの支払で控除できる割合は${pct(STEP_PREV.rate)}から${pct(STEP_NOW.rate)}に下がります（負担が出るのは原則課税のサロン）。`
            : "免税のスタッフへの支払で控除できる割合は、経過措置で段階的に下がります（負担が出るのは原則課税のサロン）。"}
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
      <p className="mt-2 text-xs text-muted-foreground">{AS_OF}時点の制度にもとづきます。例のサロン・人はすべて架空です。</p>

      {/* ───────────── この業種の支払でよくあること ───────────── */}
      <div className="prose-ja mt-8">
        <h2>この業種の支払でよくあること</h2>
        <p>
          業務委託のスタイリスト・ネイリスト・アイリスト・エステティシャン・セラピストへの報酬は、売上に率を掛ける「歩合」が中心です。率は区分（フリー・指名・店販など）ごとに変えたり、売上に応じて上げたりします。面貸し・シェアサロンは、報酬ではなく売上の精算として別に計算します。
        </p>
      </div>
      <BeautyPayModels />
      <p className="mt-2 text-xs text-muted-foreground">
        例の売上・率・単価はすべて架空で、相場を示すものではありません。率は契約ごとに決まります。
      </p>
      <div className="prose-ja">
        <h3>よくある差し引き</h3>
        <p>
          次のようなものを報酬から差し引くことがあります。どれも、<strong>取引条件として前もって明示し、合意したものだけ</strong>
          にします。合意の無い差し引きは、フリーランス法の「減額」にあたるおそれがあります。計算の道具は、合意の印が無い差し引きに注意を出します。
        </p>
        <ul>
          {DEDUCTIONS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p>
          遅刻・当日欠勤の罰金は、減額のおそれに加えて、働き方を管理している事情と見られることがあります。振込手数料は、支払う側（サロン）の負担が安全です（取適法の運用では、合意があっても報酬から差し引くと減額とされえます）。
        </p>
      </div>

      <BeautySamples />

      {/* ───────────── 源泉徴収 ───────────── */}
      <div className="prose-ja mt-4">
        <h2>源泉徴収</h2>
        <p>
          所得税法204条1項は、支払うときに源泉徴収が必要な報酬・料金を挙げています。
          <strong>美容・ネイル・アイラッシュ・エステ・リラクゼーションの施術の報酬は、この中に挙げられていません</strong>
          。そのため、業務委託のスタッフに払う施術の報酬からは、源泉徴収をしません（国税庁 タックスアンサー No.2792 の一覧による）。国税庁の質疑応答事例「スタイリスト料及びヘアメイク料」も、ポスターなどの写真撮影で払うスタイリスト料・ヘアメイク料は写真の報酬にあたらず、源泉徴収は要らないとしています。ただし同じ事例で、映画・演劇・テレビ放送のヘアメイク（美粧）の報酬として払うときは、源泉徴収が必要とされています。
        </p>
        <p>
          一方、同じ人に払うものでも、講習の講師料・デザイン料・モデル料、映画・演劇・テレビ放送のヘアメイクの報酬は源泉徴収が必要です。区分は支払先ごとではなく、
          <strong>明細の行ごと</strong>に考えます。
        </p>
      </div>
      <TableWrap>
        <table className="my-4 w-full min-w-[20rem] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={th}>
                支払の項目
              </th>
              <th scope="col" className={`whitespace-nowrap ${th}`}>
                源泉徴収
              </th>
              <th scope="col" className={th}>
                メモ
              </th>
            </tr>
          </thead>
          <tbody>
            {WITHHOLDING_ROWS.map((r) => (
              <tr key={r.item}>
                <th scope="row" className={`${td} text-left font-bold`}>
                  {r.item}
                </th>
                <td className={`whitespace-nowrap ${td}`}>{r.answer}</td>
                <td className={`${td} text-muted-foreground`}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="prose-ja">
        <h3>源泉徴収をする行の税額</h3>
        <ul>
          <li>
            税率は{BASIC}です。<strong>同一人に対する1回の支払で{STEP}を超える部分だけ</strong>が{UPPER}で、税額は（1回の支払額 −{" "}
            {en(RATE.stepThreshold)}）× {UPPER} ＋ {en(STEP_TAX)}です。年の合計にかけるものではありません。
          </li>
          <li>1円未満は切り捨てます（四捨五入しません）。</li>
          <li>
            請求書等で消費税がはっきり分けて書いてあれば、税抜の額にかけてかまいません。インボイス（適格請求書）でない請求書でも同じです。分けて書いていなければ、原則どおり税込の額にかけます。
          </li>
          <li>支払先が法人なら、原則として源泉徴収はしません。</li>
        </ul>
      </div>

      <BeautyWithholdingExample />

      <div className="prose-ja mt-4">
        <h3>納付と支払調書</h3>
        <ul>
          <li>
            講師料・デザイン料などの源泉税は、支払った月の翌月10日までに納めます。半年ごとにまとめて納める特例（納期の特例）は、給与や税理士などの報酬が対象で、講師料・デザイン料は対象外です。
          </li>
          {REPORT_OVER !== null && (
            <li>
              講師料・デザイン料を同じ人に1年で{en(REPORT_OVER)}を超えて払ったら、翌年1月31日までに支払調書を出します。施術の報酬は204条の報酬ではないので、原則としてこの支払調書の対象になりません。
            </li>
          )}
          {EXPECTED && (
            <li>
              {jpDate(EXPECTED.from)}からは防衛特別所得税が始まり、復興特別所得税の率が下がります。合計の率は
              {EXPECTED.basicBp === RATE.basicBp ? `${BASIC}のまま変わらない見込みです` : `${bpText(EXPECTED.basicBp)}になる見込みです`}
              （確定ではありません。計算の道具では、率を始まる日つきの表で持っています）。
            </li>
          )}
        </ul>
      </div>

      {/* ───────────── インボイスの経過措置 ───────────── */}
      <div className="prose-ja mt-4">
        <h2>インボイスの経過措置</h2>
        <p>
          インボイス登録をしていない（免税の）スタッフへの支払は、本来は仕入れの消費税として差し引けません。ただ、経過措置で一定の割合だけは控除できます。割合は令和8年度の税制改正で次のようになりました。
        </p>
      </div>
      <TableWrap>
        <table className="my-4 w-full min-w-[18rem] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={th}>
                仕入れた日
              </th>
              <th scope="col" className={`whitespace-nowrap ${th}`}>
                控除できる割合
              </th>
            </tr>
          </thead>
          <tbody>
            {TRANSITIONAL_STEPS.map((s) => (
              <tr key={s.from}>
                <td className={td}>
                  {jpDate(s.from)}〜{s.to ? jpDate(s.to) : ""}
                </td>
                <td className={`num ${td}`}>{s.rate === 0 ? "0%（経過措置なし）" : pct(s.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="prose-ja">
        <ul>
          <li>
            どの割合になるかは、請求書の日付や支払日ではなく、<strong>課税仕入れの日（役務の提供を受けた日）</strong>で決まります。
            {STEP_NOW && STEP_PREV?.to
              ? `${monthOf(STEP_PREV.to)}に施術してもらった分を${monthOf(STEP_NOW.from)}に払うなら、${pct(STEP_PREV.rate)}の期間の仕入れです。`
              : ""}
          </li>
          <li>
            負担が増えるのは、消費税を原則課税で計算しているサロンです。サロンが簡易課税・2割特例・免税事業者なら、この負担は出ません。登録済みのスタッフへの支払にも出ません。
          </li>
          {compare && (
            <li>
              上の例の{compare.name}なら、サロンが控除できずに負担する消費税は
              {compare.burdens.map((b, i) => (
                <span key={b.label}>
                  {i > 0 && "、"}
                  {b.label}（控除{pct(b.rate)}）で<Money value={b.burden} />
                </span>
              ))}
              です（原則課税のサロンの場合。簡易課税・免税のサロンなら
              <Money value={compare.simplified} />）。
            </li>
          )}
          <li>
            免税であることを理由に、報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきや、独占禁止法（優越的地位の濫用）などの問題になるおそれがあります。見直すときは、スタッフと協議してください。
          </li>
        </ul>
        <p>
          <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center">
            免税のスタッフへの支払でサロンが負担する消費税を計算する（無料）
          </Link>
        </p>

        {/* ───────────── フリーランス法 ───────────── */}
        <h2>フリーランス法</h2>
        <p>
          フリーランス法（2024年11月1日施行）は、従業員を使っていない個人のスタッフに、業務委託で施術などを頼むサロンに関わります。
        </p>
        <ul>
          <li>
            <strong>取引条件の明示（3条）</strong>
            ：仕事を頼んだら直ちに、業務の内容・報酬の額・支払期日などを、書面かメールなどで示します。従業員のいない一人オーナーのサロンも対象です。歩合のように金額を前もって決められない報酬は、
            <strong>算定方法（どの売上に何%か、税込か税抜か、差し引くものとその計算、最低保証）</strong>で示します。
          </li>
          <li>
            <strong>60日以内の支払（4条）</strong>
            ：従業員を使っているサロンは、役務の提供を受けた日から60日以内に支払期日を決めて払います。月単位で締める場合は、締め期間の最初の日から数えて2か月以内が目安です。「請求書を受け取った月の翌月末」のように、請求書の受け取りから数える決め方は、60日を超えるおそれがあります。
          </li>
          <li>
            <strong>禁止されること（5条）</strong>
            ：従業員を使っているサロンが1か月以上の業務委託をするときは、報酬の減額・買いたたき・購入や利用の強制・不当な経済上の利益の提供の要請などが禁止されています。明示していない材料費・タオル代・罰金の差し引きは減額に、店販品や講習を買わせることは購入・利用の強制に、無償の練習会などへの参加の要請は不当な経済上の利益の要請に、あたるおそれがあります。
          </li>
          <li>
            従業員を使っているサロンには、このほか、募集の情報を正確に出すこと（12条）、ハラスメントの相談体制（14条）、6か月以上続く委託を途中で解除する・更新しないときの30日前までの予告（16条）などがあります。
          </li>
          <li>
            公正取引委員会は2025年3月28日、リラクゼーション業・フィットネスクラブ業を含む4業種（ほかはゲームソフトウェア業・アニメーション制作業）を集中的に調べ、45名の事業者に、取引条件の明示や支払期日についてフリーランス法にもとづく指導をしました。美容室・ネイルサロンなどが名前を挙げて調べられたわけではありませんが、個人のスタッフに業務委託で施術を頼むなら、同じ法律が当てはまります。
          </li>
          <li>
            面貸し（場所代）は、サロンがスタッフに仕事を頼むのではなく、場所を貸して売上を精算する形のこともあります。フリーランス法の業務委託にあたるかは契約の形しだいで、このページと計算の道具は判断しません。
          </li>
        </ul>
      </div>

      {due.length > 0 && (
        <TableWrap>
          <table className="my-4 w-full min-w-[20rem] border-collapse text-sm">
            <caption className="mb-2 text-left text-sm font-bold">
              {monthOf(BEAUTY.serviceDate)}の施術の分を払う日の例（締め期間の最初の日から数える）
            </caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  支払のルール
                </th>
                <th scope="col" className={`whitespace-nowrap ${th}`}>
                  支払日
                </th>
                <th scope="col" className={`whitespace-nowrap ${th}`}>
                  判定
                </th>
              </tr>
            </thead>
            <tbody>
              {due.map((d) => (
                <tr key={d.rule}>
                  <th scope="row" className={`${td} text-left font-bold`}>
                    {d.rule}
                  </th>
                  <td className={`num whitespace-nowrap ${td}`}>{jpDate(d.payDate)}</td>
                  <td className={td}>{d.ok ? `60日（2か月）以内（期限 ${jpDate(d.limit)}）` : `期限（${jpDate(d.limit)}）を超える`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <div className="prose-ja">
        {disclosure.length > 0 && (
          <>
            <p>たとえば上の例の条件なら、明示書の「報酬の額」は算定方法として次のように書けます。</p>
            <blockquote>
              {disclosure.map((d) => (
                <div key={d.name}>
                  <p className="font-bold">{d.name}</p>
                  <ul>
                    {d.items.map((item) => (
                      <li key={item.label}>
                        <span className="font-bold">{item.label}</span> {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </blockquote>
          </>
        )}
        <p>この業種で、明示書に書いておきたいこと：</p>
        <ul>
          {[...BEAUTY.disclosureExtras, ...DISCLOSURE_MORE].map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p>
          <Link href="/tools/torihiki-joken" className="inline-flex min-h-11 items-center">
            取引条件明示書をつくる（支払期日の60日チェックつき・無料）
          </Link>
        </p>
      </div>

      {/* ───────────── ご注意 ───────────── */}
      <aside aria-labelledby="cautions-title" className="mt-10 rounded-card border-2 border-warning bg-card p-4">
        <h2 id="cautions-title" className="font-bold text-warning">
          ご注意
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            このページと計算の道具は、スタッフが労働者（雇用）にあたるか、偽装請負にあたるかを判定しません。「この設定なら適法」ともいいません。
          </li>
          <li>
            契約の名前が業務委託でも、働き方の実態で判断されます。一般に、シフトや時間・場所の拘束、遅刻や欠勤の罰金、時間や日と結びついた保証、依頼や指名を断れないこと、材料や道具をすべてサロンが持つこと、などは雇用に近い事情として見られることがあります。計算の道具は、固定の日額保証・罰金・時間の拘束の設定に「リスクのある設計です」とだけ知らせます。判断は弁護士・社会保険労務士などの専門家に確かめてください。
          </li>
          <li>
            実態が雇用と判断されると、給与としての源泉徴収や社会保険、最低賃金・残業代などの扱いが必要になり、外注費として控除していた消費税も認められなくなることがあります。
          </li>
          <li>
            税務の個別の判断は保証しません。税務のご相談も受けていません。源泉の区分の最終判断は税理士に確かめてください。
          </li>
          <li>
            美容の仕事は、美容師の免許を持つ人が、届け出た美容所で行うのが原則です（美容師法。出張などの例外があります）。業務委託でも同じです。
          </li>
          <li>扱うのは、この業種でよくある代表的な支払の形だけです。契約によっては当てはまらないことがあります。</li>
          <li>国税庁・公正取引委員会・厚生労働省などの公式の道具ではありません。出典は下にまとめています。</li>
        </ul>
      </aside>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">この例を、自分の数字で試してみませんか</h2>
        <p className="mt-2 text-sm">
          美容・サロンの見本を入れた状態で、無料の計算の道具が開きます。区分ごとの売上と率、段階歩合、最低保証、差し引きを自分の数字に変えて、報酬・消費税・振込額と、免税のスタッフへの支払でサロンが負担する消費税を確かめられます。毎月の支払明細や振込データの作成を仕組みにしたいときは、ご相談ください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href={PAYOUT_TOOL} className={ctaClass("accent", "w-full sm:w-auto")}>
            美容・サロンの見本で計算する（無料）
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
          {AS_OF}
          時点の制度にもとづきます。歩合の率・段階・保証の額は、法律ではなく契約で決まるもので、例の数字は架空です。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。
        </p>
      </section>
    </div>
  );
}
