import Link from "next/link";
import { jpDate } from "@/lib/format";
import { Badge } from "~/components/page";
import { jstDateTimeText } from "~/server/features/settings/format";

export type DriverTermsLatest = { version: number; issuedOn: string; sentAt: Date | null; receivedAt: Date | null } | null;

/**
 * ドライバーの画面の「取引条件の明示書」：最新の版と明示した日、受け取りの記録、明示書の画面へのリンク。
 * （明示書は /terms/<ドライバー> で作る・送る。ここは入口だけ）
 */
export function DriverTermsPanel({ driverId, latest, termsIssuedOn }: { driverId: string; latest: DriverTermsLatest; termsIssuedOn: string | null }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      {latest ? (
        <>
          <p>
            取引条件の明示書：<span className="font-bold">第{latest.version}版</span>（{jpDate(latest.issuedOn)} に明示）
          </p>
          <div className="flex flex-wrap gap-1">
            {latest.receivedAt ? (
              <Badge tone="green">受け取りの記録あり（{jstDateTimeText(latest.receivedAt)}）</Badge>
            ) : latest.sentAt ? (
              <Badge tone="yellow">送りました・受け取りの記録はまだありません</Badge>
            ) : (
              <Badge tone="yellow">まだ送っていません</Badge>
            )}
          </div>
        </>
      ) : (
        <p>
          しめ日ラボで作った取引条件の明示書の記録はまだありません。
          {termsIssuedOn ? `（取引条件を明示した日として ${jpDate(termsIssuedOn)} が入っています）` : ""}
        </p>
      )}
      <Link href={`/terms/${driverId}`} className="inline-flex min-h-11 items-center font-bold">
        取引条件の明示書を作る・見る →
      </Link>
    </div>
  );
}
