import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/page";
import { InboxList } from "~/components/statements/inbox-list";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadQuestionInbox, parseInboxFilter } from "~/server/features/statements/inbox";

export const metadata = { title: "ドライバーからの質問" };

/** 質問の一覧：すべての月の、まだ解決していないドライバーからの質問（新しい順） */
export default async function QuestionInboxPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const filter = parseInboxFilter(sp.f);
  const db = await getDb();
  const inbox = await loadQuestionInbox(db, user.tenantId);
  const canEdit = roleAtLeast(user.role, "staff");
  const shown = filter === "unreplied" ? inbox.items.filter((i) => !i.replied) : inbox.items;
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm no-underline ${active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted"}`;

  return (
    <div>
      <PageHeader
        title="ドライバーからの質問"
        description="明細の行からドライバーが送った質問のうち、まだ解決にしていないものです（すべての月）。返事はドライバーの明細のリンクに出ます。答え終わったら「解決にする」を押してください。"
        actions={
          <Link href="/statements" className="inline-flex min-h-11 items-center text-sm">
            支払明細の一覧へ
          </Link>
        }
      />

      {inbox.items.length === 0 ? (
        <EmptyState title="解決していない質問はありません">
          ドライバーが明細の行から質問すると、ここに届きます。明細のリンクは「<Link href="/statements">支払明細</Link>」の画面から送れます。
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <p className="text-lg font-bold">
            解決していない質問 {inbox.total}件（{inbox.drivers}人）
            {inbox.unreplied > 0 && <span className="ml-2 text-base text-danger">まだ返事していない {inbox.unreplied}か所</span>}
          </p>
          <nav aria-label="絞り込み" className="flex flex-wrap gap-2">
            <Link href="/statements/inbox" aria-current={filter === "all" ? "page" : undefined} className={chip(filter === "all")}>
              すべて <span className="num font-bold">{inbox.items.length}</span>
            </Link>
            <Link href="/statements/inbox?f=unreplied" aria-current={filter === "unreplied" ? "page" : undefined} className={chip(filter === "unreplied")}>
              まだ返事していない <span className="num font-bold">{inbox.unreplied}</span>
            </Link>
          </nav>
          {!canEdit && <p className="text-sm text-muted-foreground">返事と「解決にする」は、事務・オーナーの方ができます。</p>}
          {shown.length === 0 ? (
            <EmptyState title="まだ返事していない質問はありません">
              <Link href="/statements/inbox">すべての質問を見る</Link>
            </EmptyState>
          ) : (
            <InboxList items={shown} canEdit={canEdit} />
          )}
        </div>
      )}
    </div>
  );
}
