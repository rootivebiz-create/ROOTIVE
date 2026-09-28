import { Section } from "./section";

const TRUST = [
  {
    title: "データは御社のもの",
    body: "製品もデータも、御社の Vercel と Postgres に置きます。当方のサーバーは通りません。全データをいつでも書き出せます。",
  },
  {
    title: "1円まで確かめてから切り替え",
    body: "本番の前に、今のExcelと両方で締めて、振込額を1人ずつ比べます。合うか、差の理由が分かるまで切り替えません。",
  },
  {
    title: "判定しない",
    body: "見張り番も明細も、記録から分かる事実と根拠までです。適法かどうか・税務上どうなるかの判断は、税理士・弁護士にお任せします。",
  },
  {
    title: "お金には触れない",
    body: "作るのは振込データまでです。振込は、御社が金額を確かめてから行います。問い合わせ文も下書きまでです。",
  },
  {
    title: "AIに渡すものを限る",
    body: "当方が作業で本番のデータをAIに入れることはしません。製品はいまの版では AI を使っていません。将来、列の自動判定の補助として使う場合も、御社のオーナーが同意したときだけにします（口座や振込データは送りません）。",
  },
  {
    title: "保守の範囲を書面で決める",
    body: "月額に何が入り、何が別料金か、当方が続けられなくなったときの扱いを、始める前に書面で決めます。",
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
                className="num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-plate text-sm font-bold text-plate-foreground print:border print:border-black print:bg-white print:text-black"
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
