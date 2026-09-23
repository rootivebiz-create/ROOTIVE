import type { Metadata } from "next";
import Link from "next/link";
import { Card, Input, Money, TableWrap } from "@/components/ui";
import { jpToday } from "@/lib/format";
import { Badge } from "~/components/page";
import { DiffAmount } from "~/components/reconcile/bits";
import { PrintButton } from "~/components/reconcile/forms";
import { FoundMoneyCard } from "~/components/reconcile/found-money";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { foundMoneyFromReport, loadReport, reportRange, type ReportCell } from "~/server/features/reconcile";
import { amountText, formulaText, KIND_LABEL, STATUS_LABEL, STATUS_TONE, WAIT_ALERT_DAYS, waitingDays } from "~/server/features/reconcile/labels";
import { closingDayText, periodText } from "~/server/features/reconcile/period";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata: Metadata = { title: "元請の支払通知の突合レポート" };

/** 印刷のとき：アプリの枠（上のメニュー・横のメニュー・デモの帯）と操作のボタンを消す */
const PRINT_CSS = `
@media print {
  header, nav, .no-print { display: none !important; }
  .min-h-dvh > div.bg-accent:first-child { display: none !important; }
  main { padding: 0 !important; }
  .report-card { break-inside: avoid; }
  .report-table th, .report-table td { border: 1px solid #000; padding: 2px 4px; }
  a { text-decoration: none; color: #000; }
}
`;

