import { compactYen } from "@/lib/format";
import { buildWeeksText, trialPlan } from "@/lib/plans";
import { NextStep } from "./primary-cta";
import { Section } from "./section";

type Step = { title: string; time?: string; body: string };

/**
 * 導入の流れ：お試し（先月分）→ 立ち上げ（最初の午後で並行運用レポート）→ 1〜2か月の並行運用 → 本番。
 * 費用と期間は PLANS から組み立てる（ここに金額を書かない）。
 */
export function flowSteps(): Step[] {
  const trial = trialPlan();
  const buildTime = buildWeeksText(true);
  return [
    ...(trial
      ? [
          {
            title: "お試し（先月分）",
            time: `${trial.weeks}・${compactYen(trial.initialYen)}`,
            body: "先月分の Excel（名前は番号に置きかえ、口座・住所の列は消して）で明細を計算し、今の振込額と 1 円単位で比べたレポートをお渡しします。元請の支払通知（CSV・Excel）があれば突き合わせ、見張り番の指摘も添えます。本契約になったら、この費用は初期費用から全額差し引きます。",
          },
        ]
      : []),
    {
      title: "立ち上げ",
      time: buildTime ? `最初の午後から・${buildTime}` : "最初の午後から",
      body: "製品を御社の Vercel と Postgres に置きます（当方が行います）。最初の午後に一緒に画面を見ながら、先月の Excel を取り込み、並行運用レポートまで作ります。そのあと、元請ごとのファイルの形・控除のルール・取引条件の明示書などを仕上げます。",
    },
    {
      title: "並行運用",
      time: "1〜2か月",
      body: "今の Excel の作業はそのまま。同じ月を製品でも締め、振込額を 1 人ずつ 1 円まで比べます。差が出たら理由を確かめ、ルールを直します。",
    },
    {
      title: "本番",
      body: "全員が一致するか、差の理由が説明できる月が続いたら切り替えます（目安は2か月）。製品の直しと、制度が変わったときの手直しは月額に入っています。",
    },
  ];
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];

export function Flow() {
  const list = flowSteps();
  return (
    <Section id="nagare" title="導入の流れ">
      <ol className="relative space-y-3 lg:grid lg:grid-cols-4 lg:gap-3 lg:space-y-0">
        {list.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-card border border-border bg-card p-4 lg:flex-col">
            <span aria-hidden className="text-2xl font-bold leading-none">
              {CIRCLED[i] ?? i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="font-bold leading-snug">
                <span className="sr-only">{i + 1}. </span>
                {s.title}
              </h3>
              {s.time && <p className="num text-sm text-muted-foreground">{s.time}</p>}
              <p className="mt-1 text-sm leading-relaxed">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <NextStep>
        まずは30分の無料相談から。今の締め方をうかがい、お試しで何が分かるかをお伝えします。決めるのは、それを見てからで大丈夫です。
      </NextStep>
    </Section>
  );
}
