import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, faqPageLd } from "@/components/json-ld";
import { TorihikiJokenTool } from "@/components/tools/torihiki-joken";
import { buttonClass, Card } from "@/components/ui";
import {
  STATUS_LABELS,
  TORIHIKI_RULES_AS_OF,
  paymentDeadlineCheck,
  type DayOfMonth,
  type DeadlineStatus,
  type PayMonthOffset,
} from "@/lib/tools/torihiki-joken";
import { SITE } from "@/site.config";

const PATH = "/tools/torihiki-joken";
const TITLE = "軽貨物ドライバーの取引条件明示書をつくる（フリーランス法）｜支払期日の60日チェックつき";
const DESCRIPTION =
  "業務委託の軽貨物ドライバーに渡す「取引条件明示書」を、単価・管理費などの差し引き・締め日と支払日を入れるだけで作れます。A4で印刷でき、LINE・メールで送る文面もコピーできます。支払日がフリーランス法の60日以内かも、12か月分まとめて確かめます。";

const SOURCES = [
  { label: "公正取引委員会（フリーランス法 特設サイト）", url: "https://www.jftc.go.jp/freelancelaw_2025/" },
  {
    label: "公正取引委員会・中小企業庁（フリーランス法 説明資料）",
    url: "https://www.chusho.meti.go.jp/keiei/torihiki/download/freelance/law_02.pdf",
  },
  { label: "公正取引委員会（フリーランス法 パンフレット）", url: "https://www.jftc.go.jp/file/flpamph.pdf" },
  {
    label: "公正取引委員会・厚生労働省（特定受託事業者に係る取引の適正化等に関する法律の考え方。2025年10月1日改正）",
    url: "https://www.jftc.go.jp/file/fl_jftcmhlwguidelines.pdf",
  },
  {
    label: "公正取引委員会（公正取引委員会関係 特定受託事業者に係る取引の適正化等に関する法律施行規則）",
    url: "https://www.jftc.go.jp/fllawjftcrules.html",
  },
  { label: "公正取引委員会（フリーランス法 Q&A）", url: "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html" },
  { label: "公正取引委員会・中小企業庁（取適法のリーフレット）", url: "https://www.jftc.go.jp/file/toriteki_leaflet.pdf" },
  { label: "公正取引委員会（フリーランス法にもとづく勧告の一覧）", url: "https://www.jftc.go.jp/FL/FLkankoku/index.html" },
  { label: "LNEWS（2026年9月2日 日本郵便への勧告の記事）", url: "https://www.lnews.jp/2026/09/s0902505.html" },
  { label: "公正取引委員会の公式 X（振込手数料の扱い）", url: "https://x.com/jftc/status/2010909678080073897" },
];

/** 本文の例。2026年10月1日から始めた場合の12か月で判定する（土日は前の営業日へ） */
const EXAMPLE_RULES: { closingDay: DayOfMonth; payMonthOffset: PayMonthOffset; payDay: DayOfMonth }[] = [
  { closingDay: "末", payMonthOffset: 1, payDay: "末" },
  { closingDay: 20, payMonthOffset: 1, payDay: 20 },
  { closingDay: 20, payMonthOffset: 1, payDay: "末" },
  { closingDay: "末", payMonthOffset: 2, payDay: 10 },
  { closingDay: "末", payMonthOffset: 2, payDay: "末" },
];

const EXAMPLE_NOTE: Record<DeadlineStatus, string> = {
  ok: "締め期間の最初の日から数えても2か月以内",
  caution: "締め日から数えれば2か月以内。条件にあてはまるか確かめる",
  ng: "締め日から数えても2か月を超える月がある",
};

const EXAMPLES = EXAMPLE_RULES.map((r) => {
  const result = paymentDeadlineCheck({ ...r, holidayRule: "before", serviceFrom: "2026-10-01" });
  return { label: result.ruleLabel, status: result.status };
});

const STATUS_CLASS: Record<DeadlineStatus, string> = {
  ok: "text-success",
  caution: "text-warning",
  ng: "text-danger",
};

