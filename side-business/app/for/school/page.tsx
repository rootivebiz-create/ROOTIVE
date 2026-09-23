import type { Metadata } from "next";
import Link from "next/link";
import {
  SCHOOL,
  SchoolExample,
  jpDate,
  manYen,
  schoolBurdenCompare,
  schoolLateExample,
  schoolOffsetExample,
  schoolTaxBaseCompare,
} from "@/components/for/school-example";
import { SchoolPayModels } from "@/components/for/school-pay-models";
import { ctaClass } from "@/components/landing/section";
import { Card, Money, TableWrap } from "@/components/ui";
import { calcModel } from "@/lib/engine/payModels";
import { bpText, en } from "@/lib/engine/types";
import {
  WITHHOLDING_CATEGORIES,
  WITHHOLDING_RATES,
  applyBp,
  calcWithholding,
  withholdingRateFor,
} from "@/lib/engine/withholding";
import { pct } from "@/lib/payroll/money";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { SITE } from "@/site.config";

const PATH = "/for/school";
const TITLE =
  "業務委託講師・インストラクターの報酬と源泉徴収（コマ給・月謝歩合の無料計算ツール）";

/** いつ時点の情報か（制度が変わったら、ここと本文を直す） */
const AS_OF = "2026年9月";

const PAYOUT_TOOL = "/tools/payout?preset=school";

const monthOf = (d: string) => `${Number(d.split("-")[1])}月`;

const ymOf = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return `${y}年${m}月`;
};

/* ───────────── 率は表（lib/engine/withholding・lib/payroll/tax）から引く。本文に直書きしない ───────────── */

const RATE = withholdingRateFor(SCHOOL.serviceDate);
const BASIC = bpText(RATE.basicBp);
const UPPER = bpText(RATE.upperBp);
const STEP = manYen(RATE.stepThreshold);
/** 段階の境目までの税額（100万円 × 10.21%） */
const STEP_TAX = applyBp(RATE.stepThreshold, RATE.basicBp);
/** 2027年からの見込みの行（確定ではない） */
const EXPECTED =
  WITHHOLDING_RATES.find(
    (r) => r.status === "expected" && r.from > RATE.from,
  ) ?? null;
/** 1号の支払調書の基準（年の支払の合計がこれを超えたら） */
const REPORT_OVER = WITHHOLDING_CATEGORIES.ko1.paymentReportOver;

/** 見本の月が入る経過措置の段階と、その一つ前 */
const STEP_INDEX = TRANSITIONAL_STEPS.findIndex(
  (s) =>
    SCHOOL.serviceDate >= s.from &&
    (s.to === null || SCHOOL.serviceDate <= s.to),
);
const CURRENT_STEP = STEP_INDEX >= 0 ? TRANSITIONAL_STEPS[STEP_INDEX] : null;
const PREVIOUS_STEP =
  STEP_INDEX > 0 ? TRANSITIONAL_STEPS[STEP_INDEX - 1] : null;

/** 「年の合計ではなく1回ごと」の例：毎月同じ額を12回払う */
const MONTHLY = 100_000;
const MONTHLY_TIMES = 12;
const MONTHLY_WITHHOLDING = calcWithholding("ko1", MONTHLY, {
  date: SCHOOL.serviceDate,
});

/** 取引条件明示書の「報酬の額」に書ける算定方法（最初の見本の行から作る） */
const FIRST_SAMPLE = SCHOOL.samples[0] ?? null;
const DISCLOSURE_TEXT = FIRST_SAMPLE
  ? FIRST_SAMPLE.input.lines
      .map((l) => `${l.label} ${calcModel(l).formulaText}`)
      .join("、")
  : null;

const DESCRIPTION =
  `学習塾・スクール・習い事・フィットネスが業務委託の講師・インストラクターに払う報酬の計算を1ページに。` +
  `コマ給・月謝の歩合・レッスンと人数の加算の例、教授料の源泉徴収（${BASIC}。1回の支払で${STEP}を超える部分は${UPPER}）、` +
  `教室の使用料を相殺するときの順序、` +
  (CURRENT_STEP && PREVIOUS_STEP
    ? `${jpDate(CURRENT_STEP.from)}からのインボイス経過措置（控除${pct(CURRENT_STEP.rate)}）、`
    : "インボイスの経過措置、") +
  `フリーランス法の明示と60日。架空の例つきで、自分の数字でも無料で試せます。`;

