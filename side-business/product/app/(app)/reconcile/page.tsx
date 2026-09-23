import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Card, Money } from "@/components/ui";
import { Badge, EmptyState, Notice, PageHeader } from "~/components/page";
import { DiffAmount, Section } from "~/components/reconcile/bits";
import { FoundMoneyCard } from "~/components/reconcile/found-money";
import { SampleButton, UploadForm } from "~/components/reconcile/forms";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { defaultReportParams, findSampleClient, listMonth, listWaiting, SAMPLE_NOTICE_MONTH, type MonthClientRow, type WaitingItem } from "~/server/features/reconcile";
import { KIND_LABEL, monthJa, WAIT_ALERT_DAYS, waitingTone } from "~/server/features/reconcile/labels";
import { closingDayText, periodText } from "~/server/features/reconcile/period";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata: Metadata = { title: "元請との突合" };

/** 返事待ちの一覧に並べる数（多いときは、長く待っている順にここまで） */
const WAITING_SHOWN = 8;

/** 元請との突合：その月の元請ごとに、お支払通知を上げたか・差がいくらあるかを並べる */
export default async function ReconcilePage({ searchParams }: { searchParams: Promise<{ m?: string; done?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const db = await getDb();
  const now = new Date();
  const [{ rows, clients, found }, waiting] = await Promise.all([listMonth(db, user.tenantId, month, now), listWaiting(db, user.tenantId, now)]);
  const canEdit = roleAtLeast(user.role, "staff");
  const sample = canEdit ? await findSampleClient(db, user.tenantId) : null;
  const report = defaultReportParams(month);
  const withNotice = rows.filter((r) => r.notice);
  const over = withNotice.reduce((a, r) => a + (r.notice?.over ?? 0), 0);
  const overCount = withNotice.reduce((a, r) => a + (r.notice?.overCount ?? 0), 0);
  // 取引をやめた元請には、お支払通知を上げない（これまでの通知はそのまま見られる）
  const activeClients = clients.filter((c) => c.active);
  const inactiveCount = clients.length - activeClients.length;

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
            <FoundMoneyCard
              title={`${monthLabelJa(month)}分の見つけたお金`}
              found={found}
              over={over}
              overCount={overCount}
              scope={`${withNotice.length}社のお支払通知`}
            />
          )}

          {waiting.length > 0 && <WaitingCard items={waiting} />}

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
        <Section
          title="お支払通知を上げる"
          description="元請の画面から落とした CSV・Excel をそのまま上げてください（PDF しか無いときは、表をコピーして貼り付けられます）。列（品目・数量・単価・金額）は自動で見分け、元請ごとに覚えます。"
        >
          <Card>
            {activeClients.length === 0 ? (
              <p className="text-sm">
                取引中の元請がありません。<Link href="/settings/clients">設定の「元請」</Link>で、取引中の元請を登録するか、有効に戻してください。
              </p>
            ) : (
              <UploadForm
                clients={activeClients}
                month={monthParam(month)}
                existing={rows.filter((r) => r.notice && r.clientId).map((r) => ({ clientId: r.clientId!, fileName: r.notice!.fileName }))}
              />
            )}
            {inactiveCount > 0 && activeClients.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">取引をやめた元請（{inactiveCount}社）は選べません。これまでのお支払通知は、そのまま見られます（直したお支払通知は、その結果の画面の「上げ直す」で入れ替えられます）。</p>
            )}
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
          <li>元請の締め日が月末でないとき（例：20日締め）は、日付のある稼働から、その締めの期間（例：9月21日〜10月20日）の分を数えて比べます。</li>
          <li>待機料・再配達・高速代など、当社の記録に無い行も並べます。当社に待機料などの記録があるのにお支払通知に無いときは、知らせます。</li>
          <li>営業所ごとなど、同じ元請から同じ月のお支払通知が何通も届くときは、「足す」で合わせて突き合わせます（同じファイルは二重に足せません）。</li>
          <li>差ごとに「問い合わせ済み」「解決」「この金額で了承」を残せます。元請のご担当者への確認のお願いの文面（コピー・PDF）も作れます。</li>
          <li>差は、当社の記録とお支払通知の「記録の違い」です。どちらが正しいかは、元請に確かめてください。</li>
        </ul>
      </Section>
    </div>
  );
}

