import { compactYen } from "@/lib/format";
import { trialPlan } from "@/lib/plans";
import { PLANS, SITE } from "@/site.config";
import { Section } from "./section";

export type FaqItem = { q: string; a: string };

/**
 * 単価や元請の情報を預けてよいかの答え。作り手が運送会社を経営していると書けるとき（SITE.makerIsOperator）は、
 * 同業に知られる心配として聞かれるので、取引先が重ならないことも答える。約束するのはここに書いたことだけ。
 */
export function confidentialityFaq(isOperator: boolean = SITE.makerIsOperator): FaqItem {
  const common = [
    "データをお預かりする前に、秘密保持契約を結びます。",
    "預かったデータはその仕事だけに使い、終わったら30日以内に消します。",
  ];
  const own = "本番のデータは、御社のアカウントに置きます。";
  if (isOperator) {
    return {
      q: "同業の運送会社の代表に、うちの単価や元請を知られて大丈夫？",
      a: [
        ...common,
        "当方の会社と元請・荷主が重なる会社とは、取引しません（お話を進める前に、あらかじめ確認します）。",
        own,
      ].join(""),
    };
  }
  return { q: "うちの単価や元請の情報を預けて大丈夫？", a: [...common, own].join("") };
}

/**
 * よくある質問（画面と FAQPage の構造化データで同じ文を使う）。金額は site.config から組み立てる。
 * 製品が今できることだけを答える。判定・効果の約束・ほかの会社の名前は書かない（tests/site-product.test.ts）。
 */
