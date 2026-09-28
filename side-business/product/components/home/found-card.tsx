import Link from "next/link";
import { Card, Money } from "@/components/ui";
import { jpMonth } from "@/lib/format";
import type { HomeStatus } from "~/server/features/home/types";
import { monthLabelJa, monthParam } from "~/server/month";

/** +13,660円 ／ −2,000円 */
function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toLocaleString("ja-JP")}円`;
}

/**
 * 見つけたお金（元請の支払通知との突合）と、免税の方への支払で会社がかぶる消費税。
 * 確定と見込みは別の数として並べ、足し合わせない。消費税の負担は「見つけたお金」とは別の行にする（盛らない）。
 */
export function FoundCard({ st }: { st: HomeStatus }) {
  const m = monthParam(st.month);
  const r = st.reconcile;
  const f = st.found;
  const b = st.burden;
  // 確定した額は、支払通知の行が読めないあいだも消さない（突合の画面と同じ）
  return (
    <Card className={f.estimated > 0 ? "border-danger/50" : undefined}>
      <h3 className="text-sm font-bold text-muted-foreground">見つけたお金（{monthLabelJa(st.month)}分・元請との突合）</h3>
      {r.error ? (
        <p className="mt-1 text-sm">{r.error}</p>
      ) : r.notices === 0 ? (
        <p className="mt-1 text-sm">この月の元請の支払通知は、まだありません。届いたら置くだけで、請求との差を探します。</p>
      ) : r.unread === r.notices && f.confirmedCount === 0 ? (
        <p className="mt-1 text-sm">支払通知 {r.notices} 件の行を、まだ読み取れていません。突合の画面で列を選ぶと、当社の記録との差が分かります。</p>
      ) : r.items === 0 && f.confirmedCount === 0 ? (
        <p className="mt-1 text-sm">支払通知 {r.notices - r.unread} 件と当社の記録（数量 × 受注単価）を比べて、差は見つかりませんでした。</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <dl className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt>
                <span className="font-bold">確定</span>
                <span className="ml-1 text-xs text-muted-foreground">取り戻せた額（{f.confirmedCount} 件）</span>
              </dt>
              <dd className="text-lg font-bold">
                {f.confirmedCount > 0 ? <Money value={f.confirmed} /> : <span className="text-sm font-normal text-muted-foreground">まだありません</span>}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt>
                <span className="font-bold">見込み</span>
                <span className="ml-1 text-xs text-muted-foreground">支払通知が当社の記録より少ない、まだ片付いていない差（{f.estimatedCount} 件）</span>
              </dt>
              <dd className="text-lg font-bold">
                {f.estimatedCount > 0 ? <Money value={f.estimated} /> : <span className="text-sm font-normal text-muted-foreground">ありません</span>}
              </dd>
            </div>
          </dl>
          {r.over > 0 && (
            <p className="text-xs text-muted-foreground">
              ほかに、支払通知が当社の記録より多い差が <Money value={r.over} /> あります（見つけたお金には入れていません）。
            </p>
          )}
          <p className="text-xs text-muted-foreground">確定と見込みは別の数です。足し合わせていません。見込みは、元請に確かめるまで決まったお金ではありません。</p>
        </div>
      )}
      {!r.error && r.unread > 0 && !(r.unread === r.notices && f.confirmedCount === 0) && (
        <p className="mt-1 text-xs text-warning">行を読み取れていない支払通知が {r.unread} 件あります（上の額に入っていません）。突合の画面で列を選び直してください。</p>
      )}
      <Link href={`/reconcile?m=${m}`} className="mt-1 inline-flex min-h-11 items-center text-sm">
        突合を開く →
      </Link>

      {b.affected && b.people > 0 && (
        <div className="mt-2 border-t border-border pt-3 text-sm">
          <p className="font-bold">免税の方への支払で、会社がかぶる消費税</p>
          <p className="mt-1">
            インボイスの登録が無い方 {b.people}人への支払で、この月 <Money value={b.current} className="font-bold" />
          </p>
          {b.next && (
            <p className="mt-1">
              {jpMonth(b.next.from)}からは 月 <Money value={b.next.monthly} className="font-bold" />（今の段階より {signed(b.next.diffMonthly)}）の目安です。
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">同じ稼働が続いた場合の目安です（インボイスの経過措置で、控除できる割合が段階的に下がります）。見つけたお金とは別の数です。</p>
          <Link href={`/profit?m=${m}#burden-heading`} className="inline-flex min-h-11 items-center text-sm">
            段階ごとの目安を見る →
          </Link>
        </div>
      )}
    </Card>
  );
}
