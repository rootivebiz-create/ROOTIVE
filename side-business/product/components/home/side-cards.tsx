import Link from "next/link";
import { Card, Money } from "@/components/ui";
import type { HomeStatus } from "~/server/features/home/types";
import { jstShort } from "~/server/features/home/steps";
import { monthParam } from "~/server/month";

/** 横のカード：今月の会社の利益・元請との突合・ドライバーからの質問 */
export function SideCards({ st, otherQuestions }: { st: HomeStatus; otherQuestions: number }) {
  const m = monthParam(st.month);
  const r = st.reconcile;
  const q = st.questions;
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="text-sm font-bold text-muted-foreground">今月の会社の利益</h3>
        <p className="mt-1 text-2xl font-bold">
          <Money value={st.profit.profit} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          売上 <Money value={st.profit.sales} />・委託料 <Money value={st.profit.subtotal} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {st.profit.source === "snapshot" ? "締めた明細から出した額です。" : st.totals.drivers === 0 ? "稼働が入ると出ます。" : "今の稼働から出した見込みです（締めると決まります）。"}
        </p>
        <Link href={`/profit?m=${m}`} className="mt-1 inline-flex min-h-11 items-center text-sm">
          案件・元請ごとの利益 →
        </Link>
      </Card>

      <Card className={r.short > 0 ? "border-danger/50" : undefined}>
        <h3 className="text-sm font-bold text-muted-foreground">元請との突合</h3>
        {r.notices === 0 ? (
          <p className="mt-1 text-sm">この月の元請の支払通知は、まだありません。届いたら置くだけで、請求との差を探します。</p>
        ) : r.items === 0 ? (
          <p className="mt-1 text-sm">支払通知 {r.notices} 件。突き合わせると、請求との差が分かります。</p>
        ) : r.openItems === 0 ? (
          <p className="mt-1 text-sm">支払通知 {r.notices} 件。まだ解決していない差はありません。</p>
        ) : (
          <div className="mt-1 space-y-1 text-sm">
            <p>まだ解決していない差が {r.openItems} 件あります。</p>
            {r.short > 0 && (
              <p>
                請求より少ない：<Money value={-r.short} className="font-bold" />
              </p>
            )}
            {r.over > 0 && (
              <p>
                請求より多い：<Money value={r.over} />
              </p>
            )}
          </div>
        )}
        <Link href={`/reconcile?m=${m}`} className="mt-1 inline-flex min-h-11 items-center text-sm">
          突合を開く →
        </Link>
      </Card>

      <Card className={q.count > 0 ? "border-warning/60" : undefined}>
        <h3 className="text-sm font-bold text-muted-foreground">ドライバーからの質問</h3>
        {q.count === 0 ? (
          <p className="mt-1 text-sm">この月の明細への、まだ解決していない質問はありません。</p>
        ) : (
          <>
            <p className="mt-1 text-sm font-bold">まだ解決していない質問が {q.count} 件あります</p>
            <ul className="mt-2 space-y-2">
              {q.items.map((it, i) => (
                <li key={`${it.statementId}:${i}`}>
                  <Link href={`/statements/${it.statementId}`} className="block rounded-lg border border-border p-2 text-sm text-foreground no-underline hover:bg-muted">
                    <span className="flex flex-wrap justify-between gap-x-2">
                      <span className="font-bold">{it.driverName}さん</span>
                      <span className="num text-xs text-muted-foreground">{jstShort(it.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block break-words text-muted-foreground">{it.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {q.count > q.items.length && <p className="mt-1 text-xs text-muted-foreground">ほか {q.count - q.items.length} 件</p>}
          </>
        )}
        {otherQuestions > 0 && <p className="mt-2 text-xs text-muted-foreground">ほかの月の明細にも、まだ解決していない質問が {otherQuestions} 件あります。</p>}
        <Link href={`/statements?m=${m}&f=question`} className="mt-1 inline-flex min-h-11 items-center text-sm">
          質問のある明細を見る →
        </Link>
      </Card>
    </div>
  );
}
