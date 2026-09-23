import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Money, TableWrap, buttonClass } from "@/components/ui";
import { Notice } from "~/components/page";
import { LinkPanel } from "~/components/statements/link-panel";
import { StatementView } from "~/components/statements/statement-view";
import { StatusChips } from "~/components/statements/status-chips";
import { ThreadPanel } from "~/components/statements/thread-panel";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { getStatementDetail, listMonthStatements, markQuestionsRead, staffLinkToken } from "~/server/features/statements";
import { requestOrigin } from "~/server/features/statements/request";
import { jpDateTime, jpMonthLabel, shareLinks, shareMessage, shareSubject } from "~/server/features/statements/view";
import { monthParam } from "~/server/month";
import { isMonthClosed } from "~/server/repo";

export const metadata = { title: "支払明細" };

/** 1 人の明細：ドライバーに見えているそのままの中身 ＋ 送る・やりとり・確認の記録 */
export default async function StatementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("viewer");
  const { id } = await params;
  const db = await getDb();
  const detail = await getStatementDetail(db, user.tenantId, id);
  if (!detail) notFound();
  const canEdit = roleAtLeast(user.role, "staff");
  const st = detail.statement;
  const v = detail.view;
  const m = monthParam(st.month);
  // 事務の人が開いたら、質問は読んだことにする（見るだけの人では変えない）
  if (canEdit && detail.status.unread > 0) await markQuestionsRead(db, user.tenantId, st.id);
  const [closed, list] = await Promise.all([isMonthClosed(db, user.tenantId, st.month), listMonthStatements(db, user.tenantId, st.month)]);

  const index = list.items.findIndex((i) => i.id === st.id);
  const prev = index > 0 ? list.items[index - 1] : null;
  const next = index >= 0 && index < list.items.length - 1 ? list.items[index + 1] : null;
  const rotated = index >= 0 ? [...list.items.slice(index + 1), ...list.items.slice(0, index)] : list.items;
  const nextToSend = rotated.find((i) => i.status.key === "unsent" || i.status.needsResend) ?? null;

  let link: { url: string; message: string; links: ReturnType<typeof shareLinks>; expiresText: string } | null = null;
  if (canEdit) {
    const { token, expiresAt } = staffLinkToken(st);
    const url = `${await requestOrigin()}/s/${token}`;
    const message = shareMessage(v.driver.name, st.month, url);
    link = {
      url,
      message,
      links: shareLinks({ message, subject: shareSubject(st.month, v.company.name), phone: detail.contact.phone, email: detail.contact.email }),
      expiresText: jpDateTime(new Date(expiresAt * 1000)),
    };
  }
  const openQuestions = detail.threads.reduce((n, t) => n + t.open, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/statements?m=${m}`} className="inline-flex min-h-11 items-center text-sm">
          ← {jpMonthLabel(st.month)}の明細の一覧
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{v.driver.name}さんの支払明細</h1>
          <StatusChips status={detail.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {jpMonthLabel(st.month)}分・版 {st.version}・最後に中身が変わった日時 {detail.updatedAtText}
        </p>
      </div>

      {detail.status.key === "changed" && (
        <Notice tone="error">
          前の版（版 {detail.status.lastConfirmedVersion}）は確認済みですが、そのあと中身が変わりました。ドライバーのページには「内容が変わりました。もう一度ご確認ください」と出ます。
          {detail.status.needsResend ? "リンクをもう一度送って、知らせてください。" : ""}
        </Notice>
      )}
      {detail.status.key === "deemed" && (
        <Notice tone="info">
          送ってから {detail.status.deemedDays}日たち、質問はありません。明細の注記（連絡が無ければ確認とみなす）に沿って「みなし確認」と表示しています。扱いは会社と税理士でお決めください。
        </Notice>
      )}
      {detail.status.needsResend && detail.status.key !== "changed" && (
        <Notice tone="info">送ったあとで中身が変わりました。新しい中身はまだ送っていません。リンクはそのまま使えるので、もう一度送ってください。</Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="order-2 space-y-3 lg:order-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">ドライバーに見えている明細</h2>
            <a href={`/api/statements/${st.id}/pdf`} className={buttonClass("secondary")}>
              PDF
            </a>
          </div>
          <StatementView view={v} account={detail.account} />
        </div>

        <div className="order-1 space-y-5 lg:order-2">
          <Card>
            <h2 className="font-bold">送る</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">送付</dt>
              <dd>{detail.sentAtText ?? "まだ送っていません"}</dd>
              <dt className="text-muted-foreground">開封</dt>
              <dd>{detail.viewedAtText ?? "まだ開かれていません"}</dd>
              <dt className="text-muted-foreground">確認</dt>
              <dd>{detail.status.confirmedAt ? `${jpDateTime(detail.status.confirmedAt)}（版 ${st.version}）` : "今の版はまだ確認されていません"}</dd>
            </dl>
            <div className="mt-3">
              {link ? (
                <LinkPanel
                  statementId={st.id}
                  url={link.url}
                  message={link.message}
                  links={link.links}
                  expiresText={link.expiresText}
                  hasPhone={!!detail.contact.phone}
                  hasEmail={!!detail.contact.email}
                />
              ) : (
                <p className="text-sm text-muted-foreground">リンクを送るのは事務・オーナーの方です（見るだけの役割では出しません）。</p>
              )}
            </div>
            {closed && <p className="mt-3 text-xs text-muted-foreground">この月は締め済みです。中身は変えられませんが、送る・確認・質問は使えます。</p>}
          </Card>

          <Card>
            <h2 className="font-bold">
              やりとり
              {openQuestions > 0 && <span className="ml-2 text-sm text-danger">未解決 {openQuestions}</span>}
            </h2>
            <div className="mt-2">
              <ThreadPanel statementId={st.id} threads={detail.threads} canEdit={canEdit} />
            </div>
          </Card>

          <Card>
            <h2 className="font-bold">確認の記録</h2>
            {detail.confirmations.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">まだありません。ドライバーが「内容を確認しました」を押すと、日時・版・その時の振込額が残ります。</p>
            ) : (
              <TableWrap>
                <table className="mt-2 w-full min-w-[22rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-normal">日時</th>
                      <th className="py-1 pr-2 font-normal">版</th>
                      <th className="py-1 pr-2 text-right font-normal">振込額</th>
                      <th className="py-1 font-normal">端末</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.confirmations.map((c, i) => (
                      <tr key={i} className="border-b border-border align-top">
                        <td className="py-1 pr-2">
                          {c.at}
                          <span className="block text-xs text-muted-foreground">ドライバー（リンクから）</span>
                        </td>
                        <td className="py-1 pr-2">
                          {c.version}
                          <span className="block text-xs text-muted-foreground">{c.current ? "今の版" : "前の版"}</span>
                        </td>
                        <td className="py-1 pr-2 text-right">
                          <Money value={c.total} />
                        </td>
                        <td className="py-1 text-xs">
                          {c.device ?? "—"}
                          <span className="block font-mono text-muted-foreground">
                            IP {c.ipShort ?? "—"}・{c.hashShort}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <p className="mt-2 text-xs text-muted-foreground">IP は元の値ではなく、ハッシュの先頭だけを残しています。月の全員分は一覧の「確認の記録（CSV）」から出せます。</p>
          </Card>
        </div>
      </div>

      <nav aria-label="ほかの人の明細" className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {prev && (
          <Link href={`/statements/${prev.id}`} className={buttonClass("secondary")}>
            ← {prev.name}
          </Link>
        )}
        {next && (
          <Link href={`/statements/${next.id}`} className={buttonClass("secondary")}>
            {next.name} →
          </Link>
        )}
        {canEdit && nextToSend && (
          <Link href={`/statements/${nextToSend.id}`} className={buttonClass("accent", "sm:ml-auto")}>
            次に送る人へ（{nextToSend.name}）
          </Link>
        )}
      </nav>
    </div>
  );
}