const FAQ = [
  {
    q: "ドライバーへの取引条件は、LINEで送ってもいいですか？",
    a: "送れます。フリーランス法では、紙のほか、メールやSNSのメッセージなど（相手を決めて送るもの）で示すこともできます。送ったメッセージは消さずに保存しておき、ドライバーから紙で求められたら渡します。",
  },
  {
    q: "月末締め・翌月末払いは、60日以内ですか？",
    a: "60日以内です。公正取引委員会と中小企業庁の資料では、毎月末日で締める場合は、翌月末日までに支払期日を決める必要があるとされています。20日締めで翌月末に払う場合などは、締め期間の最初の日から数えると2か月を超えるので、締め日から数えてよい条件にあてはまるかを確かめてください。",
  },
  {
    q: "振込手数料をドライバーの報酬から差し引いてもいいですか？",
    a: "振込手数料は、会社（支払う側）の負担にしておくのが安全です。取適法（旧下請法）の運用では、合意があっても代金から差し引くと「減額」とされえます。フリーランス法でも、公正取引委員会は、2026年1月1日以後に発注する取引から考え方が変わり、合意があっても報酬から差し引くと「報酬の減額」などにあたりうると案内しています。",
  },
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // openGraph はレイアウトの値を丸ごと置きかえるので、locale と siteName もここで入れる
  openGraph: { type: "website", locale: SITE.locale, siteName: SITE.name, title: TITLE, description: DESCRIPTION, url: PATH },
};