export function landingFaq(isOperator: boolean = SITE.makerIsOperator): FaqItem[] {
  const trial = trialPlan();
  const featured = PLANS.find((p) => p.featured && p.monthlyYen > 0) ?? PLANS.find((p) => p.monthlyYen > 0);
  const profitPack = PLANS.find((p) => p.id === "profit");
  /** 比べる相手：1 人あたり月 1,000 円前後のサービス（公開情報をもとにした目安） */
  const perHead = 1_000;
  const priceExample = featured
    ? `月額はドライバーが増えても変わりません（例：月${compactYen(featured.monthlyYen)}は、1人1,000円前後のサービスならドライバー${Math.round(featured.monthlyYen / perHead)}人分です）。`
    : "月額はドライバーが増えても変わりません。";
  const trialText = trial
    ? `まず${compactYen(trial.initialYen)}のお試しで、御社の先月分の実際の数字で確かめてから決めてください。本契約になったら、お試しの費用は初期費用から全額差し引きます。`
    : "まずはデモと30分の相談で、御社のやり方に合うかを確かめてください。";
  const profitName = profitPack ? `「${profitPack.name}」` : "上のパック";

  return [
    {
      q: "高くないですか。初期費用のかからないサービスや、1人いくらのアプリで十分では？",
      a: `形が合っていて足りているなら、そちらをおすすめします。しめ日ラボが足すのは、元請の支払通知との突き合わせ、ドライバーの「確認しました」の記録、締め前の見張り番、1円まで確かめてからの切り替え、立ち上げまで当方が行うこと、データが御社のものであることです。${priceExample}${trialText}`,
    },
    {
      q: "データはどこに置かれますか？",
      a: "御社の Vercel（サーバー）と Postgres（データベース）に置きます。どちらも御社のアカウントで、費用も御社から各社へ直接お支払いいただきます。当方のサーバーは通りません。当方は立ち上げと保守のために、御社の許可を得た範囲で触れます。",
    },
    {
      q: "やめたら、データはどうなりますか？",
      a: "データは御社のサーバーに残ります。オーナーの方が、全データを書き出して持ち帰ることもできます。当方が続けられなくなったときの扱いも、契約書で決めておきます。",
    },
    {
      q: "Excelで回っているので、困っていません。",
      a: "回っているのは、作った方がいるからです。その方が休んだり辞めたりした月に締められるかが分かれ目です。製品は今のExcelをそのまま取り込み、並行運用で振込額を1人ずつ1円まで比べます。合うまで今のやり方を捨てる必要はありません。",
    },
    {
      q: "ドライバーにアプリを入れてもらう必要はありますか？",
      a: "要りません。明細のリンクをLINE・SMS・メールで送り、ドライバーはスマホで開くだけです。パスワードも要りません。「確認しました」を押すか、おかしな行から質問できます。押すことを強制はしません。",
    },
    {
      q: "インボイスの仕入明細書として使えますか？",
      a: "明細には、仕入明細書の記載事項（税率ごとの金額と消費税・登録番号など）を載せます。ドライバーの「確認しました」は、国税庁のインボイスQ&A（問86）が示す確認の方法に沿って、記録として残ります。仕入税額控除の扱いなど最終的な判断は、顧問の税理士さんにご確認ください。",
    },
    {
      q: "会計ソフトにつなげられますか？",
      a: `${profitName}では、明細の数字から会計ソフトに取り込む仕訳のCSV（弥生会計のインポート形式 ほか）を出します。勘定科目と税区分は、取り込む前に顧問の税理士さんと確かめてください。はじめての月は、数件だけで試すことをおすすめします。`,
    },
    {
      q: "元請の支払通知がPDFしかありません。",
      a: "今の製品は、CSVかExcelの支払通知を読み込みます。PDFは読み込めません。元請の画面にCSVやExcelのダウンロードが無いか、確かめてみてください。見つからないときは、お試しのときに一緒に形を確かめます。",
    },
    {
      q: "元請の支払が少なかったら、取り戻してもらえますか？",
      a: "製品がするのは、自社の記録と比べて、少ない可能性がある差を金額で見つけるところと、丁寧な問い合わせ文の下書きまでです。「未払いです」とは言いません。送るかどうか、どう話すかは御社が決めます。元請とのやりとりや回収を当方が行うことはありません。",
    },
    {
      q: "ドライバーが何人から使えますか？",
      a: "業務委託のドライバーが5人ほどから50人ほどの会社を想定しています。月額はドライバーの人数で変わりません。人数が少なくても、元請の支払通知を確かめたい、明細の問い合わせを減らしたいといったご相談は歓迎です。",
    },
    {
      q: "個人に頼んで、いなくなったらどうなりますか？",
      a: "製品もデータも御社のアカウントに置くので、当方がいなくなっても御社のサーバーで動き続け、全データを書き出せます。ソースの扱いなど、続けられなくなったときの引き継ぎの決まりは、契約書に書きます。",
    },
    {
      q: "ドライバーの口座や個人情報を渡すのが不安です。",
      a: "データは御社のサーバーにだけ置きます。ドライバーの明細のリンクは検索に出ず、口座は下3桁だけを出します。当方が作業で本番の個人情報をAIに入れることはしません。製品はいまの版では AI を使っていません（将来使う場合も、御社のオーナーが同意したときだけにします）。契約には個人情報の取り扱いの取り決めを付けます。お試しは、ドライバーの名前を番号に置きかえ、口座・住所の列を消したExcelで行えます。",
    },
    confidentialityFaq(isOperator),
    {
      q: "補助金は使えますか？",
      a: "補助金は使えない前提で考えてください。当方は補助金の申請のお手伝いもしていません。その代わり、お試しの費用は本契約で差し引いています。",
    },
    {
      q: "免税ドライバーの分は、負担が増えた分だけ報酬を見直せばよいのでは？",
      a: "一方的に報酬を変えると、フリーランス法や独占禁止法の問題になるおそれがあります。製品が出すのは会社の負担の額までで、報酬を下げる提案はしません。ドライバーと話し合う材料としてお使いください。最終的な判断は、税理士・弁護士にご確認ください。",
    },
    {
      q: "簡易課税の会社でも意味がありますか？",
      a: "免税ドライバーの分の負担（控除70%）が出るのは、原則課税の会社だけです。簡易課税や2割特例の会社には出ません。それでも、取り込み・支払明細とドライバーの確認・振込データ・元請の支払通知との突き合わせは同じように使えます。",
    },
    {
      q: "税金や法律の相談にも乗ってもらえますか？",
      a: "当方は、製品の立ち上げと保守をする立場です。税務や法律の判断はしません。見張り番も、記録から分かる事実と根拠を出すだけです。最終的な判断は、税理士・弁護士・社労士にご確認ください。",
    },
  ];
}

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <Section id="faq" title="よくある質問">
      <div className="no-print space-y-3">
        {items.map((f) => (
          <details key={f.q} className="group rounded-card border border-border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-3 font-bold leading-snug [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="text-muted-foreground">
                Q
              </span>
              <span className="flex-1">{f.q}</span>
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180"
                fill="none"
              >
                <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <p className="border-t border-border px-4 py-3 text-[15px] leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>
      {/* 印刷：たたんだ答えは紙に出ないので、開いた形で別に置く（画面では出さない） */}
      <dl className="hidden space-y-3 print:block">
        {items.map((f) => (
          <div key={f.q} className="break-inside-avoid">
            <dt className="font-bold">Q. {f.q}</dt>
            <dd className="mt-1">{f.a}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
