import Link from "next/link";
import { Card, Money } from "@/components/ui";
import { FoundCard } from "~/components/home/found-card";
import type { HomeStatus } from "~/server/features/home/types";
import { jstShort } from "~/server/features/home/steps";
import { monthLabelJa, monthParam } from "~/server/month";

/** 「遠藤 大輔さん・木村 誠さん ほか 2人」 */
function namesText(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `${n}さん`).join("・");
  return names.length > 3 ? `${shown} ほか ${names.length - 3}人` : shown;
}

/**
 * 横のカード：見つけたお金（突合）と会社がかぶる消費税・その月の会社の利益・取引条件の明示・ドライバーからの質問・本番に切り替えた月。
 * どれも loadHomeStatus で読んだものだけを使う（ここで読み足さない）。
 */
export function SideCards({ st, otherQuestions, canEdit = false }: { st: HomeStatus; otherQuestions: number; canEdit?: boolean }) {
  const m = monthParam(st.month);
  const q = st.questions;
  const t = st.terms;
  const allQuestions = q.count + otherQuestions;
  return (
    <div className="space-y-3">
      <FoundCard st={st} />

      <Card>
        <h3 className="text-sm font-bold text-muted-foreground">{monthLabelJa(st.month)}分の会社の利益</h3>
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

      <Card className={t.missing.length > 0 ? "border-warning/60" : undefined}>
        <h3 className="text-sm font-bold text-muted-foreground">取引条件の明示</h3>
        {t.worked === 0 ? (
          <p className="mt-1 text-sm">この月の稼働はまだありません。稼働が入ると、稼働した人に取引条件の記録があるかを確かめます。</p>
        ) : t.missing.length === 0 ? (
          <p className="mt-1 text-sm">この月に稼働した {t.worked}人は、全員に取引条件を明示した記録（明示書か、明示した日）があります。</p>
        ) : (
          <>
            <p className="mt-1 text-sm font-bold">
              この月に稼働した {t.worked}人のうち {t.missing.length}人は、取引条件を明示した記録が見つかりません
            </p>
            <p className="mt-1 text-sm">{namesText(t.missing.map((x) => x.name))}</p>
            {canEdit && (
              <ul className="mt-1 space-y-1 text-sm">
                {t.missing.slice(0, 3).map((x) => (
                  <li key={x.driverId}>
                    <Link href={`/terms/${x.driverId}`} className="inline-flex min-h-11 items-center">
                      {x.name}さんの明示書を作る →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              仕事を頼むときは、仕事の内容・報酬の額・支払期日などを書面やメールで明示することになっています（フリーランス法 第3条。
              <a href="https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html" target="_blank" rel="noopener noreferrer">
                公正取引委員会 Q&amp;A
              </a>
              ）。紙で渡している場合は、渡した日を記録してください。
            </p>
          </>
        )}
        <Link href="/terms" className="mt-1 inline-flex min-h-11 items-center text-sm">
          取引条件の明示を開く →
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
        {otherQuestions > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {q.count > 0 ? "ほかの月の明細にも" : "ほかの月の明細に"}、まだ解決していない質問が {otherQuestions} 件あります。
          </p>
        )}
        {allQuestions > 0 ? (
          <Link href="/statements/inbox" className="mt-1 inline-flex min-h-11 items-center text-sm font-bold">
            質問の一覧を開く（全部の月で {allQuestions} 件）→
          </Link>
        ) : (
          <Link href={`/statements?m=${m}&f=question`} className="mt-1 inline-flex min-h-11 items-center text-sm">
            質問のある明細を見る →
          </Link>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-bold text-muted-foreground">本番に切り替えた月</h3>
        {st.golive ? (
          <p className="mt-1 text-sm">
            <span className="font-bold">{monthLabelJa(st.golive)}分</span>から、Excel をやめて、しめ日ラボで締めています。
          </p>
        ) : (
          <p className="mt-1 text-sm">まだです。今の Excel と並べて締め、全員が一致するか、差の理由を説明できたら切り替えます。</p>
        )}
        <Link href={`/parallel?m=${m}`} className="mt-1 inline-flex min-h-11 items-center text-sm">
          Excel と比べる →
        </Link>
      </Card>
    </div>
  );
}
