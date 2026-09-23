import { PLANS } from "@/site.config";
import { trialPlan } from "./pricing";
import { Section, compactYen } from "./section";

export type FaqItem = { q: string; a: string };

/** よくある質問（画面と FAQPage の構造化データで同じ文を使う）。金額は site.config から組み立てる */
export function landingFaq(): FaqItem[] {
  const trial = trialPlan();
  const featured = PLANS.find((p) => p.featured && p.monthlyYen > 0) ?? PLANS.find((p) => p.monthlyYen > 0);
  /** 比べる相手：1 人あたり月 1,000 円前後のサービス（公開情報をもとにした目安） */
  const perHead = 1_000;
  const priceExample = featured
    ? `当方の月額は、ドライバーが増えても変わりません（例：月${compactYen(featured.monthlyYen)}は、1人1,000円前後のサービスならドライバー${Math.round(featured.monthlyYen / perHead)}人分です）。`
    : "当方の月額は、ドライバーが増えても変わりません。";
  const trialText = trial
    ? `まず${compactYen(trial.initialYen)}のお試しで、先月分の実際の支払額と合うかを確かめてから決めてください。本契約になったら、お試しの費用は初期費用から全額差し引きます。`
    : "まずはデモと30分の相談で、御社のやり方に合うかを確かめてください。";

  return [
    {
      q: "高くないですか。月1万円前後のサービスや、1人いくらのアプリで十分では？",
      a: `形が合うなら、そちらが一番安いのでおすすめします。合わないのは、控除が複雑な会社や、元請ごとに締めが違う会社です。${priceExample}${trialText}`,
    },
    {
      q: "Excelで回っているので、困っていません。",
      a: "回っているのは、作った方がいるからです。その方が休んだり辞めたりした月に締められるかが分かれ目です。今のExcelをそのまま取り込み、同じ結果になるかを1か月並行して確かめるので、今のやり方を捨てる必要はありません。",
    },
    {
      q: "個人に頼んで、いなくなったらどうなりますか？",
      a: "システムもデータも御社のアカウントに置き、ソースと引き継ぎの資料をお渡しします。当方が保守をやめても、別の会社が引き継げる形にしておきます。このことは契約書にも書きます。",
    },
    {
      q: "うちのドライバーに使いこなせますか？",
      a: "ドライバーは、支払明細を受け取って確かめるだけです。記録のオプションを付けた場合も、入力はスマホで行います。最初の設定は当方が御社のデータで行い、小さな変更は月額の保守の範囲で対応します。",
    },
    {
      q: "補助金は使えますか？",
      a: "御社のためにゼロから作るものなので、デジタル化・AI導入補助金は原則として使えない前提で考えてください。その代わり、初期費用を低めにし、お試しの費用は本契約で差し引いています。",
    },
    {
      q: "ドライバーの口座や個人情報を渡すのが不安です。",
      a: "データは御社のアカウントにだけ置きます。構築と保守では必要な範囲で触れますが、本番の個人情報をAIに入れることはしません。契約には個人情報の取り扱いの取り決めを付けます。無料の診断やお試しは、ドライバーの名前を番号に置きかえたExcelで行えます。",
    },
    {
      q: "免税ドライバーの分は、負担が増えた分だけ報酬を見直せばよいのでは？",
      a: "一方的に報酬を変えると、フリーランス法や独占禁止法の問題になるおそれがあります。まず会社の負担を正しく計算し、それをもとにドライバーと話し合う材料にしてください。当方がお手伝いするのは計算と明細づくりまでです。最終的な判断は、税理士・弁護士にご確認ください。",
    },
    {
      q: "簡易課税の会社でも意味がありますか？",
      a: "免税ドライバーの分の負担（控除70%）が出るのは、原則課税の会社だけです。簡易課税や2割特例の会社には出ません。それでも、支払明細・振込データ・案件別の利益の集計は同じように役に立ちます。",
    },
    {
      q: "税金や法律の相談にも乗ってもらえますか？",
      a: "当方は、計算と書類づくりの仕組みを作る立場です。税務や法律の判断はしません。最終的な判断は、税理士・弁護士・社労士にご確認ください。",
    },
    {
      q: "忙しくて時間がありません。",
      a: "相談は30分のオンライン1回だけです。あとは資料と録画で確かめられます。今のExcelの取り込みも当方が行います。",
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
