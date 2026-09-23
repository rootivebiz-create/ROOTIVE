import Link from "next/link";
import { Badge } from "~/components/page";
import { ReplyForm, ResolveForm } from "~/components/statements/thread-panel";
import type { InboxItem } from "~/server/features/statements/inbox";

/**
 * 質問の一覧の 1 件ずつ（明細 × 行ごと）。事務・オーナーは、ここから返事と「解決」ができる。
 * 見るだけの人には、明細を開くリンクだけを出す。
 */
export function InboxList({ items, canEdit }: { items: InboxItem[]; canEdit: boolean }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={`${i.statementId}-${i.lineKey ?? "all"}`} className="rounded-card border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold">
                {i.driverName}
                {i.driverCode && <span className="ml-2 text-xs font-normal text-muted-foreground">{i.driverCode}</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {i.monthLabel}分・{i.lineLabel}について
              </p>
            </div>
            <span className="inline-flex flex-wrap gap-1">
              {i.unread > 0 && <Badge tone="yellow">未読 {i.unread}</Badge>}
              {i.replied ? <Badge tone="gray">返事済み・解決待ち</Badge> : <Badge tone="red">まだ返事していません</Badge>}
              {i.open > 1 && <Badge tone="gray">この行の質問 {i.open}件</Badge>}
            </span>
          </div>
          <blockquote className="mt-2 break-words rounded-lg bg-muted p-2 text-sm">{i.excerpt}</blockquote>
          <p className="mt-1 text-xs text-muted-foreground">
            {i.ageText}（{i.askedAtText}）{i.open > 1 ? `・いちばん古い質問は ${i.waitingText}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={i.href} className="inline-flex min-h-11 items-center font-bold">
              明細のやりとりを開く →
            </Link>
          </div>
          {canEdit && (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              <details className="text-sm">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold">ここで返事を書く</summary>
                <div className="mt-2">
                  <ReplyForm statementId={i.statementId} lineKey={i.lineKey} placeholder="返事を書く（ドライバーは明細のリンクで読めます。書いたら LINE などで知らせてください）" />
                </div>
              </details>
              <ResolveForm statementId={i.statementId} lineKey={i.lineKey} resolved={false} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
