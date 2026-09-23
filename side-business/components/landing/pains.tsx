import { Section } from "./section";

const PAINS = [
  "月末のExcelが、特定の1人にしか分からない",
  "管理費・ロイヤリティ・リースの控除が複雑で、市販のサービスに合わない",
  "どの案件・どの元請で儲かっているのか、分からない",
  "フリーランス法の取引条件の明示書を、まだ出していない",
] as const;

export function Pains() {
  return (
    <Section id="nayami" title="こんなお悩みはありませんか">
      <ul className="grid gap-3 sm:grid-cols-2">
        {PAINS.map((p) => (
          <li key={p} className="flex items-start gap-3 rounded-card border border-border bg-card p-4">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-foreground text-xs font-bold leading-none"
            >
              ✓
            </span>
            <span className="font-bold leading-relaxed">{p}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 leading-relaxed">
        ひとつでも当てはまるなら、今のやり方を変えずに、毎月の締めを仕組みにできるかもしれません。まずはデモで、どんな画面かをご覧ください。
      </p>
    </Section>
  );
}
