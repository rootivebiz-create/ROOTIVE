import { notFound } from "next/navigation";
import { en } from "@/lib/engine/types";
import { jpDate } from "@/lib/format";
import { TableWrap } from "@/components/ui";
import { AskButton, GeneralAskForm } from "~/components/portal/ask-form";
import { ConfirmForm } from "~/components/portal/confirm-form";
import { ViewPing } from "~/components/portal/view-ping";
import { StatementView } from "~/components/statements/statement-view";
import { getDb } from "~/db/client";
import { loadPortal } from "~/server/features/portal";
import { isStaffPreview } from "~/server/features/statements/request";
import { jpMonthLabel } from "~/server/features/statements/view";

export const dynamic = "force-dynamic";

/** ドライバーの明細（ログインなし）。リンクの署名・期限・作り直しを毎回確かめる */
export default async function DriverStatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const data = await loadPortal(db, token);
  if (!data) notFound();
  const staffPreview = await isStaffPreview(db, token);
  const v = data.view;
  const month = jpMonthLabel(v.month);
  const threadCount = new Map(data.threads.map((t) => [t.lineKey ?? "", t.messages.length]));
  const enc = encodeURIComponent(token);

  return (
    <main>
      <ViewPing token={token} />
      <header className="mb-4">
        <p className="text-sm text-muted-foreground">{data.companyName}</p>
        <h1 className="text-2xl font-bold">{month}分の支払明細</h1>
        <p className="text-sm text-muted-foreground">{v.driver.name} 様</p>
      </header>

      <div className="space-y-3">
        {staffPreview && (
          <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm">
            会社の方としてログインしたまま開いています。開いた記録はつけません。「内容を確認しました」と質問は、ドライバーご本人だけが送れます。
          </p>
        )}
        {data.confirmedOlder && (
          <p role="alert" className="rounded-lg border-2 border-warning bg-warning/10 p-3 font-bold text-warning">
            内容が変わりました。もう一度ご確認ください。
            <span className="mt-1 block text-sm font-normal text-foreground">
              前の版（版 {data.confirmedOlder.version}）は {data.confirmedOlder.at} に確認いただいています。いまの明細は版 {v.version} です。
            </span>
          </p>
        )}
        {data.unreadReplies > 0 && (
          <a href="#questions" className="block rounded-lg border-2 border-link bg-card p-3 font-bold no-underline">
            会社から返事が届いています（{data.unreadReplies}件）→
          </a>
        )}
        {data.confirmed ? (
          <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">
            {data.confirmed.at} に確認しました（版 {data.confirmed.version}）
          </p>
        ) : (
          <p className="text-sm">
            中身を見て、合っていれば
            <a href="#confirm" className="font-bold">
              いちばん下の「内容を確認しました」
            </a>
            を押してください。
          </p>
        )}
      </div>

      <div className="mt-4">
        <StatementView
          view={v}
          account={data.account}
          lineAction={(t) => <AskButton token={token} lineKey={t.key} label={t.label} count={threadCount.get(t.key) ?? 0} disabled={staffPreview} />}
        />
      </div>

      <section id="confirm" className="mt-6 scroll-mt-4">
        <h2 className="mb-2 text-lg font-bold">確認</h2>
        <ConfirmForm token={token} version={v.version} confirmed={data.confirmed} disabled={staffPreview} />
      </section>

      <section id="questions" className="mt-8 scroll-mt-4">
        <h2 className="text-lg font-bold">質問・会社とのやりとり</h2>
        <p className="mt-1 text-sm text-muted-foreground">分からないところ・違うと思うところは、ここから会社へ送れます。電話をしなくても大丈夫です。</p>
        {data.threads.length > 0 && (
          <div className="mt-3 space-y-3">
            {data.threads.map((t) => (
              <div key={t.lineKey ?? "_all"} id={`thread-${t.lineKey ?? "all"}`} className="scroll-mt-4 rounded-card border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">{t.label}について</h3>
                  {t.messages.some((m) => m.author === "driver") && (
                    <span className={`text-xs font-bold ${t.open > 0 ? "text-warning" : "text-success"}`}>{t.open > 0 ? "会社が確認中" : "解決しました"}</span>
                  )}
                </div>
                <ol className="mt-2 space-y-2">
                  {t.messages.map((m) => (
                    <li key={m.id} className={m.author === "driver" ? "ml-6 rounded-lg border border-border p-2" : "mr-6 rounded-lg bg-muted p-2"}>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-bold text-foreground">{m.author === "driver" ? "あなた" : "会社"}</span>・{m.at}
                        {m.author === "staff" && !m.read && <span className="ml-2 font-bold text-link">新しい返事</span>}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          <GeneralAskForm token={token} disabled={staffPreview} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">保存する</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <a href={`/api/s/${enc}/pdf`} className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground no-underline">
            この明細を PDF で保存
          </a>
          <a href={`/api/s/${enc}/csv`} className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground no-underline">
            今年の支払の一覧（CSV）
          </a>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">確定申告の資料づくりにお使いください。税金の判断は税理士・税務署にご確認ください。</p>
        {data.year.rows.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-bold">{data.year.year}年の振込（締めた月と、この明細）</p>
            <TableWrap>
              <table className="mt-1 w-full min-w-[18rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-normal">月</th>
                    <th className="py-2 pr-2 text-right font-normal">振込額</th>
                    <th className="py-2 text-right font-normal">振込予定日</th>
                  </tr>
                </thead>
                <tbody>
                  {data.year.rows.map((r) => (
                    <tr key={r.month} className={`border-b border-border ${r.current ? "font-bold" : ""}`}>
                      <td className="py-2 pr-2">{r.label}</td>
                      <td className="num py-2 pr-2 text-right">{en(r.total)}</td>
                      <td className="py-2 text-right">{jpDate(r.payDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}
      </section>

      <footer className="mt-10 space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>このページは {data.companyName} からあなたに届いた明細です。リンクをほかの人に送らないでください。</p>
        <p>このリンクは {data.linkExpiresText} まで使えます。{data.closed ? "この月は締め済みです（確認と質問はこのままできます）。" : ""}</p>
      </footer>
    </main>
  );
}