/** 問い合わせたまま返事を待っている差（全部の月。長く待っている順） */
function WaitingCard({ items }: { items: WaitingItem[] }) {
  const long = items.filter((i) => (i.days ?? 0) >= WAIT_ALERT_DAYS).length;
  const shown = items.slice(0, WAITING_SHOWN);
  return (
    <Card className={long > 0 ? "mt-3 border-warning/40" : "mt-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">返事待ち（{items.length}件）</p>
        {long > 0 && (
          <Badge tone="yellow">
            {WAIT_ALERT_DAYS}日を過ぎた差 {long}件
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">問い合わせ済みのまま、元請からの返事を待っている差です。{WAIT_ALERT_DAYS}日を過ぎたら、もう一度お声がけするのがおすすめです。</p>
      <ul className="mt-2 divide-y divide-border">
        {shown.map((i) => (
          <li key={i.itemId}>
            <Link href={`/reconcile/${i.noticeId}#item-${i.itemId}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-foreground no-underline hover:bg-muted">
              <span className="min-w-0">
                <span className="block break-words text-sm font-bold">
                  {i.clientName}・{monthJa(i.month)}分　{i.label}
                </span>
                <span className="block text-xs text-muted-foreground">{KIND_LABEL[i.kind]}</span>
              </span>
              <span className="flex items-center gap-2">
                <DiffAmount value={i.diff} className="text-sm" />
                {i.days !== null ? <Badge tone={waitingTone(i.days)}>返事待ち {i.days}日</Badge> : <Badge tone="gray">日付の記録なし</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > shown.length && <p className="mt-1 text-xs text-muted-foreground">ほか {items.length - shown.length}件（それぞれの月の結果の画面で見られます）</p>}
    </Card>
  );
}

function PeriodLine({ row }: { row: MonthClientRow }) {
  const p = row.period;
  if (!p || !p.differs) return null;
  if (p.mode === "closing") return <p className="mt-1 text-xs text-muted-foreground">締め日 毎月{closingDayText(p.closingDay)}：{periodText(p)} の稼働で比べています</p>;
  return <p className="mt-1 text-xs text-warning">締め日が違うため月単位で比べています（稼働に日付がありません）</p>;
}

function ClientCard({ row, month }: { row: MonthClientRow; month: string }) {
  const n = row.notice;
  const ended = !row.clientActive && row.clientId !== null ? <Badge tone="gray">取引終了</Badge> : null;
  if (!n) {
    return (
      <Card className="h-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">{row.clientName}</p>
          <span className="flex flex-wrap gap-1">
            {ended}
            <Badge tone="gray">お支払通知 未登録</Badge>
          </span>
        </div>
        {row.ourTotal > 0 ? (
          <p className="mt-2 text-sm">
            {monthLabelJa(month)}の当社の記録：<Money value={row.ourTotal} />
            <span className="text-muted-foreground">（{row.projectsWithWork}案件）</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{monthLabelJa(month)}の稼働の記録はありません。</p>
        )}
        <PeriodLine row={row} />
        <p className="mt-2 text-xs text-muted-foreground">
          {row.clientActive ? "元請からお支払通知が届いたら、下の「お支払通知を上げる」から取り込んでください。" : "取引をやめた元請です。お支払通知を上げるときは、設定で有効に戻してください。"}
        </p>
      </Card>
    );
  }
  const clean = n.shortCount + n.overCount === 0;
  return (
    <Link href={`/reconcile/${n.id}`} className="block h-full text-foreground no-underline">
      <Card className="h-full hover:border-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">{row.clientName}</p>
          <span className="flex flex-wrap gap-1">
            {ended}
            {n.lineCount === 0 ? (
              <Badge tone="yellow">列を選んでください</Badge>
            ) : clean ? (
              <Badge tone="green">{n.settledCount > 0 ? "片付き済み" : "差なし"}</Badge>
            ) : n.openCount > 0 ? (
              <Badge tone="red">未対応 {n.openCount}件</Badge>
            ) : (
              <Badge tone="yellow">問い合わせ中 {n.askedCount}件</Badge>
            )}
            {n.waitingLong > 0 && <Badge tone="yellow">返事待ち14日超 {n.waitingLong}件</Badge>}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{n.fileName}</p>
        <PeriodLine row={row} />
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
          {n.recovered > 0 && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">取り戻せた額（確定）</dt>
              <dd>
                <Money value={n.recovered} className="font-bold text-success" />
              </dd>
            </div>
          )}
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
