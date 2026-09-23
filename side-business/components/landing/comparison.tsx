import { SITE } from "@/site.config";
import { buildPlans, trialPlan } from "./pricing";
import { Section, compactYen, cx, rangeYen } from "./section";

const CRITERIA = [
  { key: "fit", label: "形に合わせる必要" },
  { key: "monthly", label: "月額の決まり方" },
  { key: "data", label: "データの持ち主" },
  { key: "initial", label: "初期費用の目安" },
] as const;

type Key = (typeof CRITERIA)[number]["key"];
type Choice = { name: string; ours?: boolean; values: Record<Key, string> };

function choices(): Choice[] {
  const packs = buildPlans();
  const trial = trialPlan();
  const monthly = packs.map((p) => p.monthlyYen);
  const initial = packs.map((p) => p.initialYen);
  return [
    {
      name: "1人あたり課金のアプリ",
      values: {
        fit: "あり。決まった画面と計算の形に合わせる",
        monthly: "ドライバー1人ごと（1人月1,000円前後）。人が増えると上がる",
        data: "サービス会社のサーバー。やめるときの持ち出しは各社の条件しだい",
        initial: "0円のことが多い",
      },
    },
    {
      name: "運送業向けのクラウドサービス",
      values: {
        fit: "あり。設定できる範囲で合わせる",
        monthly: "プランごと（月1万〜5万円前後）。機能や利用者の数で変わる",
        data: "サービス会社のサーバー。やめるときの持ち出しは各社の条件しだい",
        initial: "0円〜10万円前後",
      },
    },
    {
      name: "kintone・受託開発",
      values: {
        fit: "なし。自由に作れる",
        monthly: "kintoneは利用者ごとのライセンス（月1.8万円前後から）。保守を外に頼むと別に費用",
        data: "kintoneはサービス会社のクラウド。受託開発は契約しだい",
        initial: "100万〜300万円以上",
      },
    },
    {
      name: SITE.name,
      ours: true,
      values: {
        fit: "なし。今のExcelのルールに合わせて作る",
        monthly: `定額（月${rangeYen(Math.min(...monthly), Math.max(...monthly))}）。ドライバーは何人でも同じ。サーバー代は御社が直接`,
        data: "御社のアカウントに置く。データもソースも御社のもの",
        initial: `${rangeYen(Math.min(...initial), Math.max(...initial))}${trial ? `（お試し${compactYen(trial.initialYen)}は本契約で差し引き）` : ""}`,
      },
    },
  ];
}

export function Comparison() {
  const list = choices();
  return (
    <Section
      id="hikaku"
      title="ほかの選び方との比較"
      lead={
        <p>
          形が合うなら、既製品が一番安いのでおすすめします。合わないのは、控除が複雑な会社や、元請ごとに締めや形が違う会社です。
        </p>
      }
    >
      {/* スマホ：選び方ごとのカード */}
      <ul className="grid gap-3 md:hidden">
        {list.map((c) => (
          <li
            key={c.name}
            className={cx("rounded-card bg-card p-4", c.ours ? "border-2 border-foreground" : "border border-border")}
          >
            <h3 className="font-bold">{c.name}</h3>
            <dl className="mt-2 space-y-2 text-sm">
              {CRITERIA.map((k) => (
                <div key={k.key}>
                  <dt className="text-xs font-bold text-muted-foreground">{k.label}</dt>
                  <dd className="leading-relaxed">{c.values[k.key]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* タブレット・PC：表 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">ほかの選び方と{SITE.name}の比較</caption>
          <thead>
            <tr>
              <td className="w-36 border-b border-border" />
              {list.map((c) => (
                <th
                  key={c.name}
                  scope="col"
                  className={cx(
                    "border-b border-border px-3 py-3 text-left align-bottom font-bold leading-snug",
                    c.ours && "rounded-t-lg bg-muted",
                  )}
                >
                  {c.name}
                  {c.ours && <span aria-hidden className="mt-1 block h-1 w-8 rounded-full bg-accent" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map((k) => (
              <tr key={k.key}>
                <th scope="row" className="border-b border-border py-3 pr-3 text-left align-top text-xs font-bold text-muted-foreground">
                  {k.label}
                </th>
                {list.map((c) => (
                  <td
                    key={c.name}
                    className={cx(
                      "border-b border-border px-3 py-3 align-top leading-relaxed",
                      c.ours && "bg-muted font-bold",
                    )}
                  >
                    {c.values[k.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        2026年9月時点の公開情報をもとにした目安。各社の最新の料金は各社のサイトでご確認ください。
      </p>
    </Section>
  );
}
