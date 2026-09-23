import Link from "next/link";
import { eq } from "drizzle-orm";
import { Card, Money, TableWrap, buttonClass } from "@/components/ui";
import { EmptyState, Notice, PageHeader } from "~/components/page";
import { GenerateForm } from "~/components/statements/generate-form";
import { StatusChips } from "~/components/statements/status-chips";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listMonthStatements, sumItems, type StatementListItem } from "~/server/features/statements";
import { FILTERS, countsSentence, matchesFilter, parseFilter } from "~/server/features/statements/status";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";
import { isMonthClosed } from "~/server/repo";
import { statementsStatus } from "~/server/statements-core";

export const metadata = { title: "支払明細" };

/** 支払明細の一覧：作る・作り直す、送った／開いた／確認した、の状態と件数 */
export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ m?: string; f?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const m = monthParam(month);
  const filter = parseFilter(sp.f);
  const db = await getDb();
  const [closed, list, status, drivers] = await Promise.all([
    isMonthClosed(db, user.tenantId, month),
    listMonthStatements(db, user.tenantId, month),
    statementsStatus(db, user.tenantId, month),
    db.select({ id: s.drivers.id, name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.tenantId, user.tenantId)),
  ]);
  const canEdit = roleAtLeast(user.role, "staff");
  const nameOf = new Map([...drivers.map((d) => [d.id, d.name] as const), ...list.items.map((i) => [i.driverId, i.name] as const)]);
  const names = (ids: string[]) => ids.map((id) => nameOf.get(id) ?? "（削除された人）").join("、");

  // 作り直すと確認済みの人の明細が変わる・消える人がいるなら、押す前に知らせる
  const byDriver = new Map(list.items.map((i) => [i.driverId, i]));
  const confirmedChanging = status.stale.filter((id) => {
    const it = byDriver.get(id);
    return it && (it.status.key === "confirmed" || it.status.key === "deemed");
  });
  const warnings: string[] = [];
  if (confirmedChanging.length > 0) {
    warnings.push(`確認済みの ${confirmedChanging.length}人（${names(confirmedChanging)}）の明細が変わります。作り直すと、もう一度確認をお願いすることになります（前の確認の記録は残ります）。`);
  }
  if (status.orphan.length > 0) {
    warnings.push(`稼働も調整も無くなった ${status.orphan.length}人（${names(status.orphan)}）の明細は消えます（確認の記録は操作の記録に残ります）。`);
  }
  const needsWork = status.missing.length + status.stale.length + status.orphan.length > 0;
  const shown = list.items.filter((i) => matchesFilter(i.status, filter));
  const totals = sumItems(shown);
  const hasStatements = list.items.length > 0;
  // 送っていない人・送ったあとで中身が変わった人（1 人ずつ開いて送る。明細の画面に「次に送る人へ」がある）
  const toSend = list.items.filter((i) => i.status.key === "unsent" || i.status.needsResend);

  return (
    <div>
      <PageHeader
        title="支払明細"
        month={month}
        basePath="/statements"
        description="明細を作って、ドライバーにリンクを送ります。ドライバーはスマホで開き「確認しました」を押します。質問も明細の行から届きます。"
        actions={
          hasStatements ? (
            <>
              <a href={`/api/statements/pdf?m=${m}`} className={buttonClass("secondary")}>
                全員分の PDF
              </a>
              <a href={`/api/statements/confirmations?m=${m}`} className={buttonClass("secondary")}>
                確認の記録（CSV）
              </a>
            </>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {closed ? (
          <Notice tone="info">
            {monthLabelJa(month)}は締め済みです。明細は作り直せません（直すときは、オーナーが「締め」の画面で締めを解除します）。リンクを送る・確認・質問への返事は、このまま使えます。
          </Notice>
        ) : (
          <Card>
            {status.expected === 0 && !hasStatements ? (
              <p className="text-sm">
                この月の稼働・調整がまだありません。
                <Link href={`/import?m=${m}`}>取り込み</Link>で Excel を置くか、<Link href={`/work?m=${m}`}>稼働と調整</Link>で入れると、明細を作れます。
              </p>
            ) : needsWork ? (
              <div className="space-y-2 text-sm">
                {hasStatements && status.stale.length + status.orphan.length > 0 && <p className="font-bold text-warning">稼働が変わりました。作り直してください</p>}
                {status.missing.length > 0 && (
                  <p>
                    まだ明細が無い人 {status.missing.length}人：{names(status.missing)}
                  </p>
                )}
                {status.stale.length > 0 && (
                  <p>
                    作ったあとで稼働・単価・控除が変わった人 {status.stale.length}人：{names(status.stale)}
                  </p>
                )}
                {status.orphan.length > 0 && (
                  <p>
                    稼働が無くなったのに明細が残っている人 {status.orphan.length}人：{names(status.orphan)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-success">明細は今の稼働・設定どおりです（{status.saved}人分）。</p>
            )}
            {canEdit && (status.expected > 0 || hasStatements) && (
              <div className="mt-3">
                <GenerateForm month={month} label={hasStatements ? "明細を作り直す" : "明細を作る"} warning={warnings.length ? warnings.join(" ") : null} />
                <p className="mt-2 text-xs text-muted-foreground">中身が変わった人だけ版が上がります。変わらない人の明細・送った記録・確認はそのままです。</p>
              </div>
            )}
          </Card>
        )}

        {!hasStatements ? (
          <EmptyState title="この月の明細はまだありません">
            {closed
              ? "この月は明細を作らないまま締められています。明細を作るには、オーナーが「締め」の画面で締めを解除してから作ってください。"
              : canEdit
                ? "上の「明細を作る」を押すと、稼働と控除のルールから 1 人ずつ明細ができます。"
                : "事務の方が明細を作ると、ここに並びます。"}
          </EmptyState>
        ) : (
          <>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-lg font-bold">{countsSentence(list.counts)}</p>
                {canEdit && toSend.length > 0 && (
                  <Link href={`/statements/${toSend[0].id}`} className={buttonClass("accent", "sm:ml-auto")}>
                    まだ送っていない人に順に送る（{toSend.length}人）
                  </Link>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                「みなし確認」は、送ってから {list.deemedDays}日たっても質問が無い明細です。明細の注記（連絡が無ければ確認とみなす）に沿った状態の表示で、扱いは会社と税理士でお決めください（
                <a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/113-3.pdf" target="_blank" rel="noopener noreferrer">
                  国税庁 インボイス Q&A 問86
                </a>
                ）。
              </p>
              <nav aria-label="状態で絞る" className="mt-3 flex flex-wrap gap-2">
                {FILTERS.map((f) => {
                  const active = f.key === filter;
                  const n = list.counts[f.key];
                  if (n === 0 && !active && f.key !== "all") return null;
                  return (
                    <Link
                      key={f.key}
                      href={`/statements?m=${m}${f.key === "all" ? "" : `&f=${f.key}`}`}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm no-underline ${active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted"}`}
                    >
                      {f.label}
                      <span className="num font-bold">{n}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {shown.length === 0 ? (
              <EmptyState title="この条件に当てはまる明細はありません">
                <Link href={`/statements?m=${m}`}>すべての明細を見る</Link>
              </EmptyState>
            ) : (
              <>
                {/* スマホ：カード */}
                <ul className="space-y-2 sm:hidden">
                  {shown.map((i) => (
                    <li key={i.id}>
                      <Link href={`/statements/${i.id}`} className="block rounded-card border border-border bg-card p-3 text-foreground no-underline hover:border-foreground">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold">
                              {i.name}
                              {i.code && <span className="ml-2 text-xs font-normal text-muted-foreground">{i.code}</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">版 {i.version}</p>
                          </div>
                          <Money value={i.total} className="text-lg font-bold" />
                        </div>
                        <div className="mt-2">
                          <StatusChips status={i.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                  <li className="rounded-card border border-border bg-muted p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold">合計（{shown.length}人）</span>
                      <Money value={totals.total} className="text-lg font-bold" />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      委託料 <Money value={totals.subtotal} />・消費税 <Money value={totals.tax} />・控除 <Money value={-totals.deductions} />
                    </p>
                  </li>
                </ul>

                {/* パソコン：表 */}
                <div className="hidden sm:block">
                  <TableWrap>
                    <table className="w-full min-w-[52rem] text-sm">
                      <thead>
                        <tr className="border-b border-foreground text-left text-xs">
                          <th className="py-2 pr-2">ドライバー</th>
                          <th className="py-2 pr-2">状態</th>
                          <th className="py-2 pr-2 text-right">委託料（税抜）</th>
                          <th className="py-2 pr-2 text-right">消費税</th>
                          <th className="py-2 pr-2 text-right">控除（税込）</th>
                          <th className="py-2 pr-2 text-right">調整</th>
                          <th className="py-2 pr-2 text-right">源泉徴収</th>
                          <th className="py-2 pr-2 text-right">振込額</th>
                          <th className="py-2 text-right">版</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((i) => (
                          <tr key={i.id} className="border-b border-border align-top">
                            <td className="py-2 pr-2">
                              <Link href={`/statements/${i.id}`} className="inline-flex min-h-11 flex-col justify-center font-bold">
                                {i.name}
                                {i.code && <span className="text-xs font-normal text-muted-foreground">{i.code}</span>}
                              </Link>
                            </td>
                            <td className="py-2 pr-2">
                              <StatusChips status={i.status} />
                              <SubTimes item={i} />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Money value={i.subtotal} />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Money value={i.tax} />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Money value={-i.deductions} />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Money value={i.adjustments} />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Money value={-i.withholding} />
                            </td>
                            <td className="py-2 pr-2 text-right font-bold">
                              <Money value={i.total} />
                            </td>
                            <td className="num py-2 text-right">{i.version}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-foreground font-bold">
                          <td className="py-2 pr-2" colSpan={2}>
                            合計（{shown.length}人）
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Money value={totals.subtotal} />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Money value={totals.tax} />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Money value={-totals.deductions} />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Money value={totals.adjustments} />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Money value={-totals.withholding} />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Money value={totals.total} />
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </TableWrap>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SubTimes({ item }: { item: StatementListItem }) {
  const parts = [
    item.sentAtText ? `送付 ${item.sentAtText}` : null,
    item.viewedAtText ? (item.status.viewedCurrent ? `開封 ${item.viewedAtText}` : `前の中身を開封 ${item.viewedAtText}`) : null,
    item.confirmedAtText ? `確認 ${item.confirmedAtText}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="mt-1 text-xs text-muted-foreground">{parts.join("・")}</p>;
}
