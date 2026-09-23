import { COMPARISON_CRITERIA, COMPARISON_NOTE, comparisonChoices } from "@/components/kit/content";
import { cx } from "@/lib/cx";
import { SITE } from "@/site.config";
import { NextStep } from "./primary-cta";
import { Section } from "./section";

export function Comparison() {
  const list = comparisonChoices();
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
              {COMPARISON_CRITERIA.map((k) => (
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
              <th scope="col" className="w-36 border-b border-border">
                <span className="sr-only">比べる点</span>
              </th>
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
            {COMPARISON_CRITERIA.map((k) => (
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
        {COMPARISON_NOTE}
      </p>
      <NextStep>どれが合うか迷ったら、相談で正直にお答えします。既製品で足りるなら、そうお伝えします。</NextStep>
    </Section>
  );
}