const SOURCES = [
  {
    label:
      "国税庁 タックスアンサー No.2792（源泉徴収が必要な報酬・料金等とは）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm",
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
    label:
      "国税庁 所得税基本通達（第204条関係の共通：204-4 報酬又は料金の支払者が負担する旅費）",
    url: "https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/36/01.htm",
  },
  {
    label: "国税庁 所得税基本通達（原稿等の報酬又は料金（第1号関係））",
    url: "https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/36/02.htm",
  },
  {
    label:
      "国税庁 タックスアンサー No.7431（「報酬、料金、契約金及び賞金の支払調書」の提出範囲と提出枚数等）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/hotei/7431.htm",
  },
  {
    label: "国税庁「防衛特別所得税」及び「復興特別所得税」Q&A（令和8年5月）",
    url: "https://www.nta.go.jp/publication/pamph/pdf/0026005-024_03.pdf",
  },
  {
    label: "国税庁（令和8年度税制改正によるインボイス制度の見直し）",
    url: TRANSITIONAL_SOURCE,
  },
  {
    label: "公正取引委員会（フリーランス法のパンフレット）",
    url: "https://www.jftc.go.jp/file/flpamph.pdf",
  },
  {
    label: "公正取引委員会（2025年3月28日 フリーランス法の集中調査の結果）",
    url: "https://www.jftc.go.jp/houdou/pressrelease/2025/mar/250328_FL.html",
  },
  {
    label: "公正取引委員会の公式 X（振込手数料の扱い）",
    url: "https://x.com/jftc/status/2010909678080073897",
  },
  {
    label:
      "弁護士による裁判例の解説（業務委託の塾講師の労働者性。東京地裁 令和5年9月26日判決。民間の解説）",
    url: "https://suzukiyuta.jp/2024/09/19/case535/",
  },
];

/** テストの作問の源泉の区分（原稿の報酬に含まれないとされるもの） */
const SAKUMON_NOTE =
  "ただし、試験問題の出題料や答案の採点料は、国税庁の所得税基本通達（原稿等の報酬の範囲）で、原則として原稿の報酬に含まれないとされています（雑誌などに載せるためのものは原稿の報酬）。テストの作問を授業と別の行で払うときは、源泉の区分を税理士に確かめてください。";

/** 報酬から差し引くもの・報酬に足すもの（金額の例は上と下の計算で出す） */
const ADJUSTMENTS = [
  "源泉徴収（下の「源泉徴収」を参照）",
  "交通費：差し引くものではありません。報酬と一緒に講師へ渡すと、原則として源泉の元に入ります",
  "教室・スタジオ・楽器の使用料の相殺：契約で決めて明示・合意しておくもの。源泉は相殺の前の額にかけます",
  "教材などの立替の精算：事前に合意したものだけ",
  "欠講・振替の精算：契約で決めた算定方法で",
  "振込手数料：支払う側が負担します。公正取引委員会は、合意の有無にかかわらず、振込手数料を報酬から差し引くことは報酬の減額などとして違反になると案内しています",
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: {
    type: "website",
    locale: SITE.locale,
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
  },
};

