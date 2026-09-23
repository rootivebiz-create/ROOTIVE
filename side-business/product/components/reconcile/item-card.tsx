/** 見つかった差 1 件のカード（スマホでも読みやすいように、当社の記録とお支払通知を上下に並べる） */
import { Card } from "@/components/ui";
import { Badge } from "~/components/page";
import { DiffAmount, Pair } from "~/components/reconcile/bits";
import { ItemStatusForm } from "~/components/reconcile/forms";
import type { ItemView } from "~/server/features/reconcile";
import { amountText, formulaText, KIND_HELP, KIND_LABEL, qtyUnitText, STATUS_LABEL, STATUS_TONE, WAIT_ALERT_DAYS, waitingDays } from "~/server/features/reconcile/labels";

const dateText = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

function ourSide(it: ItemView): string {
  if (it.kind === "extra") return "対応する案件がありません";
  return formulaText(it.ourQty, it.ourPrice, it.ourAmount, it.unit);
}

function theirSide(it: ItemView): string {
  if (it.kind === "missing") return "行がありません";
  if (it.kind === "extra") return formulaText(it.theirQty, it.theirPrice, it.theirAmount, null);
  if (it.split && it.kind === "qty") return `${qtyUnitText(it.theirQty ?? 0, it.unit)} × 当社の単価 = ${amountText(it.theirAmount)}`;
  return formulaText(it.theirQty, it.theirPrice, it.theirAmount, it.unit);
}

export function ItemCard({ item, canEdit, now = new Date() }: { item: ItemView; canEdit: boolean; now?: Date }) {
  const waiting = waitingDays(item.status, item.askedAt, now);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={item.diff < 0 ? "red" : "yellow"}>{KIND_LABEL[item.kind]}</Badge>
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            {waiting !== null && waiting >= WAIT_ALERT_DAYS && <Badge tone="yellow">返事待ち {waiting}日</Badge>}
            {item.kind === "extra" && (item.confirmedExtra ? <Badge tone="gray">追加の料金</Badge> : <Badge tone="gray">未確認の行</Badge>)}
          </div>
          <p className="mt-2 break-words text-base font-bold">
            {item.label}
            {item.driverName && <span className="ml-1 text-sm font-normal text-muted-foreground">（{item.driverName}）</span>}
          </p>
        </div>
        <div className="text-right">
          <DiffAmount value={item.diff} className="text-xl" />
          <p className="text-xs text-muted-foreground">{item.diff < 0 ? "受け取りが少ない可能性" : "受け取りが多い可能性"}</p>
        </div>
      </div>
      <div className="mt-2 divide-y divide-border">
        <Pair label="当社の記録">{ourSide(item)}</Pair>
        <Pair label="お支払通知">{theirSide(item)}</Pair>
        {item.askedAt && item.status !== "open" && <Pair label="問い合わせた日">{dateText(item.askedAt)}{waiting !== null ? `（${waiting}日前）` : ""}</Pair>}
        {item.resolvedAt && !["open", "asked"].includes(item.status) && <Pair label={item.status === "accepted" ? "了承した日" : "解決した日"}>{dateText(item.resolvedAt)}</Pair>}
        {item.status === "resolved" && item.recoveredAmount !== null && <Pair label="取り戻せた額">{amountText(item.recoveredAmount)}</Pair>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {item.split
          ? item.kind === "qty"
            ? "数量と単価の両方が違うので、2 つに分けています。これは数量の差を当社の単価で計算したものです（単価の差と足すと、差の全体になります）。"
            : "数量と単価の両方が違うので、2 つに分けています。これは単価の差を、お支払通知の数量で計算したものです（数量の差と足すと、差の全体になります）。"
          : KIND_HELP[item.kind]}
        {item.mixedPrices && " お支払通知のこの案件には単価の違う行が混ざっているため、単価は平均です。"}
        {item.kind === "extra" && !item.confirmedExtra && item.current && " 下の「お支払通知の行」で、案件・追加の料金・対象外のどれかに決められます。"}
      </p>
      {!item.current && (
        <p className="mt-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
          今の突き合わせでは、この差は出ていません（記録がそろいました）。上の数字は、片付けたときの記録です。
          {item.status === "resolved" && item.recoveredAmount === null && item.diff < 0 && " 取り戻せた額がわかれば、下で入れてください。"}
        </p>
      )}
      {canEdit && item.id ? (
        <ItemStatusForm
          itemId={item.id}
          status={item.status}
          note={item.note}
          diff={item.diff}
          recoveredAmount={item.recoveredAmount}
          statuses={item.current ? undefined : ["resolved", "accepted"]}
        />
      ) : (
        item.note && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">メモ：{item.note}</p>
      )}
    </Card>
  );
}
