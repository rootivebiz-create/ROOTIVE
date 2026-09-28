import type { Metadata } from "next";
import Link from "next/link";
import { ctaClass } from "@/components/landing/section";
import { TruckingExample, truckingBurdenCompare } from "@/components/for/trucking-example";
import { Card, Money } from "@/components/ui";
import { jpDate } from "@/lib/format";
import { pct } from "@/lib/payroll/money";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { SHARE_IMAGE, SITE } from "@/site.config";

const PATH = "/for/trucking";
const TITLE = "軽貨物の業務委託ドライバーの支払明細・利益・振込データ（無料で試す）";
const DESCRIPTION =
  "軽貨物の業務委託ドライバーへの支払で押さえたいことを1ページに。個建て・日当・時間の計算の例、運送の報酬に源泉徴収が要らない理由、2026年10月からのインボイス経過措置（控除70%）、フリーランス法の明示と60日。架空の例で、自分の数字でも無料で試せます。";

/** いつ時点の情報か（制度が変わったら、ここと本文を直す） */
const AS_OF = "2026年9月";

const PAYOUT_TOOL = "/tools/payout?preset=trucking";

const SOURCES = [
  {
    label: "国税庁 タックスアンサー No.2792（源泉徴収が必要な報酬・料金等とは）",
    url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm",
  },
  { label: "国税庁（令和8年度税制改正によるインボイス制度の見直し）", url: TRANSITIONAL_SOURCE },
  { label: "創業手帳（インボイスの経過措置の見直しの解説）", url: "https://sogyotecho.jp/inputtaxcredit-extension/" },
  { label: "小谷野税理士法人（インボイスの経過措置の見直しの解説）", url: "https://koyano-cpa.gr.jp/nobiyo-kaikei/column/8872/" },
  { label: "公正取引委員会（フリーランス法の概要）", url: "https://www.jftc.go.jp/fllaw_limited.html" },
  { label: "公正取引委員会（フリーランス法のパンフレット）", url: "https://www.jftc.go.jp/file/flpamph.pdf" },
];

/** 軽貨物でよくある報酬の決め方（例の数字は下の計算で出す） */
const PAY_MODELS = [
  { name: "個建て", how: "1個あたりの単価 × 配った個数", where: "宅配便の配達など" },
  { name: "日当（日建て）", how: "1日あたりの単価 × 走った日数", where: "企業配・ルート配送など" },
  { name: "時間", how: "1時間あたりの単価 × 時間", where: "時間で頼むルート配送など" },
  { name: "件数", how: "1件あたりの単価 × 件数", where: "スポット便・チャーターなど" },
];

