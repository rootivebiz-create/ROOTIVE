import Link from "next/link";
import { Money, TableWrap, buttonClass } from "@/components/ui";
import { jpToday } from "@/lib/format";
import { PrintButton } from "~/components/parallel/print-button";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { GOLIVE_STREAK_TARGET, loadParallelReport } from "~/server/features/parallel";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "並行運用の比べ合わせ" };

/** 印刷のとき：アプリの枠（上のメニュー・横のメニュー・デモの帯）と操作のボタンを消す */
const PRINT_CSS = `
@media print {
  header, nav, .no-print { display: none !important; }
  .min-h-dvh > div.bg-accent:first-child { display: none !important; }
  main { padding: 0 !important; }
  .report-table th, .report-table td { border: 1px solid #000; padding: 2px 4px; }
  .report-table { font-size: 9pt; }
  a { text-decoration: none; color: #000; }
}
`;

/** 並行運用の比べ合わせ（1 枚の報告）。社長・顧問の方に見せる・残す用 */
export default async function ParallelReportPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const m = monthParam(month);
  const db = await getDb();
  // 画面・PDF と同じ中身（loadParallelReport）から作る
  const report = await loadParallelReport(db, user.tenantId, month);
  const { view: v, golive, history, gate } = report;
  const compared = v.rows.filter((r) => r.excelTotal !== null);
  const notCompared = v.rows.filter((r) => r.excelTotal === null);
  const oursTotal = report.totals.ours;
  const excelTotal = report.totals.excel;

  return (
    <div className="mx-auto max-w-4xl">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link href={`/parallel?m=${m}`} className="inline-flex min-h-11 items-center text-sm">
          ← Excel と比べる へ戻る
        </Link>
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
          {compared.length > 0 && (
            <a href={`/api/parallel/pdf?m=${m}`} className={buttonClass("secondary", "w-full sm:w-auto")}>
              PDF（A4 1 枚）をダウンロード
            </a>
          )}
          <PrintButton />
        </div>
      </div>

      <article className="space-y-4 rounded-card border border-border bg-card p-4 sm:p-6">
        {/* 印刷の指定がアプリの header を消すので、ここは div にする */}
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{report.companyName}</p>
          <h1 className="text-2xl font-bold">並行運用の比べ合わせ（{monthLabelJa(month)}分）</h1>
          <p className="text-sm text-muted-foreground">作成日：{jpToday()}</p>
        </div>

        <section className="space-y-1">
          <p className="text-xl font-bold">{v.summary.sentence}</p>
          {compared.length > 0 && (
            <p className="text-sm">
              比べた {compared.length}人の振込額の合計：しめ日ラボ <Money value={oursTotal} />・Excel <Money value={excelTotal} />・差 <Money value={oursTotal - excelTotal} />
            </p>
          )}
          {v.summary.different > 0 && (
            <p className="text-sm">
              差のある {v.summary.different}人：払い不足の可能性（Excel の方が少ない） <Money value={v.summary.oursHigher} />／払いすぎの可能性（Excel の方が多い） <Money value={v.summary.excelHigher} />
              {v.summary.unexplained > 0 ? `（理由のメモがまだ無い人 ${v.summary.unexplained}人）` : "（全員に理由のメモあり）"}
            </p>
          )}
          {notCompared.length > 0 && <p className="text-sm text-muted-foreground">Excel の額が入っていない人：{notCompared.map((r) => r.name).join("、")}</p>}
          <p className="text-sm">
            直近 3 か月：
            {history.months
              .map((h) => `${monthLabelJa(h.month)}分 ${h.state === "ok" ? "一致・説明済み" : h.state === "diff" ? `${h.compared}人中 ${h.matched}人が一致` : "比べていません"}`)
              .join("／")}
            。続けて一致（または説明済み）の月は {history.streak} か月です（目安は {GOLIVE_STREAK_TARGET}〜3 か月）。
          </p>
          {golive ? (
            <p className="text-sm font-bold">{monthLabelJa(golive)}分から、しめ日ラボで締めています。</p>
          ) : gate.ready ? (
            <p className="text-sm font-bold">本番に切り替える条件（比べた人が全員一致か、差のある人全員に理由のメモがある）がそろっています。</p>
          ) : (
            <div className="text-sm">
              <p className="font-bold">本番に切り替える前に、次のことが残っています。</p>
              <ul className="list-disc pl-5">
                {gate.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {compared.length === 0 ? (
          <p className="text-sm">まだ Excel の額が入っていません。「Excel と比べる」の画面で入れてから、もう一度開いてください。</p>
        ) : (
          <TableWrap>
            <table className="report-table w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-2">ドライバー</th>
                  <th className="py-2 pr-2 text-right">しめ日ラボ</th>
                  <th className="py-2 pr-2 text-right">Excel</th>
                  <th className="py-2 pr-2 text-right">差</th>
                  <th className="py-2">理由の見当・メモ</th>
                </tr>
              </thead>
              <tbody>
                {compared.map((r) => (
                  <tr key={r.driverId} className="border-b border-border align-top">
                    <td className="py-2 pr-2">
                      {r.name}
                      {r.code && <span className="ml-1 text-xs text-muted-foreground">{r.code}</span>}
                    </td>
                    <td className="py-2 pr-2 text-right">{r.ours === null ? "明細なし" : <Money value={r.ours} />}</td>
                    <td className="py-2 pr-2 text-right">
                      <Money value={r.excelTotal ?? 0} />
                    </td>
                    <td className="py-2 pr-2 text-right font-bold">
                      <Money value={r.diff ?? 0} />
                    </td>
                    <td className="py-2">
                      {r.diff === 0 ? "一致" : r.explanations[0]?.title}
                      {r.diff !== 0 && r.explanations.length > 1 && <span className="block text-xs text-muted-foreground">ほかに：{r.explanations.slice(1).map((e) => e.title).join("・")}</span>}
                      {r.note && <span className="block text-xs">メモ：{r.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        <section className="space-y-1 border-t border-border pt-3 text-sm">
          <p className="font-bold">これからの進め方</p>
          <p>2〜3 か月、しめ日ラボと Excel の両方で締めて、差が 0 になったら Excel をやめてください。差が出た月は、どちらの計算に合わせるかを取引条件をもとに決めて、メモに残しておくと、あとで経緯が分かります。</p>
          <p className="text-xs text-muted-foreground">
            「払い不足・払いすぎの可能性」は、しめ日ラボの計算（登録した単価・控除・端数の設定）を基準にしたときの見え方です。どちらの計算が取引条件に合っているかは、会社で確かめてください。
          </p>
          <p className="text-xs text-muted-foreground">
            「理由の見当」は、差の額が明細の部品（消費税・控除・調整・源泉徴収・端数）と同じ額か、ある行の数量・単価の違いで説明できるかを探したものです。当てはまっても別の理由のことがあります。しめ日ラボの額は
            {v.closed ? "締めた月の明細" : "保存した明細（無ければ今の稼働から出した見込み）"}です。
          </p>
        </section>
      </article>
    </div>
  );
}