export default function TorihikiJokenPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <JsonLd data={faqPageLd(FAQ)} />
      <div className="no-print max-w-3xl">
        <p className="text-sm font-bold text-muted-foreground">無料のひな形づくり</p>
        <h1 className="mt-1 text-2xl font-bold leading-snug sm:text-3xl">
          軽貨物ドライバーの「取引条件明示書」をつくる
          <span className="mt-1 block text-lg sm:text-xl">（フリーランス法・支払期日の60日チェックつき）</span>
        </h1>
        <p className="mt-3">
          業務委託のドライバーに仕事を頼んだら、単価や支払日などの条件を、すぐに紙かメール・LINEなどで示す決まりがあります。下の欄を埋めると、A4の明示書と、LINE・メールで送る文面ができます。支払日が60日以内かも、12か月分まとめて確かめます。
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-2 py-1 font-bold text-foreground">{TORIHIKI_RULES_AS_OF}時点の情報にもとづきます</span>
          <span className="py-1">入れた内容はこの画面の中だけで使い、送信しません。</span>
        </p>
      </div>

      <aside
        aria-label="ご注意"
        className="no-print mt-4 max-w-3xl rounded-card border-2 border-warning bg-card p-4 text-sm"
      >
        <p className="font-bold">これはひな形の作成を手伝う道具です。最終的な内容は弁護士・社労士などにご確認ください。</p>
        <p className="mt-1 text-muted-foreground">
          法令への対応を保証するものではありません。御社の契約書や、元請との取り決めとあわせて確かめてください。
        </p>
      </aside>

      <div className="mt-6 print:mt-0">
        <TorihikiJokenTool />
      </div>

      <div className="no-print prose-ja mt-12 max-w-3xl">
        <h2>いま確かめておきたい理由</h2>
        <p>
          2026年9月2日、公正取引委員会は日本郵便に対して、フリーランス法にもとづく勧告を行いました。配達などを頼んでいたフリーランスに
          <strong>取引条件を示していなかったこと</strong>と、<strong>報酬の支払が遅れていたこと</strong>
          が理由です。報道によると、先に条件を示さず、請求書が届いてから払うやり方が原因とされています。
        </p>
        <p>業務委託のドライバーに、単価を口頭で伝えただけになっていないか、支払日が長すぎないか。この機会に確かめておきましょう。</p>

        <h2>明示書に書くこと</h2>
        <p>
          フリーランス法（2024年11月1日施行）では、従業員を雇っていない個人のドライバー（一人社長の会社を含む）に仕事を頼んだら、<strong>直ちに</strong>
          、次の事項を紙かメール・LINEなどで示す必要があります（第3条と公正取引委員会規則）。
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">書く事項</th>
              <th scope="col">軽貨物での書き方の例</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1. 委託する者・受ける者の名前</td>
              <td>会社名と、ドライバーの氏名か屋号（番号や記号でも可）</td>
            </tr>
            <tr>
              <td>2. 業務委託をした日</td>
              <td>仕事を頼むことを話し合って決めた日</td>
            </tr>
            <tr>
              <td>3. 業務の内容</td>
              <td>宅配便の配達、企業配（ルート配送）など</td>
            </tr>
            <tr>
              <td>4. 業務を行う日・期間</td>
              <td>2026年10月1日から2027年9月30日まで など</td>
            </tr>
            <tr>
              <td>5. 業務を行う場所</td>
              <td>〇〇営業所と、〇〇市の担当エリア など</td>
            </tr>
            <tr>
              <td>6. 検査をする場合は、検査を終える日</td>
              <td>検査をしないなら書かなくてよい</td>
            </tr>
            <tr>
              <td>7. 報酬の額</td>
              <td>1個150円 × 個数 のような決め方（算定方法）でも可</td>
            </tr>
            <tr>
              <td>8. 支払期日</td>
              <td>毎月末日締め、翌月末日払い のような具体的な日</td>
            </tr>
            <tr>
              <td>9. 現金以外で払う場合の事項</td>
              <td>銀行振込なら不要。手形・電子記録債権・デジタル払いなどで払う場合は必要</td>
            </tr>
          </tbody>
        </table>
        <p>
          まだ決まっていない事項があるときは、決まらない理由と、決める予定の日を書き、決まったらすぐに示します。「翌月10日まで」「60日以内」のような書き方では、支払期日を決めたことにならないおそれがあるので、日を決めて書きます。
        </p>

        <h2>支払期日は「60日以内」</h2>
        <p>
          従業員がいる（または役員が2人以上いる）会社などがこうしたドライバーに仕事を頼む場合、報酬の支払期日は、
          <strong>仕事を受けた日から数えて60日以内の、できるだけ早い日</strong>に決めます（第4条）。
        </p>
        <ul>
          <li>月ごとに締める場合は、60日を「2か月」として扱い、31日の月も30日の月も1か月と数えます。月末締めなら、翌月末日までに払う必要があります。</li>
          <li>
            同じ種類の仕事が続き、①毎月の締めでまとめて払うことを話し合って決めて明示書に書き、②報酬の額か決め方を明示書に書いている場合は、締め期間の末日に仕事を受けたものとして、締め日から数えることが認められています（解釈ガイドライン）。
          </li>
        </ul>
        <p>
          この道具は安全側に倒して判定します。締め期間の最初の日から数えても2か月以内なら「{STATUS_LABELS.ok}」、締め日から数えてはじめて2か月以内なら「
          {STATUS_LABELS.caution}」、締め日から数えても超える月があれば「{STATUS_LABELS.ng}」と出します。
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">支払のルール</th>
              <th scope="col">判定</th>
              <th scope="col">理由</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map((e) => (
              <tr key={e.label}>
                <td>{e.label}</td>
                <td className={`font-bold ${STATUS_CLASS[e.status]}`}>{STATUS_LABELS[e.status]}</td>
                <td>{EXAMPLE_NOTE[e.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>2026年10月1日から始めた場合の12か月で判定しています。土日と年末年始は前の営業日に払う前提です。</p>

        <h2>振込手数料と、報酬から差し引くもの</h2>
        <p>
          公正取引委員会は、<strong>2026年1月1日以後に発注する取引</strong>
          から考え方が変わり、合意があっても振込手数料を報酬から差し引くと「報酬の減額」などにあたりうると案内しています。取適法（旧下請法）の運用でも、合意があっても差し引くと「減額」とされえます。振込手数料は、会社（支払う側）の負担にしておくのが安全です。
        </p>
        <p>
          管理費・ロイヤリティ・車両のリース代などを報酬から差し引くなら、先に話し合って決め、明示書に書いておきます。1か月以上続く業務委託などでは、ドライバーに責任がないのに、決めた報酬を後から減らすことは禁止されています。
        </p>
        <p>
          ただし、明示書に書けば何でも差し引けるわけではありません。振込手数料のように、合意があっても減額とされうるものがあります。何の費用として、いくら差し引くのかを説明できるようにしておき、迷うものは弁護士などに確かめてください。
        </p>

        <h2>LINE・メールで送るとき</h2>
        <ul>
          <li>メール・SMS・LINE などのメッセージで示してもかまいません。ただし、相手を決めて送るものに限ります（誰でも見られるホームページに載せておくだけでは足りません）。</li>
          <li>メッセージは消えたり見られなくなったりすることがあるので、スクリーンショットなどで記録を残しておきましょう。</li>
          <li>メッセージで示したあとでも、ドライバーから紙で求められたら、すぐに渡します。</li>
        </ul>
      </div>

      <section className="no-print mt-8 max-w-3xl rounded-card border border-border bg-card p-4 text-sm">
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
          {TORIHIKI_RULES_AS_OF}時点の情報にもとづきます。制度や考え方は変わることがあるので、使う前に出典の最新の情報を確かめてください。個別の判断は弁護士・社労士などに確かめてください。
        </p>
      </section>

      <section className="no-print mt-10 max-w-3xl">
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

      <Card className="no-print mt-10 max-w-3xl border-2 border-foreground">
        <h2 className="text-lg font-bold leading-snug">ドライバーごとの明示書を、支払明細といっしょに</h2>
        <p className="mt-2 text-sm">
          ドライバー・単価・差し引くもの・締め日の台帳から、ドライバーごとの明示書と、毎月の支払明細・振込データを作る仕組みを、御社のアカウントに作ります。まずはデモをさわってみてください。
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
