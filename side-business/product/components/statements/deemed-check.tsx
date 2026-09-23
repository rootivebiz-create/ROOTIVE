import Link from "next/link";
import { jpDate } from "@/lib/format";
import type { StatementStatus } from "~/server/features/statements/status";

const NTA_QA_URL = "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/113-3.pdf";

type Terms = { version: number; issuedOn: string; deemedClause: boolean } | null;

function Mark({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
      {ok ? "✓" : "・"}
    </span>
  );
}

/**
 * 「みなし確認」の 3 つの条件を 1 つずつ見せる（会社の画面）。1 つでも欠けていれば未確認のまま。
 * ドライバーが今の版を確認していれば出さない。
 */
export function DeemedCheck({ status, terms, deemedDays, sentOn = null }: { status: StatementStatus; terms: Terms; deemedDays: number; sentOn?: string | null }) {
  if (status.key === "confirmed") return null;
  const c = status.deemedCheck;
  // 条項のある取引条件を、明細を送ったあとで渡している（送った時点で合意があったかは、記録を見て確かめてもらう）
  const clauseAfterSent = !!terms?.deemedClause && !!sentOn && c.sent && terms.issuedOn > sentOn;
  const daysText = !c.sent
    ? "今の中身をまだ送っていません"
    : c.daysPassed
      ? `送ってから ${c.daysSinceSent}日たちました（${deemedDays}日以上）`
      : `送ってから ${c.daysSinceSent ?? 0}日です（${deemedDays}日たつと満たします）`;
  const questionText = c.noQuestion
    ? "送ってから質問はありません"
    : status.openQuestions > 0
      ? `解決していない質問が ${status.openQuestions}件あります`
      : "送ったあとに質問がありました（解決済みでも、みなし確認にはしません。「確認しました」を押してもらうようお願いしてください）";
  const clauseText = terms
    ? terms.deemedClause
      ? `取引条件の記録（版 ${terms.version}・${jpDate(terms.issuedOn)}）に条項があります`
      : `取引条件の記録（版 ${terms.version}・${jpDate(terms.issuedOn)}）に、みなし確認の条項がありません`
    : "取引条件の記録がありません";

  const met = [c.sent && c.daysPassed, c.noQuestion, c.clause].filter(Boolean).length;
  // みなし確認になった・条項が無くて止まっているときは開いて見せ、それ以外はたたんでおく
  const important = status.key === "deemed" || status.deemedBlockedByClause;
  return (
    <details open={important} className="rounded-card border border-border bg-card p-4 text-sm" aria-label="みなし確認の条件">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
        <span className="font-bold">みなし確認の条件</span>
        <span className="text-muted-foreground">3 つのうち {met} つ</span>
      </summary>
      <p className="mt-1 text-muted-foreground">3 つがそろったときだけ「みなし確認」と表示します。1 つでも欠けていれば未確認のままです。</p>
      {status.deemedBlockedByClause && (
        <p role="status" className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 font-bold text-warning">
          取引条件にみなし確認の条項がありません（<Link href="/terms">/terms</Link> で入れられます）
        </p>
      )}
      <ul className="mt-2 space-y-2">
        <li className="flex items-start gap-2">
          <Mark ok={c.sent && c.daysPassed} />
          <span>{daysText}</span>
        </li>
        <li className="flex items-start gap-2">
          <Mark ok={c.noQuestion} />
          <span>{questionText}</span>
        </li>
        <li className="flex items-start gap-2">
          <Mark ok={c.clause} />
          <span>
            {clauseText}
            {!c.clause && (
              <>
                。<Link href="/terms">取引条件の明示</Link>で、条項を入れた版を作って渡せます
              </>
            )}
          </span>
        </li>
      </ul>
      {clauseAfterSent && terms && sentOn && (
        <p role="note" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          条項のある取引条件の記録（{jpDate(terms.issuedOn)}）は、この明細を送った日（{jpDate(sentOn)}）より後に渡したものです。送った時点で、連絡が無ければ確認とみなすことに合意があったか、前の取引条件の記録で確認をおすすめします。
        </p>
      )}
      {status.key === "deemed" && (
        <p className="mt-3">
          3 つがそろったため「みなし確認」と表示しています。明細の注記と取引条件に沿った状態の表示で、扱いは会社と税理士でお決めください。
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        国税庁のインボイス Q&A（問86）は、仕入明細書の内容について相手方の確認を受ける方法にふれています。了承の記録があるか、確認をおすすめします（
        <a href={NTA_QA_URL} target="_blank" rel="noopener noreferrer">
          国税庁 インボイス Q&A
        </a>
        ）。
      </p>
    </details>
  );
}
