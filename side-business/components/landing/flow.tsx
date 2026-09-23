import { compactYen } from "@/lib/format";
import { buildWeeksText, trialPlan } from "@/lib/plans";
import { NextStep } from "./primary-cta";
import { Section } from "./section";

type Step = { title: string; time?: string; body: string };

function steps(): Step[] {
  const trial = trialPlan();
  const buildTime = buildWeeksText();
  return [
    {
      title: "無料の相談・診断",
      time: "30分・無料",
      body: "オンラインで、今の締め方をうかがいます。無料診断は、相談のときにお伝えする方法（メールへの添付など）で、名前を番号に置きかえ、口座・住所の列を消したExcelをお送りください。記載の足りないところ・支払期日・免税の方の分の負担を1枚にまとめてお返しします（計算の確認で、税務の判断ではありません）。",
    },
    ...(trial
      ? [
          {
            title: "お試し",
            time: `${trial.weeks.replace(/^約/, "")}・${compactYen(trial.initialYen)}`,
            body: "先月分のExcelで計算し、実際の支払額と突き合わせます。本契約になったら、この費用は初期費用から全額差し引きます。",
          },
        ]
      : []),
    {
      title: "構築",
      time: buildTime,
      body: "今のExcelのルールで、御社のアカウントに作ります。ドライバー・案件・元請の台帳は今のExcelから取り込みます。",
    },
    {
      title: "1か月の並行運用",
      time: "1か月",
      body: "今のExcelと両方で締めて、差がないかを確かめます。差が出たら、理由を調べて直します。",
    },
    {
      title: "本番",
      body: "毎月の締めに使います。不具合の修正や制度の変更への対応は、月額の保守に入っています。",
    },
  ];
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];

export function Flow() {
  const list = steps();
  return (
    <Section id="nagare" title="導入の流れ">
      <ol className="relative space-y-3 lg:grid lg:grid-cols-5 lg:gap-3 lg:space-y-0">
        {list.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-card border border-border bg-card p-4 lg:flex-col">
            <span aria-hidden className="text-2xl font-bold leading-none">
              {CIRCLED[i] ?? i + 1}
            </span>
            <div>
              <h3 className="font-bold leading-snug">{s.title}</h3>
              {s.time && <p className="num text-sm text-muted-foreground">{s.time}</p>}
              <p className="mt-1 text-sm leading-relaxed">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <NextStep>まずは①の無料相談から。相談のあと、次の一歩を1つだけご提案します。決めるのは、それを見てからで大丈夫です。</NextStep>
    </Section>
  );
}
