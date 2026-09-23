import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { EmptyState, PageHeader } from "~/components/page";
import { LetterComposer, type ComposerItem } from "~/components/reconcile/letter-composer";
import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadNoticeView } from "~/server/features/reconcile";
import { isUnsettled } from "~/server/features/reconcile/labels";
import { monthLabelJa } from "~/server/month";

export const metadata: Metadata = { title: "問い合わせ文" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 元請のご担当者へ送る「確認のお願い」の文面を作る */
export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("viewer");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await getDb();
  let view;
  try {
    view = await loadNoticeView(db, user.tenantId, id);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const { notice } = view;
  const clientName = view.client?.name ?? "元請";
  // 保存した結果が古いときも、文面は今の記録の数字で作る（「問い合わせ済み」にするのは突き合わせ直してから）
  const items: ComposerItem[] = view.display
    .filter((i) => isUnsettled(i.status) && i.diff !== 0)
    .map((i) => ({
      id: i.id ?? i.key,
      kind: i.kind,
      label: i.label,
      unit: i.unit,
      ourQty: i.ourQty,
      theirQty: i.theirQty,
      ourPrice: i.ourPrice,
      theirPrice: i.theirPrice,
      ourAmount: i.ourAmount,
      theirAmount: i.theirAmount,
      diff: i.diff,
      split: i.split,
      status: i.status,
    }));

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href={`/reconcile/${notice.id}`}>← 突合の結果（{clientName}・{monthLabelJa(notice.month)}分）</Link>
      </p>
      <PageHeader
        title="問い合わせ文を作る"
        description={`${clientName}のご担当者へ、数字の確認をお願いする文面です。当社の記録とお支払通知の数字を並べて、確かめてもらうお願いだけを書きます。`}
      />
      {view.stale && (
        <Card className="mb-4 border-warning/40">
          <p className="text-sm">
            下の文面は今の記録の数字で作っています。保存してある突き合わせの結果が古いため、「問い合わせ済み」にするには、先に<Link href={`/reconcile/${notice.id}`}>結果の画面</Link>で「今の記録で突き合わせ直す」を押してください。
          </p>
        </Card>
      )}
      {items.length === 0 ? (
        <EmptyState title="問い合わせる差はありません">
          未対応・問い合わせ済みの差がありません。<Link href={`/reconcile/${notice.id}`}>結果の画面</Link>に戻ってください。
        </EmptyState>
      ) : (
        <LetterComposer
          noticeId={notice.id}
          month={notice.month}
          clientName={clientName}
          companyName={view.tenantName}
          senderName={user.name}
          items={items}
          canEdit={roleAtLeast(user.role, "staff") && !view.stale}
        />
      )}
    </div>
  );
}