const DEDUCTIONS = [
  "ロイヤリティ（報酬に率を掛ける）や管理費（月額）",
  "車両のリース代・保険料など、会社が用意したものの代金",
  "高速代・駐車場代などの立替（報酬とは別に精算する）",
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: {
      images: [SHARE_IMAGE], type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

export default function TruckingPage() {
  const compare = truckingBurdenCompare();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-bold text-muted-foreground">業種別のまとめ：軽貨物・運送</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug [word-break:auto-phrase] sm:text-3xl">{TITLE}</h1>
      <ul className="mt-4 space-y-1 border-l-4 border-accent pl-3">
        <li>運送の報酬は、源泉徴収が必要な報酬・料金に挙げられていないので、源泉徴収はしません。</li>
        <li>2026年10月1日以降に走ってもらった分から、免税のドライバーへの支払で会社が控除できる消費税の割合は80%から70%になります。</li>
        <li>フリーランス法で、頼んだらすぐに条件を示し、従業員を使っている会社などは受け取った日から60日以内に払う決まりです。</li>
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        しめ日ラボの製品は、軽貨物・運送会社の月末の締め（Excel の取り込み・支払明細とドライバーの確認・振込データ・元請の支払通知との突き合わせ）のために作りました。
        <Link href="/product" className="inline-flex min-h-11 items-center px-1">
          製品のご紹介を見る
        </Link>
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Link href={PAYOUT_TOOL} className={ctaClass("accent", "w-full sm:w-auto")}>
          自分の数字で計算する（無料）
        </Link>
        <Link href="/contact" className={ctaClass("secondary", "w-full sm:w-auto")}>
          相談する
        </Link>
      </div>
      <p className="mt-1 text-sm">
        <Link href="/demo" className="inline-flex min-h-11 items-center">
          支払明細・振込データ（全銀形式）の計算をデモで試す（ブラウザだけ）
        </Link>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{AS_OF}時点の制度にもとづきます。例の会社・人はすべて架空です。</p>

      <div className="prose-ja mt-8">
        <h2>この業種の支払でよくあること</h2>
        <p>軽貨物の業務委託では、ドライバーへの報酬を「数量 × 単価」で決めることがほとんどです。数量の数え方は案件によって変わります。</p>
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
        <p>報酬から差し引くもの・別に精算するものも、会社ごとにいろいろあります。</p>
        <ul>
          {DEDUCTIONS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p>
          差し引くものは、先にドライバーと話し合って決め、取引条件として示しておくものだけにします（下の「フリーランス法」を参照）。
        </p>
      </div>

      <TruckingExample />

      <div className="prose-ja mt-4">
        <h2>源泉徴収</h2>
        <p>
          所得税法204条1項は、支払うときに源泉徴収が必要な報酬・料金（原稿料・デザイン料・講演料・税理士の報酬など）を挙げています。
          <strong>運送の報酬はこの中に挙げられていません</strong>
          。そのため、個人のドライバーに配送を頼んで払う報酬からは、源泉徴収をしません（国税庁 タックスアンサー No.2792 の一覧による）。
        </p>
        <ul>
          <li>
            同じドライバーに、配送とは別の仕事（チラシのデザイン、研修の講師など）を頼んで報酬を払うときは、その分は源泉徴収が必要になることがあります。区分は支払の項目ごとに考えます。
          </li>
          <li>雇っているドライバー（従業員）に払う給与は別の話で、給与の源泉徴収が必要です。</li>
        </ul>
        <p>迷う項目があるときは、最終的な判断を税理士に確かめてください。</p>

        <h2>インボイスの経過措置</h2>
        <p>
          インボイス登録をしていない（免税の）ドライバーへの支払に含まれる消費税相当は、本来は仕入税額控除ができません。ただ、経過措置で一定の割合だけは控除できます。割合は令和8年度の税制改正で次のようになりました。
        </p>
        <table>
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
        <ul>
          <li>
            どの割合になるかは、請求書の日付や支払日ではなく、<strong>課税仕入れの日（ドライバーに走ってもらった日）</strong>
            で決まります。9月に走ってもらった分を10月に払うなら、80%の期間の仕入れです。
          </li>
          <li>
            負担が増えるのは、消費税を原則課税で計算している会社です。発注する側が簡易課税・2割特例・免税事業者なら、この負担は出ません。
          </li>
          <li>経過措置を使うには、帳簿に経過措置の適用を受ける旨を書き、必要な事項が書かれた請求書などを保存しておく必要があります。</li>
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
            免税であることを理由に、単価や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になるおそれがあります。見直すときはドライバーと協議してください。
          </li>
        </ul>
        <p>
          <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center">
            免税ドライバーへの支払で会社が負担する消費税を計算する（無料）
          </Link>
        </p>

        <h2>フリーランス法</h2>
        <p>フリーランス法（2024年11月1日施行）は、従業員を使わずに一人で働くドライバー（個人・一人社長の会社）に仕事を頼む会社に関わります。</p>
        <ul>
          <li>
            <strong>取引条件の明示（3条）</strong>
            ：仕事を頼んだら直ちに、業務の内容・報酬の額（算定方法でも可）・支払期日などを、紙かメール・LINEなどで示します。
          </li>
          <li>
            <strong>60日以内の支払（4条）</strong>
            ：従業員を使っている会社（役員が2人以上の会社も含む）は、仕事を受け取った日から60日以内のできるだけ早い日に支払期日を決めて払います。毎月末締めなら、翌月末までの支払期日にします。
          </li>
          <li>
            <strong>差し引くもの</strong>
            ：ロイヤリティ・管理費・車両のリース代・保険料などは、取引条件として示し、合意したものだけにします。1か月以上の委託で一方的に差し引くと、報酬の減額にあたるおそれがあります。合意があっても、会社の車両や保険を無理に使わせる形は、購入・利用の強制などの問題になりえます。計算の道具では、合意の印が無い差し引きに注意を出します。
          </li>
          <li>振込手数料は、会社（支払う側）の負担が安全です。取適法の運用では、合意があっても報酬から差し引くと減額とされえます。フリーランス法でも問題とされうるため、差し引いているなら見直しをおすすめします。</li>
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
            このページと計算の道具は、ドライバーが労働者（雇用）にあたるか、偽装請負にあたるかを判定しません。時間や作業の細かい指示、勤怠の管理、成果にかかわらない固定の保証などがある形は、労働者性が問題になることがあります。判断は弁護士・社会保険労務士などの専門家に確かめてください。
          </li>
          <li>税務の個別の判断は保証しません。税務のご相談も受けていません。区分の最終判断は税理士に確かめてください。</li>
          <li>扱うのは、軽貨物でよくある代表的な支払の形だけです。御社の契約によっては当てはまらないことがあります。</li>
          <li>国税庁・公正取引委員会などの公式の道具ではありません。出典は下にまとめています。</li>
        </ul>
      </aside>

      <Card className="mt-10 border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">この例を、御社の数字で試してみませんか</h2>
        <p className="mt-2 text-sm">
          単価・数量・差し引くものを入れると、報酬・消費税・振込額と、免税のドライバーの分の負担がその場で分かります。入れた数字は送信しません。毎月の締め（今の Excel の取り込み・支払明細とドライバーの確認・振込データ・元請の支払通知との突き合わせ）を、御社のやり方のまま任せたいときはご相談ください。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link href={PAYOUT_TOOL} className={ctaClass("accent", "w-full sm:w-auto")}>
            軽貨物の見本で計算する（無料）
          </Link>
          <Link href="/contact" className={ctaClass("primary", "w-full sm:w-auto")}>
            30分の相談を申し込む
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
