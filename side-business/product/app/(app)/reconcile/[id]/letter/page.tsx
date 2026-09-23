import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { EmptyState, PageHeader } from "~/components/page";
import { LetterComposer } from "~/components/reconcile/letter-composer";
import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadLetterSource, type LetterSource } from "~/server/features/reconcile";
import { periodText } from "~/server/features/reconcile/period";
import { monthLabelJa } from "~/server/month";

export const metadata: Metadata = { title: "問い合わせ文" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 元請のご担当者へ送る「確認のお願い」の文面を作る（コピー・メールソフト・PDF） */
export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("viewer");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await getDb();
  let source: LetterSource;
  try {
    source = await loadLetterSource(db, user.tenantId, id);
  } catch (error) {
    if (error instanceof UserError) notFound();
    throw error;
  }
  const { view, items, clientName } = source;
  const { notice } = view;
  const staff = roleAtLeast(user.role, "staff");

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
      {view.period.differs && view.period.fallback && (
        <Card className="mb-4 border-warning/40">
          <p className="text-sm font-bold">締め日が違うため月単位で比べています</p>
          <p className="mt-1 text-sm">
            お支払通知は {periodText(view.period.clientPeriod)} の分ですが、当社の数字は {periodText(view.period)} の稼働です。期間の違いで差が出ていないか、送る前に確かめてください。
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
          period={source.period}
          canEdit={staff && !view.stale}
          canPdf={staff}
        />
      )}
    </div>
  );
}
