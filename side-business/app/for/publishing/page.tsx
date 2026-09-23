import type { Metadata } from "next";
import Link from "next/link";
import {
  PUBLISHING,
  PublishingExample,
  jpDate,
  manYen,
  publishingBurdenCompare,
  publishingLateExample,
  publishingTaxBaseCompare,
} from "@/components/for/publishing-example";
import { ctaClass } from "@/components/landing/section";
import { Card, Money, TableWrap } from "@/components/ui";
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

const PATH = "/for/publishing";
const TITLE = "原稿料・撮影料・イラスト料・印税の源泉徴収と支払明細（無料の計算ツール）";

/** いつ時点の情報か（制度が変わったら、ここと本文を直す） */
const AS_OF = "2026年9月";

const PAYOUT_TOOL = "/tools/payout?preset=publishing";

/* ───────────── 本文に埋め込む数字（率は表から引き、ここに直書きしない） ───────────── */

/** 見本の支払の日の源泉の率 */
const RATE = withholdingRateFor(PUBLISHING.serviceDate);
const BASIC = bpText(RATE.basicBp);
const UPPER = bpText(RATE.upperBp);
const STEP = manYen(RATE.stepThreshold);
/** 段階の境目までの税額（100万円 × 10.21% = 102,100円） */
const STEP_TAX = applyBp(RATE.stepThreshold, RATE.basicBp);
/** 次に率の表が切り替わる行（見込みのこともある） */
const NEXT_RATE = WITHHOLDING_RATES.find((r) => r.from > RATE.from) ?? null;
/** 1号の支払調書の基準（年の支払の合計がこれを超えたら） */
const REPORT_OVER = WITHHOLDING_CATEGORIES.ko1.paymentReportOver;

/** 見本の月の経過措置の段階と、その前の段階 */
const STEP_INDEX = TRANSITIONAL_STEPS.findIndex(
  (s) => PUBLISHING.serviceDate >= s.from && (s.to === null || PUBLISHING.serviceDate <= s.to),
);
const STEP_NOW = STEP_INDEX >= 0 ? TRANSITIONAL_STEPS[STEP_INDEX] : null;
const STEP_PREV = STEP_INDEX > 0 ? TRANSITIONAL_STEPS[STEP_INDEX - 1] : null;

/** 1回の支払ごとの源泉税の早見（源泉の元） */
const QUICK_AMOUNTS = [100_000, 500_000, 1_000_000, 1_500_000, 3_000_000];
const QUICK = QUICK_AMOUNTS.map((amount) => ({
  amount,
  tax: calcWithholding("ko1", amount, { date: PUBLISHING.serviceDate }).tax,
}));

/** 「年の合計ではなく1回ごと」の例：毎月同じ額を12回払う */
const MONTHLY = 500_000;
const MONTHLY_TAX = calcWithholding("ko1", MONTHLY, { date: PUBLISHING.serviceDate }).tax;

const DESCRIPTION =
  `出版社・編集プロダクション・Webメディアが、ライター・カメラマン・イラストレーター・著者に払うときの源泉徴収（${BASIC}。1回の支払で${STEP}を超える部分は${UPPER}）、` +
  `消費税を分けて書いたときの源泉の元、${STEP_NOW ? `${jpDate(STEP_NOW.from)}からのインボイス経過措置（控除${pct(STEP_NOW.rate)}）` : "インボイスの経過措置"}、` +
  "フリーランス法の明示と60日を1ページに。架空の例つきで、自分の数字でも無料で試せます。";

const SOURCES = [
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
    label: "国税庁 タックスアンサー No.2507（復興特別所得税の源泉徴収）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2507.htm",
  },
  {
    label: "国税庁 タックスアンサー No.2505（源泉所得税及び復興特別所得税の納付期限と納期の特例）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2505.htm",
  },
  {
    label: "国税庁 タックスアンサー No.7431（「報酬、料金、契約金及び賞金の支払調書」の提出範囲と提出枚数等）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/hotei/7431.htm",
  },
  { label: "国税庁（令和8年度税制改正によるインボイス制度の見直し）", url: TRANSITIONAL_SOURCE },
  { label: "公正取引委員会（フリーランス法の概要）", url: "https://www.jftc.go.jp/fllaw_limited.html" },
  { label: "公正取引委員会（フリーランス法にもとづく勧告の一覧）", url: "https://www.jftc.go.jp/FL/FLkankoku/index.html" },
  {
    label: "日本経済新聞（2025年6月 小学館と光文社への勧告の記事）",
    url: "https://www.nikkei.com/article/DGXZQOUD13DF70T10C25A6000000/",
  },
  { label: "光文社（公正取引委員会からの勧告について）", url: "https://www.kobunsha.com/news/0000000172/" },
];

