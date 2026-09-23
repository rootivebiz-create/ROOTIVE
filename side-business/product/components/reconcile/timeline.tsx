/** 差の扱いの流れ（見つけた → 問い合わせた → 解決／了承）。日付と、取り戻せた額を並べる（サーバーでもブラウザでも使える） */
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Badge } from "~/components/page";
import { amountText, waitingDays, waitingTone, type ItemStatus } from "~/server/features/reconcile/labels";

export type TimelineItem = {
  status: ItemStatus;
  diff: number;
  createdAt: Date | null;
  askedAt: Date | null;
  resolvedAt: Date | null;
  recoveredAmount: number | null;
};

const dateText = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });

function Step({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-0.5">
      <span aria-hidden className={cx("mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border", done ? "border-foreground bg-foreground" : "border-border bg-card")} />
      <span className="min-w-0 flex-1">
        <span className={cx("font-bold", !done && "text-muted-foreground")}>{title}</span>
        <span className="ml-2 break-words text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

export function StatusTimeline({ item, now = new Date() }: { item: TimelineItem; now?: Date }) {
  const waiting = waitingDays(item.status, item.askedAt, now);
  const settled = item.status === "resolved" || item.status === "accepted";
  const askedDone = item.status === "asked" || (settled && item.askedAt !== null);
  return (
    <ol className="mt-2 rounded-md bg-muted px-3 py-2 text-sm" aria-label="扱いの流れ">
      <Step done title="見つけた">
        {item.createdAt ? dateText(item.createdAt) : "今の記録で計算した差（保存すると日付が残ります）"}
      </Step>
      <Step done={askedDone} title="問い合わせた">
        {item.askedAt && item.status === "open" ? (
          // 突き合わせ直して金額が変わり、未対応に戻った差（前に問い合わせた日だけ見せる）
          `前に ${dateText(item.askedAt)} に問い合わせました（金額が変わったため、未対応に戻っています）`
        ) : item.askedAt ? (
          <>
            {dateText(item.askedAt)}
            {waiting !== null && (
              <span className="ml-2 inline-block align-middle">
                <Badge tone={waitingTone(waiting)}>返事待ち {waiting}日</Badge>
              </span>
            )}
          </>
        ) : item.status === "asked" ? (
          "日付の記録がありません"
        ) : settled ? (
          "問い合わせの記録はありません"
        ) : (
          "まだ"
        )}
      </Step>
      <Step done={settled} title={item.status === "accepted" ? "この金額で了承" : "解決"}>
        {settled ? (
          <>
            {item.resolvedAt ? dateText(item.resolvedAt) : "日付の記録がありません"}
            {item.status === "resolved" && item.recoveredAmount !== null && <span className="ml-2 font-bold text-success">取り戻せた額 {amountText(item.recoveredAmount)}</span>}
          </>
        ) : (
          "まだ"
        )}
      </Step>
    </ol>
  );
}