export default function SchoolPage() {
  const taxBase = schoolTaxBaseCompare();
  const offset = schoolOffsetExample();
  const burden = schoolBurdenCompare();
  const late = schoolLateExample();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">
        業種別のまとめ：{SCHOOL.label}
      </p>
      <h1 className="mt-1 text-2xl font-bold leading-snug [word-break:auto-phrase] sm:text-3xl">
        {TITLE}
      </h1>
      <ul className="mt-4 space-y-1 border-l-4 border-accent pl-3">
        <li>
          授業・レッスンの報酬（教授料）は、個人の講師に払うときに源泉徴収をします。税率は
          {BASIC}、同じ人への1回の支払で{STEP}
          を超える部分だけ{UPPER}で、1円未満は切り捨てです。
        </li>
        <li>
          教室の使用料などの相殺は、源泉を計算したあとで差し引きます。報酬と一緒に講師へ渡す交通費は、原則として源泉の元に入ります。
        </li>
        <li>
          {CURRENT_STEP && PREVIOUS_STEP
            ? `${jpDate(CURRENT_STEP.from)}から、免税の講師への支払で控除できる割合は${pct(PREVIOUS_STEP.rate)}から${pct(CURRENT_STEP.rate)}になります（負担が出るのは原則課税の教室）。`
            : "免税の講師への支払で控除できる割合は、経過措置で段階的に下がります（負担が出るのは原則課税の教室）。"}
          フリーランス法では、頼んだらすぐに条件を示し、従業員がいる教室は、授業などを受け取った日（月で締めるなら締切日）から60日以内に払います。
        </li>
      </ul>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link
          href={PAYOUT_TOOL}
          className={ctaClass("accent", "w-full sm:w-auto")}
        >
          自分の数字で計算する（無料）
        </Link>
        <Link
          href="/contact"
          className={ctaClass("secondary", "w-full sm:w-auto")}
        >
          相談する
        </Link>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {AS_OF}時点の制度にもとづきます。例の教室・人はすべて架空です。
      </p>

      <div className="prose-ja mt-8">
        <h2>この業種の支払でよくあること</h2>
        <p>
          学習塾・スクール・習い事・フィットネスで、業務委託の講師・インストラクターに払う報酬は、コマやレッスンの単価、月謝の歩合、時間単価、月額のどれか（または組み合わせ）で決まることが多いです。アルバイト（雇用）の講師の給与は、ここでは扱いません。
        </p>
      </div>
      <SchoolPayModels />
      <p className="mt-2 text-xs text-muted-foreground">
        例の数字はすべて架空です。どの例も、インボイス登録済みの個人の講師で、請求書に消費税を分けて書いてあり、源泉を税抜の額にかける前提です。
      </p>
      <div className="prose-ja">
        <h3>差し引くもの・足すもの</h3>
        <ul>
          {ADJUSTMENTS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>

      <SchoolExample />

      <div className="prose-ja mt-4">
        <h2>源泉徴収</h2>
        <p>
          授業・レッスンの報酬は、所得税法204条1項1号の「技芸・スポーツ・知識等の教授・指導料」にあたり、
          <strong>個人の講師に払うときは源泉徴収が必要</strong>
          です。学習塾の授業も、音楽・語学・ヨガ・ダンスなどのレッスンも同じです。教材やプリントの原稿（執筆）は「原稿の報酬」で、同じ1号です。区分は講師ごとではなく、
          <strong>明細の行ごと</strong>に考えます。
        </p>
        <p>{SAKUMON_NOTE}</p>
      </div>
      <TableWrap>
        <table className="my-4 w-full min-w-[18rem] border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="border border-border bg-muted px-2 py-2 text-left"
              >
                支払の項目
              </th>
              <th
                scope="col"
                className="border border-border bg-muted px-2 py-2 text-left"
              >
                源泉徴収
              </th>
            </tr>
          </thead>
          <tbody>
            {SCHOOL.withholdingHints.map((h) => (
              <tr key={h.item}>
                <th
                  scope="row"
                  className="w-2/5 border border-border px-2 py-2 text-left font-bold"
                >
                  {h.item}
                </th>
                <td className="border border-border px-2 py-2">
                  {h.category === "none"
                    ? "しない（対象に挙げられた報酬にあたらない場合）"
                    : `する（${WITHHOLDING_CATEGORIES[h.category].short}）`}
                  {h.note && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {h.note}
                    </span>
                  )}
                  {h.item.includes("作問") && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      教材の原稿は1号。テストの出題料・採点料は原則として原稿の報酬に含まれないとされるため、要確認
                    </span>
                  )}
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
            1号の報酬は{BASIC}です。
            <strong>同一人に対する1回の支払で{STEP}を超える部分だけ</strong>が
            {UPPER}
            で、税額は（1回の支払額 − {en(RATE.stepThreshold)}）× {UPPER} ＋{" "}
            {en(STEP_TAX)}
            です。年の合計にかけるものではありません。たとえば毎月{en(MONTHLY)}
            ずつ{MONTHLY_TIMES}回払う講師（年
            {en(MONTHLY * MONTHLY_TIMES)}）でも、源泉は毎回{" "}
            {MONTHLY_WITHHOLDING.formulaText} です。
          </li>
          <li>1円未満は切り捨てます（四捨五入しません）。</li>
          <li>
            1回の支払の中で、区分が同じ行（授業・手当・教材の原稿など）を合計してから計算します。
          </li>
          <li>
            請求書等で消費税がはっきり分けて書いてあれば、税抜の額にかけてかまいません。インボイス（適格請求書）でない請求書でも同じです。分けて書いていなければ、原則どおり税込の額にかけます。
            {taxBase && (
              <>
                上の例の{taxBase.name}なら、分けて書いてあるときは元{" "}
                <Money value={taxBase.separated.base} />
                ・源泉 <Money value={taxBase.separated.withholding} />
                、分けて書いていないときは元{" "}
                <Money value={taxBase.notSeparated.base} />
                ・源泉 <Money value={taxBase.notSeparated.withholding} /> です。
              </>
            )}
          </li>
          <li>
            報酬と一緒に講師へ渡す交通費は、原則として源泉の元に入ります（所得税基本通達204-4）。教室が交通機関やホテルなどへ直接払ったもの（通常必要な範囲）は入りません。
          </li>
          <li>
            教室の使用料などを相殺するときも、源泉は
            <strong>相殺の前の報酬の額</strong>
            にかけます（相殺で元は減りません）。
            {offset && (
              <>
                上の例の{offset.name}なら、元 <Money value={offset.base} />{" "}
                に対して源泉 <Money value={offset.withholding} />
                、そのあとで{offset.deductionLabel}{" "}
                <Money value={offset.deduction} /> を差し引いて、振込は{" "}
                <Money value={offset.payout} /> です。
              </>
            )}
          </li>
          <li>講師が法人なら、原則として源泉徴収はしません。</li>
        </ul>
        <h3>納付と支払調書</h3>
        <ul>
          <li>
            源泉税は、支払った月の翌月10日までに納めます。半年ごとにまとめて納める特例（納期の特例）の対象は給与や税理士などの報酬で、教授料・原稿料は対象外です。
          </li>
          {REPORT_OVER !== null && (
            <li>
              同じ講師への1年の支払が{en(REPORT_OVER)}
              を超えたら、翌年1月31日までに支払調書を出します。
            </li>
          )}
          {EXPECTED && (
            <li>
              {ymOf(EXPECTED.from)}
              からは、防衛特別所得税が加わり、復興特別所得税の率が下がります（国税庁がQ&Aを出しています）。報酬・料金の合計の率は
              {EXPECTED.basicBp === RATE.basicBp
                ? `${BASIC}のまま変わらない見込みです`
                : `${bpText(EXPECTED.basicBp)}になる見込みです`}
              （手続きの前に国税庁の案内で確かめてください。計算の道具では、率を始まる日つきの表で持っています）。
            </li>
          )}
        </ul>

        <h2>インボイスの経過措置</h2>
        <p>
          インボイス登録をしていない（免税の）講師への支払は、本来は仕入れの消費税として差し引けません。ただ、経過措置で一定の割合だけは控除できます。割合は令和8年度の税制改正で次のようになりました。
        </p>
      </div>
      <TableWrap>
        <table className="my-4 w-full min-w-[18rem] border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="border border-border bg-muted px-2 py-2 text-left"
              >
                仕入れた日
              </th>
              <th
                scope="col"
                className="whitespace-nowrap border border-border bg-muted px-2 py-2 text-left"
              >
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
                <td className="num border border-border px-2 py-2">
                  {s.rate === 0 ? "0%（経過措置なし）" : pct(s.rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="prose-ja">
        <ul>
          <li>
            どの割合になるかは、請求書の日付や支払日ではなく、
            <strong>課税仕入れの日（役務の提供を受けた日）</strong>
            で決まります。
            {CURRENT_STEP && PREVIOUS_STEP?.to
              ? `${monthOf(PREVIOUS_STEP.to)}の授業の分を${monthOf(CURRENT_STEP.from)}に払うなら、${pct(PREVIOUS_STEP.rate)}の期間の仕入れです。`
              : ""}
          </li>
          <li>
            負担が出るのは、消費税を<strong>原則課税</strong>
            で計算している教室だけです。簡易課税や免税事業者の教室なら、講師が登録しているかどうかで納める消費税は変わりません
            {burden ? (
              <>
                （上の例と同じ支払でも、簡易課税の教室なら{" "}
                <Money value={burden.simplified} />）
              </>
            ) : null}
            。
          </li>
          {burden && (
            <li>
              上の例の{burden.first.name}
              なら、教室が控除できずに負担する消費税は
              {burden.first.burdens.map((b, i) => (
                <span key={b.label}>
                  {i > 0 && "、"}
                  {b.label}（控除{pct(b.rate)}）で <Money value={b.burden} />
                </span>
              ))}
              です。
              {burden.count > 1 && (
                <>
                  免税の講師{burden.count}人の合計では
                  {burden.totals.map((t, i) => (
                    <span key={t.label}>
                      {i > 0 && "、"}
                      {t.label} <Money value={t.burden} />
                    </span>
                  ))}
                  です（原則課税の教室の場合）。
                </>
              )}
            </li>
          )}
          <li>
            免税であることを理由に、講師の報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になるおそれがあります。見直すときは、講師と協議してください。
          </li>
        </ul>
        <p>
          <Link
            href="/tools/invoice-cost"
            className="inline-flex min-h-11 items-center"
          >
            免税の講師への支払で教室が負担する消費税を計算する（無料）
          </Link>
        </p>

        <h2>フリーランス法</h2>
        <p>
          フリーランス法（2024年11月1日施行）は、従業員を使っていない個人の講師・インストラクターに仕事を頼む教室に関わります。
        </p>
        <ul>
          <li>
            <strong>取引条件の明示（3条）</strong>
            ：講師に仕事を頼んだら直ちに、業務の内容・報酬の額・支払期日などを、書面かメールなどで示します。報酬の額は、具体的な金額を決められない事情があれば、
            <strong>
              算定方法（1コマあたりの単価 × コマ数、月謝 × 率
              など）で示してもかまいません
            </strong>
            。従業員のいない教室が頼むときも、この明示は必要です。
          </li>
          <li>
            <strong>60日以内の支払（4条）</strong>
            ：従業員を使っている教室は、給付を受け取った日（月単位で締めるなら締切日）から60日以内に支払期日を決めて払います。月末締め・翌月末払いなら60日以内です。「請求書を受け取った月の翌月末」のように、請求書の受け取りから数える決め方は、60日を超えるおそれがあります。
            {late && (
              <>
                上の例の{late.name}は、{jpDate(late.receivedOn)}締めの分を
                {jpDate(late.payOn)}に払う条件で、60日の期限（
                {jpDate(late.limit)}）を過ぎています。
              </>
            )}
          </li>
          <li>
            <strong>禁止されること（5条）</strong>
            ：1か月以上の業務委託では、受領拒否・報酬の減額・買いたたき・購入や利用の強制・不当な経済上の利益の提供の要請・不当な内容の変更ややり直しなどが禁止されています。決めた報酬をあとから一方的に下げる、合意の無い差し引きをする、教材や物販を買わせる、授業の準備・研修・代講を無償で求める、といった運用は、これらにあたるおそれがあります。振込手数料は、合意があっても報酬から差し引かず、支払う側が負担してください。
          </li>
          <li>
            <strong>6か月以上続く契約（16条）</strong>
            ：途中で解除する・更新しないときは、原則として30日前までに予告し、求められたら理由を示します。年度の契約を3月末で更新しないときが典型です。
          </li>
          <li>
            公正取引委員会は2025年3月28日、フリーランスとの取引が多い4業種（ゲームソフトウェア業・アニメーション制作業・リラクゼーション業・フィットネスクラブ）を集中的に調べた結果として、45名の事業者にフリーランス法にもとづく指導をしたと公表しました。
          </li>
        </ul>
        {FIRST_SAMPLE && DISCLOSURE_TEXT && (
          <>
            <p>
              たとえば上の{FIRST_SAMPLE.input.payee.name}
              の条件なら、明示書の「報酬の額」は算定方法として次のように書けます。
            </p>
            <blockquote>{DISCLOSURE_TEXT}</blockquote>
          </>
        )}
        <p>この業種で、明示書に書いておきたいこと：</p>
        <ul>
          {SCHOOL.disclosureExtras.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p>
          <Link
            href="/tools/torihiki-joken"
            className="inline-flex min-h-11 items-center"
          >
            取引条件明示書をつくる（支払期日の60日チェックつき・無料）
          </Link>
        </p>
      </div>

      <aside
        aria-labelledby="cautions-title"
        className="mt-10 rounded-card border-2 border-warning bg-card p-4"
      >
        <h2 id="cautions-title" className="font-bold text-warning">
          ご注意
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            このページと計算の道具は、講師・インストラクターが労働者（雇用）にあたるか、偽装請負にあたるかを判定しません。
          </li>
          <li>
            時間割や教室の指定、指導方法やテキストの細かい指定、授業以外の業務（受付・報告書・チラシ配りなど）の指示、代わりの人を立てられないこと、勤怠と結びついた固定の月額などは、労働者性のリスクがあるとされる要素です。契約の名前ではなく実態で判断されます。業務委託の塾講師について、労働組合法上の労働者にあたるとした裁判例もあります（東京地裁
            令和5年9月26日判決）。判断は弁護士・社会保険労務士などの専門家に確かめてください。
          </li>
          <li>
            実態が雇用と判断されると、給与としての源泉徴収や、消費税の仕入税額控除の扱いなども変わることがあります。
          </li>
          <li>
            税務の個別の判断は保証しません。税務のご相談も受けていません。源泉の区分（教授料か、運営の事務かなど）の最終判断は税理士に確かめてください。
          </li>
          <li>
            扱うのは、この業種でよくある代表的な支払の形だけです。契約によっては当てはまらないことがあります。アルバイト（雇用）の講師の給与の計算は対象外です。
          </li>
          <li>
            国税庁・公正取引委員会・厚生労働省などの公式の道具ではありません。出典は下にまとめています。
          </li>
        </ul>
      </aside>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">
          この例を、自分の数字で試してみませんか
        </h2>
        <p className="mt-2 text-sm">
          スクール・講師の見本を入れた状態で、無料の計算の道具が開きます。コマ数・単価・月謝・率・使用料などを自分の数字に変えて、報酬・消費税・源泉・振込額を確かめられます。毎月の支払明細や振込データの作成を仕組みにしたいときは、ご相談ください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link
            href={PAYOUT_TOOL}
            className={ctaClass("accent", "w-full sm:w-auto")}
          >
            スクールの見本で計算する（無料）
          </Link>
          <Link
            href="/contact"
            className={ctaClass("primary", "w-full sm:w-auto")}
          >
            相談する
          </Link>
        </div>
      </Card>

      <section
        aria-labelledby="sources-title"
        className="mt-8 rounded-card border border-border bg-card p-4 text-sm"
      >
        <h2 id="sources-title" className="font-bold">
          出典・参考
        </h2>
        <ul className="mt-2 space-y-1">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block min-h-11 py-2"
              >
                {s.label}
                <span className="block break-all text-xs text-muted-foreground">
                  {s.url}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted-foreground">
          {AS_OF}
          時点の制度にもとづきます。裁判例は民間の解説を参考にしています。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。
        </p>
      </section>
    </div>
  );
}
