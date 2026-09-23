import { jpDate } from "@/lib/format";
import { TERMS_TITLE, termsSections, type TermsDocument } from "~/server/features/terms/document";

/**
 * 明示書の中身（会社の画面・ドライバーのページで同じもの）。PDF と同じ termsSections() の並びと文だけを出す。
 * 報酬の表はスマホで横にはみ出さないよう、案件ごとの行（カード）にする。
 * large：ドライバー向けに文字を大きく
 */
export function TermsDocumentView({ doc, large = false }: { doc: TermsDocument; large?: boolean }) {
  const sections = termsSections(doc);
  const body = large ? "text-base" : "text-sm";
  return (
    <article className="space-y-4" aria-label={TERMS_TITLE}>
      <header className="rounded-card border border-border bg-card p-4">
        <h2 className={`${large ? "text-xl" : "text-lg"} font-bold`}>{TERMS_TITLE}</h2>
        <dl className={`mt-2 grid gap-x-4 gap-y-2 ${body} sm:grid-cols-2`}>
          <div>
            <dt className="text-muted-foreground">委託者（会社）</dt>
            <dd className="font-bold">{doc.company.name}</dd>
            {doc.company.registrationNo && <dd className="text-muted-foreground">登録番号 {doc.company.registrationNo}</dd>}
          </div>
          <div>
            <dt className="text-muted-foreground">受託者（ドライバー）</dt>
            <dd className="font-bold">
              {doc.driver.name} 様{doc.driver.code ? <span className="ml-2 font-normal text-muted-foreground">番号 {doc.driver.code}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">明示した日</dt>
            <dd>{jpDate(doc.issuedOn)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">版・目印</dt>
            <dd>
              版 {doc.version}・<span className="num break-all">{doc.hashShort}</span>
            </dd>
          </div>
        </dl>
      </header>

      <ol className="space-y-3">
        {sections.map((sec) => (
          <li key={sec.key} className="rounded-card border border-border bg-card p-4">
            <h3 className={`${large ? "text-lg" : "text-base"} font-bold`}>{sec.label}</h3>
            <div className={`mt-1 space-y-1 ${body}`}>
              {sec.paragraphs.map((p, i) => (
                <p key={i} className={`whitespace-pre-wrap break-words ${sec.emphasis ? "font-bold text-danger" : ""}`}>
                  {p}
                </p>
              ))}
            </div>
            {sec.table && (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {sec.table.rows.map((r, i) => (
                  <li key={i} className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 ${body}`}>
                    <span className="min-w-0 break-words">
                      <span className="font-bold">{r[0]}</span>
                      {r[1] && r[1] !== "—" && <span className="ml-2 text-xs text-muted-foreground">{r[1]}</span>}
                    </span>
                    <span className="num whitespace-nowrap font-bold">
                      {r[2]}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">{r[3]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}
