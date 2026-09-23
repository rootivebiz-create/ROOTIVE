import { NextStep } from "./primary-cta";
import { ENOUGH } from "./product-content";
import { CheckIcon, Section } from "./section";

/**
 * 「今お使いのツールで十分では？」への答え。ほかの会社の名前は出さず、比べて悪く言わない。
 * 足すものだけを並べ、足りているならそのまま使ってもらう。
 */
export function Enough() {
  return (
    <Section id="juubun" title={ENOUGH.title} lead={<p>{ENOUGH.lead}</p>}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ENOUGH.items.map((item) => (
          <li key={item.title} className="flex gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
            <CheckIcon className="mt-0.5" />
            <span className="min-w-0">
              <span className="block font-bold leading-snug [word-break:auto-phrase]">{item.title}</span>
              <span className="mt-1 block text-[15px] leading-relaxed">{item.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <NextStep alt={{ href: "/product", label: "製品の中身を見る" }}>
        今お使いのものと並べて、足りないところだけを正直にお伝えします。足りているなら、そうお伝えします。
      </NextStep>
    </Section>
  );
}
