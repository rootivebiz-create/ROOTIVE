import { NextStep } from "./primary-cta";
import { PAINS } from "./product-content";
import { Section } from "./section";

export function Pains() {
  return (
    <Section id="nayami" title="こんなお悩みはありませんか">
      <ul className="grid gap-3 sm:grid-cols-2">
        {PAINS.map((p) => (
          <li key={p.title} className="flex items-start gap-3 rounded-card border border-border bg-card p-4">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-foreground text-xs font-bold leading-none"
            >
              ✓
            </span>
            <span className="min-w-0">
              <span className="block font-bold leading-relaxed [word-break:auto-phrase]">{p.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{p.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <NextStep alt={{ href: "/product", label: "先に製品の画面を見る" }}>
        ひとつでも当てはまるなら、今のやり方のまま製品に乗せられるかを、30分の相談でお答えします。
      </NextStep>
    </Section>
  );
}
