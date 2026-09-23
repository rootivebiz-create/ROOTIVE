import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Card, Money } from "@/components/ui";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { DiffAmount, Section } from "~/components/reconcile/bits";
import { SampleButton, UploadForm } from "~/components/reconcile/forms";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { defaultReportParams, findSampleClient, listMonth, SAMPLE_NOTICE_MONTH, type MonthClientRow } from "~/server/features/reconcile";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata: Metadata = { title: "元請との突合" };

/** 元請との突合：その月の元請ごとに、お支払通知を上げたか・差がいくらあるかを並べる */
export default async function ReconcilePage({ searchParams }: { searchParams: Promise<{ m?: string; done?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const db = await getDb();
  const { rows, clients } = await listMonth(db, user.tenantId, month);
  const canEdit = roleAtLeast(user.role, "staff");
  const sample = canEdit ? await findSampleClient(db, user.tenantId) : null;
  const report = defaultReportParams(month);
  const withNotice = rows.filter((r) => r.notice);
  const short = withNotice.reduce((a, r) => a + (r.notice?.short ?? 0), 0);
  const shortCount = withNotice.reduce((a, r) => a + (r.notice?.shortCount ?? 0), 0);
  const over = withNotice.reduce((a, r) => a + (r.notice?.over ?? 0), 0);
  const overCount = withNotice.reduce((a, r) => a + (r.notice?.overCount ?? 0), 0);
  const recovered = withNotice.reduce((a, r) => a + (r.notice?.recovered ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="元請との突合"
        month={month}
        basePath="/reconcile"
        description="元請から届いたお支払通知と、当社の稼働の記録を突き合わせて、数量・単価の違いを金額で出します。"
        actions={
          <Link href={`/reconcile/report?from=${report.from}&to=${report.to}`} className={buttonClass("secondary")}>
            3か月のレポート
          </Link>
        }
      />
      {sp.done === "deleted" && <Notice tone="ok">お支払通知を削除しました。</Notice>}

      {clients.length === 0 ? (
        <EmptyState title="元請が登録されていません">
          {canEdit ? (
            <>
              先に <Link href="/settings">設定</Link> で元請と案件（受注単価）を登録してください。案件の受注単価と、稼働の数量から「当社の記録」を出します。
            </>
          ) : (
            "事務の方に、設定で元請と案件（受注単価）を登録してもらってください。案件の受注単価と、稼働の数量から「当社の記録」を出します。"
          )}
        </EmptyState>
      ) : (
        <>
          {withNotice.length > 0 && (
            <Card className={short > 0 ? "border-danger/40" : ""}>
              <p className="text-sm text-muted-foreground">{monthLabelJa(month)}分・{withNotice.length}社のお支払通知のうち、まだ片付いていない差</p>
              <p className="mt-1 text-2xl font-bold">
                受け取りが少ない可能性：<Money value={short} className={short > 0 ? "text-danger" : ""} />
                <span className="ml-1 text-base font-normal text-muted-foreground">（{shortCount}件）</span>
              </p>
              <p className="mt-1 text-base font-bold">
                受け取りが多い可能性：<Money value={over} />
                <span className="ml-1 text-sm font-normal text-muted-foreground">（{overCount}件。待機料など、お支払通知にだけある行を含む）</span>
              </p>
              {recovered > 0 && (
                <p className="mt-1 text-sm">
                  取り戻せた額（確定）：<Money value={recovered} className="font-bold text-success" />
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">差は「記録の違い」です。払われていないと決まったものではありません。元請に確かめてください。</p>
            </Card>
          )}

          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {rows.map((r) => (
              <li key={r.notice?.id ?? r.clientId ?? r.clientName}>
                <ClientCard row={r} month={month} />
              </li>
            ))}
          </ul>
        </>
      )}

      {canEdit && clients.length > 0 && (
        <Section title="お支払通知を上げる" description="元請の画面から落とした CSV・Excel をそのまま上げてください。列（品目・数量・単価・金額）は自動で見分け、元請ごとに覚えます。">
          <Card>
            <UploadForm
              clients={clients}
              month={monthParam(month)}
              existing={rows.filter((r) => r.notice && r.clientId).map((r) => ({ clientId: r.clientId!, fileName: r.notice!.fileName }))}
            />
          </Card>
          {sample && (
            <Card className="mt-3">
              <p className="mb-2 text-sm font-bold">ファイルが手元に無いときは、見本で流れを試せます</p>
              <SampleButton clientName={sample.name} />
              {month !== SAMPLE_NOTICE_MONTH && (
                <p className="mt-2 text-xs text-muted-foreground">見本は {monthLabelJa(SAMPLE_NOTICE_MONTH)}分です。取り込むと、その月の結果の画面に移ります。</p>
              )}
            </Card>
          )}
        </Section>
      )}

      <Section title="突合でわかること">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>お支払通知に無い案件・数量の違い・単価の違いを、案件ごとに金額で出します（当社の記録 ＝ 稼働の数量 × 案件の受注単価）。</li>
          <li>待機料・再配達・高速代など、当社の記録に無い行も並べます。当社に待機料などの記録があるのにお支払通知に無いときは、知らせます。</li>
          <li>差ごとに「問い合わせ済み」「解決」「この金額で了承」を残せます。元請のご担当者への確認のお願いの文面も作れます。</li>
          <li>差は、当社の記録とお支払通知の「記録の違い」です。どちらが正しいかは、元請に確かめてください。</li>
        </ul>
      </Section>
    </div>
  );
}

function ClientCard({ row, month }: { row: MonthClientRow; month: string }) {
  const n = row.notice;
  if (!n) {
    return (
      <Card className="h-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">{row.clientName}</p>
          <Badge tone="gray">お支払通知 未登録</Badge>
        </div>
        {row.ourTotal > 0 ? (
          <p className="mt-2 text-sm">
            {monthLabelJa(month)}の当社の記録：<Money value={row.ourTotal} />
            <span className="text-muted-foreground">（{row.projectsWithWork}案件）</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{monthLabelJa(month)}の稼働の記録はありません。</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">元請からお支払通知が届いたら、下の「お支払通知を上げる」から取り込んでください。</p>
      </Card>
    );
  }
  const clean = n.shortCount + n.overCount === 0;
  return (
    <Link href={`/reconcile/${n.id}`} className="block h-full text-foreground no-underline">
      <Card className="h-full hover:border-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">{row.clientName}</p>
          {n.lineCount === 0 ? (
            <Badge tone="yellow">列を選んでください</Badge>
          ) : clean ? (
            <Badge tone="green">{n.settledCount > 0 ? "片付き済み" : "差なし"}</Badge>
          ) : n.openCount > 0 ? (
            <Badge tone="red">未対応 {n.openCount}件</Badge>
          ) : (
            <Badge tone="yellow">問い合わせ中 {n.askedCount}件</Badge>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{n.fileName}</p>
        {n.zeroRate.length > 0 && <p className="mt-1 text-xs font-bold text-danger">受注単価が 0 円の案件があります（{n.zeroRate.join("・")}）。設定で単価を入れてください。</p>}
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">受け取りが少ない可能性</dt>
            <dd>
              <DiffAmount value={-n.short} />
              <span className="ml-1 text-xs text-muted-foreground">{n.shortCount}件</span>
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">多い可能性</dt>
            <dd>
              <DiffAmount value={n.over} />
              <span className="ml-1 text-xs text-muted-foreground">{n.overCount}件</span>
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">お支払通知の合計</dt>
            <dd>
              <Money value={n.total} />
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm font-bold text-link">結果を見る →</p>
      </Card>
    </Link>
  );
}
