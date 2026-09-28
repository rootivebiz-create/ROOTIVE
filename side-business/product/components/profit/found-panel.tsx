import Link from "next/link";
import { Card, Money } from "@/components/ui";
import type { MonthFound } from "~/server/features/profit";

/**
 * 見つけたお金（元請の支払通知との突合）。確定と見込みを別の行に出し、足し合わせない。
 * 見込みは「支払通知が当社の記録より少ない」事実の額で、未払いと決めつけない。
 */
export function FoundPanel({ found, m }: { found: MonthFound; m: string }) {
  return (
    <Card className="space-y-2">
      <h2 id="found-heading" className="text-lg font-bold">
        見つけたお金（元請の支払通知との突合）
      </h2>
      {found.error ? (
        <p className="text-sm">{found.error}</p>
      ) : found.notices === 0 ? (
        <p className="text-sm">この月の元請の支払通知は、まだ取り込んでいません。届いたら突合の画面に置くだけで、当社の記録との差を探します。</p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-sm font-bold">確定（取り戻せた額）</dt>
              <dd className="mt-1 text-xl font-bold">{found.confirmedCount > 0 ? <Money value={found.confirmed} /> : <span className="text-base text-muted-foreground">まだありません</span>}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">突合で「解決」にして、取り戻せた額を入れた差（{found.confirmedCount} 件）</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-sm font-bold">見込み（まだ片付いていない差）</dt>
              <dd className="mt-1 text-xl font-bold">{found.estimatedCount > 0 ? <Money value={found.estimated} /> : <span className="text-base text-muted-foreground">ありません</span>}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">支払通知が当社の記録より少ない、未対応・問い合わせ済みの差（{found.estimatedCount} 件）</dd>
            </div>
          </dl>
          {(found.unread ?? 0) > 0 && (
            <p className="text-sm text-warning">
              行を読み取れていない支払通知が {found.unread} 件あります。この通知は比べられていないので、上の額に入っていません。突合の画面で列を選び直してください。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            確定と見込みは別の数です（足し合わせていません）。見込みは元請に確かめるまで決まったお金ではなく、上の「会社の利益」にも入れていません。
          </p>
        </>
      )}
      <Link href={`/reconcile?m=${m}`} className="inline-flex min-h-11 items-center text-sm">
        元請との突合を開く →
      </Link>
    </Card>
  );
}