/** 出版・編集・Web メディアでよくある報酬の決め方（例の数字は下の計算で出す） */
const PAY_MODELS = [
  { name: "原稿料", how: "字数 × 1字の単価、ページ数 × 1ページの単価、または1本いくら", where: "Web記事・雑誌・書籍の原稿" },
  { name: "撮影料", how: "カット数 × 1カットの単価、または日当 × 撮影日数（機材費を足すことも）", where: "雑誌・書籍・広告など、印刷物に載せる写真の撮影" },
  { name: "イラスト料・デザイン料", how: "点数 × 1点の単価、または1件いくら", where: "挿絵・表紙・図版・誌面のデザイン" },
  { name: "印税", how: "本体価格 × 部数 × 印税率（発行部数か実売部数かは契約で決める）", where: "書籍の著者など" },
];

const DEDUCTIONS = [
  "源泉徴収（下の「源泉徴収」を参照）",
  "交通費・宿泊費などの経費（報酬と一緒に払うと、源泉徴収の元に入ります）",
  "前払いした印税や仮払金との相殺（契約で決めておくもの）",
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

export default function PublishingPage() {
  const taxBase = publishingTaxBaseCompare();
  const burden = publishingBurdenCompare();
  const late = publishingLateExample();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">業種別のまとめ：出版・編集・Webメディア</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug [word-break:auto-phrase] sm:text-3xl">{TITLE}</h1>
      <ul className="mt-4 space-y-1 border-l-4 border-accent pl-3">
        <li>
          個人の方に原稿料・イラスト料・デザイン料・印税や、印刷物に載せる写真の撮影料を払うときは、源泉徴収をします。税率は{BASIC}、同じ人への1回の支払で
          {STEP}を超える部分だけ{UPPER}で、1円未満は切り捨てです。
        </li>
        <li>
          {STEP_NOW && STEP_PREV
            ? `${jpDate(STEP_NOW.from)}以後の仕入れ（納品を受けた日など）から、インボイス登録をしていない（免税の）方への支払で控除できる割合は、${pct(STEP_PREV.rate)}から${pct(STEP_NOW.rate)}になります。`
            : "インボイス登録をしていない（免税の）方への支払は、経過措置の割合だけ控除できます。"}
        </li>
        <li>
          フリーランス法で、頼んだらすぐに条件を示し、従業員がいる会社は納品を受けた日から60日以内に払います。刊行日を待って払うと過ぎることがあります。
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
      <p className="mt-2 text-xs text-muted-foreground">{AS_OF}時点の制度にもとづきます。例の会社・人・金額はすべて架空です。</p>

      <div className="prose-ja mt-8">
        <h2>この業種の支払でよくあること</h2>
        <p>
          出版社・編集プロダクション・Webメディアでは、ライター・カメラマン・イラストレーター・著者への報酬を「数量 × 単価」か「売上 × 率」で決めることがほとんどです。数量の数え方は、仕事によって変わります。
        </p>
      </div>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2">
        {PAY_MODELS.map((m) => (
          <li key={m.name}>
            <Card className="h-full">
              <p className="font-bold">{m.name}</p>
              <p className="mt-1 text-sm">{m.how}</p>
              <p className="mt-1 text-xs text-muted-foreground">{m.where}</p>
            </Card>
          </li>
        ))}
      </ul>
      <div className="prose-ja">
        <p>報酬から差し引くもの・別に払うものも、仕事ごとにあります。</p>
        <ul>
          {DEDUCTIONS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p>源泉徴収のほかに差し引くものは、先に相手と話し合って決め、取引条件として示しておくものだけにします（下の「フリーランス法」を参照）。</p>
      </div>

      <PublishingExample />

      <div className="prose-ja mt-4">
        <h2>源泉徴収</h2>
        <p>
          所得税法204条1項1号と所得税法施行令320条1項は、原稿・挿絵・デザインの報酬、雑誌・広告などの印刷物に載せる写真の報酬、講演料、著作権の使用料（印税）などを、払うときに源泉徴収が必要な報酬として挙げています。個人のライター・カメラマン・イラストレーター・著者に払うときは、払う側が所得税と復興特別所得税を差し引いて、国に納めます。
        </p>
      </div>
      <Card className="mt-2">
        <p className="text-xs font-bold text-muted-foreground">税額の出し方（同じ人への1回の支払ごと）</p>
        <ul className="mt-2 divide-y divide-border text-sm">
          <li className="py-2">
            <span className="font-bold">1回の支払が{STEP}以下</span>
            <span className="mt-0.5 block">支払額 × {BASIC}</span>
          </li>
          <li className="py-2">
            <span className="font-bold">1回の支払が{STEP}を超える</span>
            <span className="mt-0.5 block">
              （支払額 − {STEP}）× {UPPER} ＋ {en(STEP_TAX)}
            </span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">税額に1円未満の端数が出たら切り捨てます。</p>
      </Card>
      <div className="prose-ja">
        <TableWrap>
          <table>
            <caption className="sr-only">1回の支払の額ごとの源泉税</caption>
            <thead>
              <tr>
                <th scope="col">1回の支払（源泉の元）</th>
                <th scope="col">源泉税</th>
              </tr>
            </thead>
            <tbody>
              {QUICK.map((q) => (
                <tr key={q.amount}>
                  <td className="num">{en(q.amount)}</td>
                  <td className="num">{en(q.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <ul>
          <li>
            {UPPER}がかかるのは、<strong>同じ人への1回の支払で{STEP}を超える部分だけ</strong>
            です。年の合計にはかけません。たとえば毎月{manYen(MONTHLY)}を払う相手なら、年の合計が{manYen(MONTHLY * 12)}
            になっても、どの回も{BASIC}（1回 {en(MONTHLY_TAX)}）です。
          </li>
          <li>
            源泉徴収の元は、原則として消費税を含めた額です。請求書などで報酬と消費税がはっきり分けて書いてあれば、報酬の額だけにかけてかまいません。インボイス（適格請求書）ではない請求書でも、免税事業者の請求書でも同じです。
            {taxBase && (
              <>
                上の{taxBase.name}の例で、消費税が分けて書かれていなければ、元は{en(taxBase.notSeparated.base)}、源泉税は
                {en(taxBase.notSeparated.withholding)}になります（分けてあれば{en(taxBase.separated.withholding)}）。
              </>
            )}
          </li>
          <li>
            写真の報酬で源泉徴収の対象として挙げられているのは、「雑誌、広告その他の印刷物に掲載するための写真」の報酬です（所得税法施行令320条1項）。Webサイトだけに載せる写真や記録のための撮影は、扱いの考え方が分かれるので、税理士に確かめてください。
          </li>
          <li>
            交通費・宿泊費を報酬と一緒に本人へ払うと、その分も源泉徴収の元に入ります。会社が交通機関やホテルへ直接払った分は、通常必要な範囲なら入れなくてかまいません（所得税基本通達204-4）。
          </li>
          <li>支払先が法人（株式会社の編集プロダクションなど）なら、原稿料などの源泉徴収はしません。</li>
          <li>源泉徴収した税は、原則として支払った月の翌月10日までに納めます。</li>
          {REPORT_OVER !== null && (
            <li>
              同じ人への年の支払が{manYen(REPORT_OVER)}を超えたら、「報酬、料金、契約金及び賞金の支払調書」を翌年1月31日までに税務署へ出します。
            </li>
          )}
          {NEXT_RATE && (
            <li>
              {NEXT_RATE.status === "expected"
                ? `${jpDate(NEXT_RATE.from)}以後の支払は、税の内訳が変わっても、合計の率は${bpText(NEXT_RATE.basicBp)}のままの見込みです。`
                : `${jpDate(NEXT_RATE.from)}以後の支払の合計の率は${bpText(NEXT_RATE.basicBp)}です。`}
              計算の道具は、支払日ごとの率の表で計算します。
            </li>
          )}
        </ul>
        <p>
          どの区分になるか迷う仕事（一覧に無い名前の仕事や、いくつかの仕事をまとめて頼む場合など）は、最終的な判断を税理士に確かめてください。
        </p>

        <h2>インボイスの経過措置</h2>
        <p>
          ライター・カメラマン・イラストレーターには、インボイス登録をしていない（免税の）方も少なくありません。免税の方への支払は、本来は仕入れの消費税として差し引けませんが、経過措置で一定の割合だけは控除できます。割合は令和8年度の税制改正で次のようになりました。
        </p>
        <TableWrap>
          <table>
            <caption className="sr-only">免税の方からの仕入れで控除できる割合</caption>
            <thead>
              <tr>
                <th scope="col">仕入れた日</th>
                <th scope="col">
                  控除できる
                  <span className="sm:hidden">
                    <br />
                  </span>
                  割合
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
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <ul>
          <li>
            どの割合になるかは、請求書の日付や支払日ではなく、<strong>課税仕入れの日（原稿や写真の納品を受けた日など）</strong>
            で決まります。
            {STEP_NOW && STEP_PREV
              ? `${jpDate(STEP_PREV.to ?? STEP_NOW.from)}までに納品を受けた原稿の原稿料を${jpDate(STEP_NOW.from)}以後に払うなら、${pct(STEP_PREV.rate)}の期間の仕入れです。`
              : ""}
          </li>
          <li>
            負担が増えるのは、消費税を原則課税で計算している会社です。発注する側が簡易課税や免税事業者なら、この負担は出ません。
          </li>
          {burden && (
            <li>
              上の例の{burden.name}なら、会社が控除できずに負担する消費税は
              {burden.burdens.map((b, i) => (
                <span key={b.label}>
                  {i > 0 && "、"}
                  {b.label}（控除{pct(b.rate)}）で<Money value={b.burden} />
                </span>
              ))}
              です（原則課税の会社の場合）。
            </li>
          )}
          <li>
            免税であることを理由に、報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になるおそれがあります。見直すときは相手と協議してください。
          </li>
        </ul>
        <p>
          <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center">
            免税の方への支払で会社が負担する消費税を計算する（無料）
          </Link>
        </p>

        <h2>フリーランス法</h2>
        <p>
          フリーランス法（2024年11月1日施行）は、個人のライター・カメラマン・イラストレーター・著者に仕事を頼む出版社・編集プロダクション・Webメディアにも関わります。
        </p>
        <ul>
          <li>
            <strong>取引条件の明示（3条）</strong>
            ：仕事を頼んだら直ちに、業務の内容・報酬の額・支払期日などを、紙かメールなどで示します。従業員のいない発注者にも求められます。
          </li>
          <li>
            <strong>60日以内の支払（4条）</strong>
            ：従業員を使っている会社は、納品を受けた日（給付を受け取った日）から60日以内の、できるだけ短い期間で支払期日を決めて払います。刊行日や掲載日を基準にすると、60日を過ぎることがあります。
            {late && (
              <>
                上の例の{late.name}は、納品{jpDate(late.receivedOn)}・支払{jpDate(late.payOn)}で、納品の日を1日目として{late.day}
                日目の支払なので、60日を過ぎています（1回ごとに支払期日を決めている場合）。
              </>
            )}
            ただし、「月末締め・翌月末払い」のように月ごとに締めて払う決まりなら、公正取引委員会の考え方では「60日以内」を「2か月以内」として運用します（月の日数の違いは問いません）。「翌々月払い」は、この運用でも期限を過ぎることがあります。
          </li>
          <li>
            <strong>著作権の扱い</strong>
            ：著作権を譲り受けるのか、使ってよい範囲を決めるのか、その対価を報酬に含むのかも、取引条件と一緒に書いておくと、あとで食い違いが起きにくくなります。
          </li>
          <li>
            <strong>差し引くもの</strong>
            ：源泉徴収のほかに差し引くものは、取引条件として示し、合意したものだけにします。一方的に差し引くと、報酬の減額にあたるおそれがあります。振込手数料は、支払う側の負担を基本にしてください。
          </li>
        </ul>
      </div>
      <Card className="mt-2">
        <p className="text-xs font-bold text-muted-foreground">フリーランス法の最初の勧告は出版社</p>
        <p className="mt-2 text-sm leading-relaxed">
          2025年6月17日、公正取引委員会は小学館と光文社に、フリーランス法にもとづく勧告をしました。原稿の執筆や写真の撮影などを頼むときに取引条件を示さなかったこと、期日までに報酬を払わなかったことが理由です。雑誌などの刊行日を基準に払っていて、業務が終わった日から支払まで80日以上あいた例もあったと報じられています。
        </p>
      </Card>
      <div className="prose-ja">
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
            このページと計算の道具は、相手が労働者（雇用）にあたるか、偽装請負にあたるかを判定しません。席や勤務時間を決めて毎日来てもらう、細かく指示する、成果にかかわらない固定の報酬を払う、といった形は、労働者性が問題になることがあります。判断は弁護士・社会保険労務士などの専門家に確かめてください。
          </li>
          <li>税務の個別の判断は保証しません。税務のご相談も受けていません。源泉徴収の区分の最終判断は税理士に確かめてください。</li>
          <li>
            扱うのは、出版・編集・Webメディアでよくある代表的な支払の形（原稿料・撮影料・イラスト料・デザイン料・印税）だけです。契約によっては当てはまらないことがあります。
          </li>
          <li>国税庁・公正取引委員会などの公式の道具ではありません。出典は下にまとめています。</li>
        </ul>
      </aside>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">この例を、自分の数字で試してみませんか</h2>
        <p className="mt-2 text-sm">
          字数・ページ・点数と単価、消費税を分けて書くか、交通費を一緒に払うかを入れると、源泉徴収・振込額と、免税の方の分の負担がその場で分かります。入れた数字は送信しません。毎月の支払明細づくりを仕組みにしたいときは、ご相談ください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href={PAYOUT_TOOL} className={ctaClass("accent", "w-full sm:w-auto")}>
            出版・編集の見本で計算する（無料）
          </Link>
          <Link href="/contact" className={ctaClass("primary", "w-full sm:w-auto")}>
            相談を申し込む
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
          {AS_OF}時点の制度にもとづきます。制度は変わることがあるので、手続きの前に出典の最新の情報を確かめてください。
        </p>
      </section>
    </div>
  );
}
