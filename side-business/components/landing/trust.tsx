import { Section } from "./section";

const TRUST = [
  {
    title: "データとソースは御社のもの",
    body: "システムもデータも御社のアカウントに作ります。作ったもののソースもお渡しします。",
  },
  {
    title: "やめても困らない",
    body: "保守をやめるときは、引き継ぎの資料とソースをお渡しします。別の会社が引き継げる形にしておきます。",
  },
  {
    title: "保守の範囲を文書で決める",
    body: "月額に何が入り、何が別料金かを、始める前に書面で決めます。",
  },
  {
    title: "1か月は今のExcelと並べて動かす",
    body: "本番の前に、今のExcelと両方で締めて、差がないかを1行ずつ確かめます。",
  },
  {
    title: "本番の個人情報はAIに入れない",
    body: "AIは作る作業に使いますが、ドライバーの名前や口座などの本番のデータは入れません。個人情報の取り扱いは契約で取り決めます。",
  },
  {
    title: "お金には触れない",
    body: "作るのは振込データまでです。振込は、御社が金額を確かめてから行います。",
  },
] as const;

export function Trust() {
  return (
    <Section id="anshin" title="安心してお任せいただくために">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRUST.map((t, i) => (
          <li key={t.title} className="rounded-card border border-border bg-card p-4 sm:p-5">
            <p className="flex items-start gap-3">
              <span
                aria-hidden
                className="num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-plate text-sm font-bold text-plate-foreground"
              >
                {i + 1}
              </span>
              <span className="font-bold leading-snug">{t.title}</span>
            </p>
            <p className="mt-2 text-[15px] leading-relaxed">{t.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