/** 何か月分かの突合をまとめたレポート（お試しの「過去3か月の突合」の成果物） */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const { from, to } = reportRange(sp.from, sp.to, monthFromParam(undefined));
  const db = await getDb();
  const report = await loadReport(db, user.tenantId, from, to);
  const period = from === to ? monthLabelJa(from) : `${monthLabelJa(from)}〜${monthLabelJa(to)}`;
  const withNotice = report.cells.filter((c) => c.notice);
  const missing = report.cells.filter((c) => !c.notice);
  const detailed = withNotice.filter((c) => c.items.length > 0 || c.facts.length > 0 || c.zeroRate.length > 0);
  const now = new Date();
  const found = foundMoneyFromReport(report, now);
  const dateText = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

  return (
    <div className="mx-auto max-w-4xl">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-4 space-y-3">
        <p className="text-sm">
          <Link href={`/reconcile?m=${monthParam(to)}`} className="inline-flex min-h-11 items-center">← 突合の一覧へ</Link>
        </p>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block">
            <span className="block text-sm font-bold">はじめの月</span>
            <Input type="month" name="from" defaultValue={monthParam(from)} className="mt-1" />
          </label>
          <label className="block">
            <span className="block text-sm font-bold">おわりの月</span>
            <Input type="month" name="to" defaultValue={monthParam(to)} className="mt-1" />
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground hover:bg-muted">
            この期間で見る
          </button>
        </form>
        <div className="flex flex-col gap-2 sm:flex-row">
          <PrintButton />
          <a
            href={`/api/reconcile/items?from=${monthParam(from)}&to=${monthParam(to)}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground no-underline hover:bg-muted"
          >
            差の一覧を CSV で
          </a>
        </div>
        <p className="text-xs text-muted-foreground">12 か月まで選べます。印刷の画面で「PDF に保存」を選ぶと、そのまま渡せる PDF になります（A4 縦）。</p>
      </div>

      <div className="border-b-2 border-foreground pb-3">
        <h1 className="text-2xl font-bold">元請の支払通知の突合レポート</h1>
        <p className="mt-1 text-sm">
          {report.tenantName}　対象：{period}分　作成：{jpToday()}
        </p>
      </div>

      <Card className="report-card mt-4">
        <p className="text-sm">
          このレポートは、当社の稼働の記録（数量 × 案件の受注単価、税抜）と、元請から届いたお支払通知を、案件ごとに突き合わせた結果です。
          ここに出ている差は、両方の<strong>「記録の違い」</strong>です。払われていない額と決まったものではありません。どちらの記録が正しいかは、元請にご確認ください。
        </p>
      </Card>

      <FoundMoneyCard
        className="report-card mt-4"
        title={`見つけたお金（${period}分）`}
        found={found}
        over={report.totals.over}
        overCount={report.totals.overCount}
        scope={`${report.totals.notices}通のお支払通知`}
        showMonths
      />
      <Card className="report-card mt-3">
        <p className="text-sm">
          突き合わせたお支払通知：<span className="font-bold">{report.totals.notices}通</span>
          <span className="ml-2 text-xs text-muted-foreground">{missing.length > 0 ? `お支払通知の無い月 ${missing.length}件（下にまとめています）` : "記録のある月はすべて突き合わせ済み"}</span>
        </p>
      </Card>

      <section className="report-card mt-6">
        <h2 className="text-lg font-bold">元請 × 月のまとめ</h2>
        {report.cells.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">この期間には、稼働の記録もお支払通知もありません。期間を変えてください。</p>
        ) : (
          <TableWrap>
            <table className="report-table mt-2 w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-normal">元請</th>
                  <th className="py-2 pr-2 font-normal">月</th>
                  <th className="py-2 pr-2 text-right font-normal">当社の記録</th>
                  <th className="py-2 pr-2 text-right font-normal">お支払通知</th>
                  <th className="py-2 pr-2 text-right font-normal">少ない可能性</th>
                  <th className="py-2 pr-2 text-right font-normal">多い可能性</th>
                  <th className="py-2 font-normal">扱い</th>
                </tr>
              </thead>
              <tbody>
                {report.cells.map((c) => (
                  <SummaryRow key={`${c.clientId}:${c.month}`} cell={c} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      {detailed.map((c) => (
        <section key={`${c.clientId}:${c.month}:detail`} className="report-card mt-6">
          <h2 className="text-lg font-bold">
            {c.clientName}　{monthLabelJa(c.month)}分
            {c.notice && (
              <Link href={`/reconcile/${c.notice.id}`} className="no-print ml-2 text-sm font-normal">
                結果の画面へ
              </Link>
            )}
          </h2>
          {c.period?.differs && (
            <p className={`mt-1 text-xs ${c.period.mode === "closing" ? "text-muted-foreground" : "text-warning"}`}>
              {c.period.mode === "closing"
                ? `※ 締め日 毎月${closingDayText(c.period.closingDay)}：${periodText(c.period)} の稼働で比べています。`
                : `※ 締め日が違うため月単位で比べています（稼働に日付がありません。当社の記録は ${periodText(c.period)} の分）。`}
            </p>
          )}
          {c.stale && <p className="mt-1 text-xs text-warning">※ 保存してある突き合わせの結果と、今の記録が違います。ここでは今の記録で計算しています（結果の画面で「突き合わせ直す」を押すと、そろいます）。</p>}
          {c.zeroRate.length > 0 && (
            <p className="mt-1 text-xs text-danger">※ 受注単価が 0 円の案件があります（{c.zeroRate.join("・")}）。この案件の当社の記録は 0 円で数えているため、差は正しくありません。</p>
          )}
          {c.items.length > 0 && (
            <TableWrap>
              <table className="report-table mt-2 w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-2 font-normal">内容</th>
                    <th className="py-2 pr-2 font-normal">当社の記録</th>
                    <th className="py-2 pr-2 font-normal">お支払通知</th>
                    <th className="py-2 pr-2 text-right font-normal">差</th>
                    <th className="py-2 font-normal">扱い・メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((it) => (
                    <tr key={it.key} className="border-b border-border align-top">
                      <td className="py-2 pr-2">
                        <span className="font-bold">{it.label}</span>
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {KIND_LABEL[it.kind]}
                          {it.split ? "（数量と単価に分けて計算）" : ""}
                          {!it.current ? "（今は差なし・片付いた記録）" : ""}
                        </span>
                      </td>
                      <td className="num py-2 pr-2">{it.kind === "extra" ? "対応する案件なし" : formulaText(it.ourQty, it.ourPrice, it.ourAmount, it.unit)}</td>
                      <td className="num py-2 pr-2">{it.kind === "missing" ? "行なし" : formulaText(it.theirQty, it.theirPrice, it.theirAmount, it.kind === "extra" ? null : it.unit)}</td>
                      <td className="py-2 pr-2 text-right">
                        <DiffAmount value={it.diff} />
                      </td>
                      <td className="py-2">
                        <Badge tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</Badge>
                        {it.status === "asked" && it.askedAt && (
                          <p className={`mt-1 text-xs ${(waitingDays(it.status, it.askedAt, now) ?? 0) >= WAIT_ALERT_DAYS ? "font-bold text-warning" : ""}`}>
                            {dateText(it.askedAt)} に問い合わせ（{waitingDays(it.status, it.askedAt, now)}日）
                          </p>
                        )}
                        {it.status === "resolved" && it.recoveredAmount !== null && <p className="mt-1 text-xs">取り戻せた額 {amountText(it.recoveredAmount)}</p>}
                        {it.note && <p className="mt-1 text-xs">{it.note}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {c.facts.map((f) => (
            <p key={f.code} className="mt-2 rounded-lg border border-border p-3 text-sm">
              <span className="font-bold">{f.title}</span>：{f.detail}
            </p>
          ))}
        </section>
      ))}

      {missing.length > 0 && (
        <section className="report-card mt-6">
          <h2 className="text-lg font-bold">お支払通知がまだ無い月</h2>
          <p className="mt-1 text-sm text-muted-foreground">当社に稼働の記録がある月です。お支払通知を上げると、突き合わせます。</p>
          <ul className="mt-2 space-y-1 text-sm">
            {missing.map((c) => (
              <li key={`${c.clientId}:${c.month}:missing`} className="flex flex-wrap justify-between gap-2 border-b border-border py-1">
                <span>
                  {c.clientName}　{monthLabelJa(c.month)}分
                  {c.period?.differs && (
                    <span className={`block text-xs ${c.period.mode === "closing" ? "text-muted-foreground" : "text-warning"}`}>
                      {c.period.mode === "closing" ? `締め日 毎月${closingDayText(c.period.closingDay)}：${periodText(c.period)} の稼働` : "締め日が違うため月単位で比べています（稼働に日付がありません）"}
                    </span>
                  )}
                </span>
                <span>
                  当社の記録 <Money value={c.ourTotal} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-border pt-3 text-xs text-muted-foreground">
        <p>
          当社の記録は、しめ日ラボに入っている稼働の数量と、案件の受注単価（税抜。締めた月は締めたときの明細の写しの単価）から計算しています。
          元請の締め日が月末でないときは、日付のある稼働から、その締めの期間の分を数えています（日付が無いときは当社の月で比べ、その旨を書いています）。
          見つけたお金の「確定」は「解決」にして取り戻せた額を入れた差の合計、「見込み」はまだ片付いていない差のうち受け取りが少ない可能性の額の合計で、2 つは足していません。お支払通知の金額は、取り込んだファイルの税抜の金額です（消費税・振込手数料の行は除いています）。
          数量も単価も同じで、端数の扱いだけで 1 円ほど違うものは、差に数えていません。
          数量と単価の両方が違う差は、数量の差（当社の単価で計算）と単価の差（お支払通知の数量で計算）に分けて出しています。2 つを足すと差の全体になります。
        </p>
        <p className="mt-1">しめ日ラボで作成</p>
      </footer>
    </div>
  );
}

function SummaryRow({ cell: c }: { cell: ReportCell }) {
  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-2">{c.clientName}</td>
      <td className="py-2 pr-2 whitespace-nowrap">{monthLabelJa(c.month)}</td>
      <td className="py-2 pr-2 text-right">
        <Money value={c.ourTotal} />
      </td>
      <td className="py-2 pr-2 text-right">{c.notice ? <Money value={c.notice.theirTotal} /> : <span className="text-muted-foreground">未登録</span>}</td>
      <td className="py-2 pr-2 text-right">{c.notice ? <DiffAmount value={-c.short} /> : "−"}</td>
      <td className="py-2 pr-2 text-right">{c.notice ? <DiffAmount value={c.over} /> : "−"}</td>
      <td className="py-2 text-xs">
        {!c.notice
          ? "お支払通知なし"
          : c.notice.lineCount === 0
            ? "列が未確認"
            : c.items.length === 0
              ? "差なし"
              : [c.open ? `未対応 ${c.open}` : "", c.asked ? `問い合わせ済み ${c.asked}` : "", c.settled ? `片付いた ${c.settled}` : ""].filter(Boolean).join("・")}
      </td>
    </tr>
  );
}
