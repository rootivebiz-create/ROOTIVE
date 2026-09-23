import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, Card, Money, TableWrap } from "@/components/ui";
import { yen } from "@/lib/payroll/money";
import { Badge, Notice, PageHeader } from "~/components/page";
import { ColumnsForm } from "~/components/reconcile/columns-form";
import { DiffAmount, Pair, Section } from "~/components/reconcile/bits";
import {
  AddNoticeFileForm,
  DeleteNoticeForm,
  DriverMappingForm,
  LineMappingForm,
  NoticeMetaForm,
  RemoveFileForm,
  ReplaceFileForm,
  ReplaceNoticeForm,
  RerunButton,
} from "~/components/reconcile/forms";
import { ItemCard } from "~/components/reconcile/item-card";
import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { loadNoticeView, runReconcile, type NoticeBatchView, type NoticeView } from "~/server/features/reconcile";
import { COLUMN_ROLES, ROLE_LABEL } from "~/server/features/reconcile/roles";
import { amountText, dateJa, formulaText, isUnsettled, qtyUnitText } from "~/server/features/reconcile/labels";
import { periodNotes, periodText } from "~/server/features/reconcile/period";
import { monthLabelJa, monthParam } from "~/server/month";

export const metadata: Metadata = { title: "突合の結果" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(tenantId: string, id: string): Promise<NoticeView | null> {
  const db = await getDb();
  try {
    return await loadNoticeView(db, tenantId, id);
  } catch (error) {
    if (error instanceof UserError) return null;
    throw error;
  }
}

/** 1 通のお支払通知の突合の結果：まとめ → 差の一覧 → 一致した案件 → ドライバー別 → 行の当て方 → 入金の記録 → 読み取りの詳細 */
export default async function NoticePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const user = await requirePageUser("viewer");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const canEdit = roleAtLeast(user.role, "staff");
  let view = await load(user.tenantId, id);
  if (!view) notFound();
  // まだ一度も突き合わせていない通知（保存した差が無い）は、開いたときに突き合わせる（状態・メモが無いので失うものが無い）。
  // 保存できないデモ（DEMO_READONLY）では書かない
  const readonlyDemo = process.env.DEMO_MODE === "1" && process.env.DEMO_READONLY === "1";
  if (canEdit && !readonlyDemo && view.stale && view.items.length === 0) {
    await runReconcile(await getDb(), user.tenantId, id, user.id);
    view = (await load(user.tenantId, id))!;
  }

  const { notice, live, totals } = view;
  const clientName = view.client?.name ?? "（元請が削除されています）";
  const m = monthParam(notice.month);
  const noLines = view.lineGroups.length === 0;
  const unsettled = view.display.filter((i) => isUnsettled(i.status) && i.diff !== 0);
  const currentItems = view.display.filter((i) => i.current);
  const historyItems = view.display.filter((i) => !i.current);
  const matched = live.projects.filter((p) => p.diff === 0 || p.roundingOnly);
  // 元請の締め日が当社と違うとき：締めの期間で比べた（日付つきの稼働）か、日付が無く月単位で比べたか
  const periodInfo = periodNotes(view.period, clientName);
  const closingSpan = view.period.differs && view.period.mode === "closing" ? `${periodText(view.period)}の` : "";
  const driverDiffs = live.drivers?.filter((d) => d.theirQty === null || Math.abs(d.theirQty - d.ourQty) > 1e-6) ?? [];
  const unknownGroups = view.lineGroups.filter((g) => g.role === "unknown");
  const unknownDrivers = view.driverGroups.filter((g) => !g.driverId && !g.remembered);
  // 何通かを足したお支払通知（営業所ごとなど）：ファイルごとの読み取りの詳細・入れ替え・外す
  const multiFile = view.files.length > 1;
  const fileWarnings = multiFile ? view.files.flatMap((f) => (f.detail?.warnings ?? []).map((w) => `${f.fileName}：${w}`)) : (view.batch?.warnings ?? []);
  const dateText = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
  const openShort = unsettled.filter((i) => i.diff < 0);
  const openOver = unsettled.filter((i) => i.diff > 0);
  /** 内訳：「宅配（個建て） ¥81,700 ＋ 夜間便 ¥10,000」（多いときは 4 件まで） */
  const breakdown = (list: typeof unsettled) =>
    list.length < 2 ? null : `${list.slice(0, 4).map((i) => `${i.label} ${yen(Math.abs(i.diff))}`).join(" ＋ ")}${list.length > 4 ? ` ＋ ほか${list.length - 4}件` : ""}`;

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href={`/reconcile?m=${m}`} className="inline-flex min-h-11 items-center">← 突合の一覧（{monthLabelJa(notice.month)}）</Link>
      </p>
      <PageHeader
        title={`${clientName}　${monthLabelJa(notice.month)}分`}
        description={
          <>
            お支払通知：{notice.fileName}
            {multiFile ? <>（{view.files.length}つのファイルを足して、合計で突き合わせています）</> : view.batch && <>（{dateText(view.batch.createdAt)} に取り込み）</>}
          </>
        }
        actions={
          unsettled.length > 0 && !noLines ? (
            <Link href={`/reconcile/${notice.id}/letter`} className={buttonClass("primary")}>
              問い合わせ文を作る
            </Link>
          ) : undefined
        }
      />

      {sp.done === "import" && <Notice tone="ok">取り込んで、当社の記録と突き合わせました。</Notice>}
      {sp.done === "sample" && <Notice tone="ok">見本のお支払通知（架空）を取り込んで、突き合わせました。</Notice>}
      {sp.done === "add" && <Notice tone="ok">ファイルを足して、全部のファイルの合計で突き合わせ直しました。</Notice>}
      {sp.done === "replaceFile" && <Notice tone="ok">ファイルを 1 つ入れ替えて、突き合わせ直しました。ほかのファイルの行はそのままです。</Notice>}

      {view.stale && (
        <Card className="mt-4 border-warning/40">
          <p className="font-bold text-warning">稼働の記録か、案件・行の決め方が変わっています</p>
          <p className="mt-1 text-sm">
            下の差は、今の記録で計算し直したものです（保存してある結果とは違います）。
            {canEdit
              ? "突き合わせ直すと、この結果を保存して、扱いとメモを残せるようになります（同じ差の扱いとメモは引き継ぎます）。"
              : "扱いとメモを残すには、事務の方に「突き合わせ直す」を押してもらってください。"}
          </p>
          {canEdit && (
            <div className="mt-3">
              <RerunButton noticeId={notice.id} />
            </div>
          )}
        </Card>
      )}

      {noLines ? (
        <Card className="mt-4 border-warning/40">
          <p className="font-bold">お支払通知の行を読み取れていません</p>
          <p className="mt-1 text-sm">
            {view.batch?.problem ?? "どの列が品目・数量・金額か分かりませんでした。"}
            {canEdit ? " 下で見出しの行と列を選ぶと、読み直して突き合わせます。選んだ対応は覚えるので、来月からは自動です。" : " 事務の方に列を選んでもらってください。"}
          </p>
          {canEdit && view.batch && (
            <div className="mt-4">
              <ColumnsForm noticeId={notice.id} rows={view.batch.rows.slice(0, 300)} headerIndex={view.batch.headerIndex} columns={view.batch.columns} />
            </div>
          )}
          {!view.batch && (
            <p className="mt-2 text-sm text-muted-foreground">
              読み取ったファイルの記録が無いため、列を選び直せません。{canEdit ? "下の「上げ直す」から、ファイルを上げ直してください。" : "事務の方に、ファイルを上げ直してもらってください。"}
            </p>
          )}
        </Card>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Card className={totals.short > 0 ? "border-danger/40" : ""}>
              <p className="text-sm text-muted-foreground">受け取りが少ない可能性</p>
              <p className="mt-1 text-3xl font-bold">
                <Money value={totals.short} className={totals.short > 0 ? "text-danger" : ""} />
              </p>
              <p className="text-sm text-muted-foreground">{totals.shortCount}件（未対応・問い合わせ済みの合計）</p>
              {breakdown(openShort) && <p className="num mt-1 break-words text-xs text-muted-foreground">内訳：{breakdown(openShort)}</p>}
            </Card>
            <Card>
              <p className="text-sm text-muted-foreground">受け取りが多い可能性</p>
              <p className="mt-1 text-3xl font-bold">
                <Money value={totals.over} className={totals.over > 0 ? "text-success" : ""} />
              </p>
              <p className="text-sm text-muted-foreground">{totals.overCount}件（待機料などお支払通知にだけある行を含む）</p>
              {breakdown(openOver) && <p className="num mt-1 break-words text-xs text-muted-foreground">内訳：{breakdown(openOver)}</p>}
            </Card>
          </div>
          <Card className="mt-3">
            <div className="divide-y divide-border">
              <Pair label={`当社の記録（${closingSpan}稼働の数量 × ${view.snapshotRates ? "締めたときの" : ""}受注単価）`}>
                <Money value={live.ourTotal} />
              </Pair>
              <Pair label="お支払通知（突き合わせの対象）">
                <Money value={live.theirTotal} />
              </Pair>
              <Pair label="差（お支払通知 − 当社の記録）">
                <DiffAmount value={live.theirTotal - live.ourTotal} />
              </Pair>
              {live.ignoredTotal !== 0 && (
                <Pair label="対象外にした行（上の合計に入れていない）">
                  <Money value={live.ignoredTotal} />
                </Pair>
              )}
              {totals.settledCount > 0 && (
                <Pair label={`解決・了承にした差（${totals.settledCount}件。上の 2 つには入れていない）`}>
                  <DiffAmount value={totals.settledNet} />
                </Pair>
              )}
              {totals.recoveredCount > 0 && (
                <Pair label={`取り戻せた額（解決にして額を入れた ${totals.recoveredCount}件。確定したお金）`}>
                  <Money value={totals.recovered} className="font-bold text-success" />
                </Pair>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              差は、当社の記録とお支払通知の「記録の違い」です。払われていないと決まったものではありません。どちらが正しいかは、元請に確かめてください。
              {view.snapshotRates && " この月は締めてあるので、受注単価は締めたときの明細の写しの単価を使っています。"}
            </p>
          </Card>
        </>
      )}

      {view.facts.length > 0 && (
        <Section title="入金の記録から分かること">
          <div className="space-y-3">
            {view.facts.map((f) => (
              <Card key={f.code}>
                <p className="font-bold">{f.title}</p>
                <p className="mt-1 text-sm">{f.detail}</p>
                <p className="mt-2 text-xs text-muted-foreground">{f.note}</p>
                <ul className="mt-1 text-xs">
                  {f.sources.map((s) => (
                    <li key={s.url}>
                      出典：
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {!noLines && (live.chargeWarnings.length > 0 || unknownGroups.length > 0 || fileWarnings.length > 0 || live.zeroRateProjects.length > 0 || periodInfo.length > 0) && (
        <div className="mt-4 space-y-2">
          {live.zeroRateProjects.length > 0 && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              受注単価が 0 円の案件があります（{live.zeroRateProjects.map((p) => p.name).join("・")}）。当社の記録が 0 円になるため、この案件の差は正しくありません。
              {canEdit ? (
                <>
                  {" "}
                  <Link href="/settings" className="font-bold">
                    設定
                  </Link>
                  で元請からもらう単価（税抜）を入れてから、「今の記録で突き合わせ直す」を押してください。
                </>
              ) : (
                " 事務の方に、設定で受注単価を入れてもらってください。"
              )}
            </p>
          )}
          {periodInfo.map((n) => (
            <div key={n.title} className={n.tone === "warn" ? "rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" : "rounded-lg border border-border bg-muted p-3 text-sm"}>
              <p className="font-bold">{n.title}</p>
              <p className="mt-1">{n.body}</p>
            </div>
          ))}
          {fileWarnings.map((w) => (
            <p key={w} className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              {w}
              <span className="ml-1 text-muted-foreground">（下の「読み取りの詳細」で、読み飛ばした行を見られます）</span>
            </p>
          ))}
          {live.chargeWarnings.map((w) => (
            <p key={w.projectId} className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              当社の記録に「{w.name}」{qtyUnitText(w.qty, w.unit)}（{amountText(w.amount)}）がありますが、お支払通知に見当たりません。待機料・高速代などの追加の料金が入っているか、確かめてください。
            </p>
          ))}
          {unknownGroups.length > 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              どの案件のことか決まっていない行が {unknownGroups.length}種類 あります。いまは「お支払通知にだけある」として数えています。
              <a href="#lines" className="ml-1 font-bold">
                下の「お支払通知の行」で決める
              </a>
            </p>
          )}
        </div>
      )}

      {!noLines && (
        <Section
          title={`違いの一覧（${currentItems.length}件）`}
          description="マイナスは、お支払通知が当社の記録より少ないもの（受け取りが少ない可能性）。扱いとメモを残しておくと、来月以降も同じ差の記録が続きます。"
        >
          {currentItems.length === 0 ? (
            <Card className="border-success/40">
              <p className="font-bold text-success">当社の記録とお支払通知の金額は、案件ごとに一致しました</p>
              <p className="mt-1 text-sm text-muted-foreground">
                当社の記録 {amountText(live.ourTotal)}・お支払通知 {amountText(live.theirTotal)}。入金されたら、下で入金日を残しておくと、入金までの日数も確かめられます。
              </p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {currentItems.map((it) => (
                <li key={it.id ?? it.key} id={it.id ? `item-${it.id}` : undefined}>
                  <ItemCard item={it} canEdit={canEdit && !view.stale} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {!noLines && historyItems.length > 0 && (
        <Section
          title={`片付いた差の記録（${historyItems.length}件）`}
          description="問い合わせたあとで直ったお支払通知が届いたなど、今の突き合わせには出てこない差です。取り戻せた額を残しておくと、レポートの「取り戻せた額（確定）」に入ります。"
        >
          <ul className="space-y-3">
            {historyItems.map((it) => (
              <li key={it.id ?? it.key} id={it.id ? `item-${it.id}` : undefined}>
                <ItemCard item={it} canEdit={canEdit && !view.stale} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {matched.length > 0 && (
        <Section title={`一致した案件（${matched.length}件）`}>
          <ul className="space-y-2">
            {matched.map((p) => (
              <li key={p.projectId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
                <span className="font-bold">{p.name}</span>
                <span className="num text-sm text-muted-foreground">
                  {formulaText(p.ourQty, p.ourPrice, p.ourAmount, p.unit)}
                  {p.roundingOnly && `（お支払通知は ${amountText(p.theirAmount)}。端数の扱いの違い ${amountText(p.diff)} は差に数えていません）`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {live.drivers && live.drivers.length > 0 && (
        <Section
          title="ドライバー別の内訳"
          description="お支払通知にドライバーの列があるので、案件ごとにドライバー別の数量も比べました。差は、数量の違いを当社の単価で計算したものです。"
        >
          {driverDiffs.length === 0 ? (
            <p className="text-sm">すべてのドライバーの数量が一致しました（{live.drivers.length}件）。</p>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-normal">案件</th>
                    <th className="py-2 pr-3 font-normal">ドライバー</th>
                    <th className="py-2 pr-3 text-right font-normal">当社の記録</th>
                    <th className="py-2 pr-3 text-right font-normal">お支払通知</th>
                    <th className="py-2 text-right font-normal">差</th>
                  </tr>
                </thead>
                <tbody>
                  {driverDiffs.map((d, i) => (
                    <tr key={`${d.projectId}:${d.driverId ?? d.driverName}:${i}`} className="border-b border-border">
                      <td className="py-2 pr-3">{d.projectName}</td>
                      <td className="py-2 pr-3">{d.driverName || "（名前なし）"}</td>
                      <td className="num py-2 pr-3 text-right">{qtyUnitText(d.ourQty, d.unit)}</td>
                      <td className="num py-2 pr-3 text-right">{d.theirQty === null ? "−" : qtyUnitText(d.theirQty, d.unit)}</td>
                      <td className="py-2 text-right">{d.diffAtOurPrice === null ? "−" : <DiffAmount value={d.diffAtOurPrice} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {driverDiffs.length > 0 && driverDiffs.length < live.drivers.length && (
            <p className="mt-2 text-xs text-muted-foreground">ほかの {live.drivers.length - driverDiffs.length}件は数量が一致しています。</p>
          )}
        </Section>
      )}

      {!noLines && (
        <Section
          id="lines"
          title={`お支払通知の行（${view.lineGroups.length}種類）`}
          description="お支払通知の品目を、当社のどの案件のことか当てています。違うときや、当たらない行は選んでください。決めたことは元請ごとに覚え、来月から自動で当てます。"
        >
          <ul className="space-y-3">
            {view.lineGroups.map((g) => (
              <li key={g.key}>
                <Card className={g.role === "unknown" ? "border-warning/40" : ""}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-bold">{g.raw}</p>
                      <p className="num text-sm text-muted-foreground">
                        {g.count > 1 ? `${g.count}行・` : ""}
                        {formulaText(g.qty, g.price, g.amount, null)}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      {g.role === "project" && (
                        <>
                          <Badge tone={g.otherClient ? "yellow" : "green"}>{g.otherClient ? "ほかの元請の案件" : "案件"}</Badge>
                          <p className="mt-1 font-bold">→ {g.projectName}</p>
                        </>
                      )}
                      {g.role === "extra" && <Badge tone="gray">追加の料金</Badge>}
                      {g.role === "ignore" && <Badge tone="gray">対象外</Badge>}
                      {g.role === "unknown" && <Badge tone="yellow">未確認</Badge>}
                    </div>
                  </div>
                  {g.role === "project" && g.otherClient && (
                    <p className="mt-2 text-xs text-warning">
                      この元請の案件ではないため、その案件の稼働の全部と比べています。違う案件のことなら、選び直してください。
                    </p>
                  )}
                  {canEdit && (
                    <div className="mt-3">
                      <LineMappingForm
                        noticeId={notice.id}
                        lineKey={g.key}
                        current={g.role === "project" && g.projectId ? `project:${g.projectId}` : g.role === "extra" || g.role === "ignore" ? g.role : ""}
                        remembered={g.remembered}
                        suggestedProjectId={g.suggestedProjectId}
                        projects={view.projects}
                        clientName={view.client?.name ?? null}
                      />
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {view.driverGroups.length > 0 && (
        <Section
          title="お支払通知のドライバー名"
          description={
            unknownDrivers.length > 0
              ? `名簿のだれか分からない名前が ${unknownDrivers.length}件 あります。選ぶと、ドライバー別の内訳にまとまり、名前を別名として覚えます。`
              : "お支払通知のドライバー名を、名簿の人に当てています。"
          }
        >
          <ul className="space-y-2">
            {view.driverGroups.map((g) => (
              <li key={g.key} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{g.raw}</span>
                  <span className="text-sm">{g.driverName ? `→ ${g.driverName}` : <Badge tone={g.remembered ? "gray" : "yellow"}>{g.remembered ? "名簿にいない" : "未確認"}</Badge>}</span>
                </div>
                {canEdit && (
                  <div className="mt-2">
                    <DriverMappingForm noticeId={notice.id} driverKey={g.key} current={g.driverId} remembered={g.remembered} drivers={view.drivers} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="入金の記録" description="元請から入金された日と、振込手数料などで差し引かれた額を残すと、入金までの日数と手数料を確かめられます。">
        <Card>
          {canEdit ? (
            <NoticeMetaForm noticeId={notice.id} paidOn={notice.paidOn} feeDeducted={notice.feeDeducted} />
          ) : (
            <div className="divide-y divide-border">
              <Pair label="入金日">{notice.paidOn ? dateJa(notice.paidOn) : "未入力"}</Pair>
              <Pair label="差し引かれた手数料">{notice.feeDeducted ? amountText(notice.feeDeducted) : "なし"}</Pair>
            </div>
          )}
        </Card>
      </Section>

      {!noLines && view.files.some((f) => f.detail) && (
        <Section title="読み取りの詳細">
          <div className="space-y-3">
            {multiFile
              ? view.files.map((f) =>
                  f.detail ? (
                    <ReadDetails key={f.id} noticeId={notice.id} fileId={f.id} title={`「${f.fileName}」の列の対応・読み飛ばした行を見る`} detail={f.detail} canEdit={canEdit} />
                  ) : null,
                )
              : view.batch && <ReadDetails noticeId={notice.id} title="列の対応・読み飛ばした行を見る" detail={view.batch} canEdit={canEdit} />}
          </div>
        </Section>
      )}

      {canEdit && (
        <Section title="上げ直す・足す・削除する">
          {multiFile && (
            <Card className="mb-3">
              <p className="font-bold">お支払通知のファイル（{view.files.length}つ）</p>
              <p className="mt-1 text-sm text-muted-foreground">全部のファイルの行を足して、合計で突き合わせています。1 つだけ直したものが届いたら「このファイルだけ入れ替える」、まちがえて足したものは「外す」を使ってください。</p>
              <ul className="mt-3 space-y-3">
                {view.files.map((f) => (
                  <li key={f.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{f.fileName}</span>
                      <span className="num text-sm text-muted-foreground">
                        {f.lineCount}行・<Money value={f.total} />
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{dateText(f.createdAt)} に取り込み</p>
                    <div className="mt-2 space-y-2">
                      {view.client && <ReplaceFileForm clientId={view.client.id} month={m} fileId={f.id} fileName={f.fileName} />}
                      <RemoveFileForm noticeId={notice.id} fileId={f.id} fileName={f.fileName} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {view.client ? (
            <>
              <Card className="mb-3">
                <p className="mb-3 text-sm text-muted-foreground">元請から直したお支払通知が届いたら、ここで上げ直してください。同じ差の扱い・メモ・取り戻せた額は残ります。</p>
                <ReplaceNoticeForm clientId={view.client.id} clientName={view.client.name} month={m} monthText={monthLabelJa(notice.month)} fileCount={view.files.length} />
              </Card>
              {!noLines && (
                <Card className="mb-3">
                  <p className="mb-3 text-sm text-muted-foreground">
                    営業所ごとなど、同じ元請から同じ月のお支払通知が何通も届くときは、ここで足してください。全部のファイルの行を足して、合計で突き合わせます。
                  </p>
                  <AddNoticeFileForm clientId={view.client.id} clientName={view.client.name} month={m} monthText={monthLabelJa(notice.month)} />
                </Card>
              )}
            </>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">
              このお支払通知の元請は削除されています。直したお支払通知は、<Link href={`/reconcile?m=${m}`}>一覧の画面</Link>で元請を選んで上げてください。
            </p>
          )}
          <DeleteNoticeForm noticeId={notice.id} itemCount={view.items.length} />
        </Section>
      )}
    </div>
  );
}

/** 1 つのファイルの読み取りの詳細（列の対応・合計・読み飛ばした行）と、列の選び直し */
function ReadDetails({ noticeId, fileId, title, detail, canEdit }: { noticeId: string; fileId?: string; title: string; detail: NoticeBatchView; canEdit: boolean }) {
  const header = detail.rows[detail.headerIndex] ?? [];
  return (
    <details className="rounded-card border border-border bg-card p-4">
      <summary className="flex min-h-11 cursor-pointer items-center font-bold">
        {title}
        {canEdit ? "／列を選び直す" : ""}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <div className="divide-y divide-border">
          <Pair label="ファイルの形">{detail.encoding === "xlsx" ? `Excel（シート「${detail.sheetName}」）` : detail.encoding === "shift_jis" ? "CSV（Shift_JIS）" : "CSV（UTF-8）"}</Pair>
          <Pair label="見出しの行">
            {detail.headerIndex + 1}行目{detail.fromSaved ? "（前回覚えた対応）" : ""}
          </Pair>
          {COLUMN_ROLES.map((r) => {
            const idx = detail.columns[r] ?? null;
            return (
              <Pair key={r} label={ROLE_LABEL[r]}>
                {idx === null ? "使わない" : `「${header[idx] || `${idx + 1}列目`}」の列`}
              </Pair>
            );
          })}
          <Pair label="読み取った行の合計">{amountText(detail.total)}</Pair>
          {detail.fileTotal !== null && <Pair label="ファイルの合計の行">{amountText(detail.fileTotal)}</Pair>}
          {detail.taxTotal !== 0 && <Pair label="消費税の行（突き合わせに使っていない）">{amountText(detail.taxTotal)}</Pair>}
          {detail.feeTotal !== 0 && <Pair label="振込手数料の行（入金の記録へ）">{amountText(detail.feeTotal)}</Pair>}
          {detail.dates && (
            <Pair label="日付">
              {dateJa(detail.dates.from)}〜{dateJa(detail.dates.to)}
              {detail.dates.outside > 0 ? `（その月の外 ${detail.dates.outside}行）` : ""}
            </Pair>
          )}
        </div>
        {detail.notes.map((w) => (
          <p key={w} className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            {w}
          </p>
        ))}
        {detail.skipped.length > 0 && (
          <div>
            <p className="font-bold">読み飛ばした行（{detail.skipped.length}行）</p>
            <ul className="mt-1 space-y-1">
              {detail.skipped.slice(0, 50).map((s) => (
                <li key={s.rowNo} className="break-words text-muted-foreground">
                  {s.rowNo}行目：{s.reason}（{s.text || "空"}）
                </li>
              ))}
            </ul>
          </div>
        )}
        {detail.rowsTruncated && <p className="text-muted-foreground">ファイルが長いため、列を選び直すときは最初の 5,000 行だけを使います。</p>}
        {canEdit && (
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-bold">列を選び直す</p>
            <ColumnsForm noticeId={noticeId} fileId={fileId} rows={detail.rows.slice(0, 300)} headerIndex={detail.headerIndex} columns={detail.columns} />
          </div>
        )}
      </div>
    </details>
  );
}
