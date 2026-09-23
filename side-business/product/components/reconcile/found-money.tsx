/**
 * 見つけたお金：確定（取り戻せた額）と見込み（受け取りが少ない可能性）を分けて並べる。
 * 2 つは足さない（盛らない）。見込みは「まだ決まったお金ではない」と必ず添える
 */
import { Card, Money, TableWrap } from "@/components/ui";
import { cx } from "@/lib/cx";
import type { FoundMoney } from "~/server/features/reconcile";
import { monthJa } from "~/server/features/reconcile/labels";

export function FoundMoneyCard({
  title,
  found,
  over,
  overCount,
  scope,
  className,
  showMonths = false,
}: {
  title: string;
  found: FoundMoney;
  /** 受け取りが多い可能性（参考。見つけたお金には入れない） */
  over: number;
  overCount: number;
  /** 何を突き合わせたか（例：2社のお支払通知） */
  scope: string;
  className?: string;
  /** 月ごとの内訳を出す（レポート） */
  showMonths?: boolean;
}) {
  const months = found.byMonth.filter((m) => m.confirmed !== 0 || m.estimated !== 0);
  return (
    <Card className={cx(found.estimated > 0 ? "border-danger/40" : "", className)}>
      <p className="font-bold">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{scope}と、当社の稼働の記録を突き合わせた結果です。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-success/40 bg-success/10 p-3">
          <p className="text-sm text-muted-foreground">取り戻せた額（確定）</p>
          <p className="mt-1 text-2xl font-bold">
            <Money value={found.confirmed} className={found.confirmed > 0 ? "text-success" : ""} />
          </p>
          <p className="text-xs text-muted-foreground">{found.confirmedCount}件。「解決」にして、入金された・次の支払に上乗せと決まった額を入れたもの</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm text-muted-foreground">受け取りが少ない可能性（見込み）</p>
          <p className="mt-1 text-2xl font-bold">
            <Money value={found.estimated} className={found.estimated > 0 ? "text-danger" : ""} />
          </p>
          <p className="text-xs text-muted-foreground">{found.estimatedCount}件。未対応・問い合わせ済みの差の合計で、まだ決まったお金ではありません</p>
        </div>
      </div>
      <p className="mt-2 text-xs font-bold">確定と見込みは、足し合わせていません。</p>
      {overCount > 0 && (
        <p className="mt-2 text-sm">
          受け取りが多い可能性：<Money value={over} />
          <span className="ml-1 text-xs text-muted-foreground">（{overCount}件。待機料など、お支払通知にだけある行を含む。見つけたお金には入れていません）</span>
        </p>
      )}
      {found.waitingLong > 0 && <p className="mt-1 text-sm text-warning">問い合わせてから 14日を過ぎても返事待ちの差が {found.waitingLong}件 あります。</p>}
      {showMonths && months.length > 1 && (
        <TableWrap>
          <table className="report-table mt-3 w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">月</th>
                <th className="py-1 pr-2 text-right font-normal">確定</th>
                <th className="py-1 text-right font-normal">見込み</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b border-border">
                  <td className="py-1 pr-2 whitespace-nowrap">{monthJa(m.month)}分</td>
                  <td className="py-1 pr-2 text-right">
                    <Money value={m.confirmed} />
                  </td>
                  <td className="py-1 text-right">
                    <Money value={m.estimated} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <p className="mt-2 text-xs text-muted-foreground">差は「記録の違い」です。払われていないと決まったものではありません。どちらが正しいかは、元請に確かめてください。</p>
    </Card>
  );
}
