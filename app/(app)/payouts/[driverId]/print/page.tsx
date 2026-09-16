/**
 * 印刷用の支払明細ページ（§8.3「ブラウザの印刷用ページ」）。内容は PDF と同じで、会社利益は載せない。
 * スタッフは任意のドライバー・月、driver ロールは自分の締め済み月のみ（※ app/(app)/layout.tsx の requireStaff により
 * 現状 driver はこのページに到達できない。ドライバーポータルからは PDF を案内する）。
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { getSessionContext } from "@/lib/auth/session";
import { loadStatementData, type StatementData } from "@/lib/statement";
import { monthFromParam, formatDateJa } from "@/lib/month";
import { uuidSchema } from "@/lib/schemas/common";
import { exportUrls } from "@/lib/exports/urls";
import { yen, pct, qty as qtyText } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const metadata = { title: "支払明細（印刷用）" };
export const dynamic = "force-dynamic";

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  main { padding: 0 !important; }
  .print-sheet { max-width: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .print-sheet tr { break-inside: avoid; }
  .print-sheet thead { display: table-header-group; }
}
`;

function Amt({ value, className }: { value: number; className?: string }) {
  return <span className={cn("num", value < 0 && "text-red-700", className)}>{yen(value)}</span>;
}

function entryName(e: StatementData["entries"][number]): string {
  return e.itemName && e.itemName !== "標準" ? `${e.projectName}（${e.itemName}）` : e.projectName;
}

const th = "px-1 py-1.5 text-xs font-medium text-neutral-600";
const td = "px-1 py-1.5 align-top";

export default async function StatementPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { driverId } = await params;
  const sp = await searchParams;
  const month = monthFromParam(sp.m);

  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/payouts/${driverId}/print?m=${month}`)}`);
  if (!uuidSchema.safeParse(driverId).success) notFound();

  const isDriver = ctx.profile.role === "driver";
  if (isDriver && ctx.profile.driver_id !== driverId) redirect("/driver");

  const data = await loadStatementData(ctx.supabase, ctx.company, month, driverId);
  if (!data) notFound();

  const backHref = isDriver ? "/driver" : `/payouts/${encodeURIComponent(driverId)}/statement?m=${encodeURIComponent(month)}`;

  if (isDriver && !data.isClosed) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="warning">{data.monthLabel} の明細はまだ集計中です。締め処理が完了すると表示できます。</Alert>
        <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}>
          <ArrowLeft className="h-4 w-4" />
          戻る
        </Link>
      </div>
    );
  }

  const showRoyaltyRate = isDriver ? ctx.company.driver_portal_show_royalty : true;
  const s = data;
  const deductionTotal = -s.royalty - s.mgmtFee + s.adjPay;

  return (
    <div>
      <style>{PRINT_CSS}</style>

      {/* 操作（印刷時は非表示） */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4" />
          戻る
        </Link>
        <PrintButton />
        <a href={exportUrls.statementPdf(month, driverId)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <Download className="h-4 w-4" />
          PDF
        </a>
        <p className="w-full text-xs text-muted-foreground sm:w-auto">A4 縦で印刷されます。ヘッダー・フッターはブラウザの印刷設定で外してください。</p>
      </div>

      <article className="print-sheet mx-auto w-full max-w-[210mm] rounded-lg border border-neutral-300 bg-white p-4 text-sm text-black shadow-sm sm:p-8">
        {/* ヘッダー：宛名・タイトル／会社情報 */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">{s.monthLabel} 支払明細書</h1>
            <p className="mt-1 text-base">{s.driverName} 様</p>
            <p className="mt-1 text-xs text-neutral-600">下記のとおりお支払いいたします。</p>
          </div>
          <div className="text-xs text-neutral-700 sm:text-right">
            <p className="text-sm font-bold text-black">{s.company.name}</p>
            {s.company.address && <p>{s.company.address}</p>}
            {s.company.tel && <p>TEL {s.company.tel}</p>}
            {s.company.invoice_reg_no && <p>登録番号 {s.company.invoice_reg_no}</p>}
            <p>発行日 {formatDateJa(s.issuedAt)}</p>
          </div>
        </header>

        {/* お支払額 */}
        <section className="mt-4 rounded border border-black p-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-base font-bold">お支払額</span>
            <Amt value={s.payout} className="text-2xl font-bold" />
          </div>
          <p className="mt-1 text-xs text-neutral-600">振込予定日：{s.payoutDateLabel}</p>
        </section>

        {/* 稼働明細 */}
        <section className="mt-5">
          <h2 className="border-b border-black pb-1 text-sm font-bold">稼働明細</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-500 bg-neutral-100">
                <th className={cn(th, "text-left")}>案件（内容）</th>
                <th className={cn(th, "text-right")}>数量</th>
                <th className={cn(th, "text-right")}>単価</th>
                <th className={cn(th, "text-right")}>金額</th>
                <th className={cn(th, "hidden text-left sm:table-cell print:table-cell")}>備考</th>
              </tr>
            </thead>
            <tbody>
              {s.entries.length === 0 ? (
                <tr className="border-b border-neutral-300">
                  <td className={cn(td, "text-neutral-600")} colSpan={5}>
                    稼働はありません
                  </td>
                </tr>
              ) : (
                s.entries.map((e) => (
                  <tr key={e.id} className="border-b border-neutral-300">
                    <td className={td}>{entryName(e)}</td>
                    <td className={cn(td, "num")}>
                      {qtyText(e.qty)} {e.unit === "day" ? "日" : "個"}
                    </td>
                    <td className={cn(td, "num")}>{yen(e.payRate)}</td>
                    <td className={cn(td, "text-right")}>
                      <Amt value={e.pay} />
                    </td>
                    <td className={cn(td, "hidden text-xs text-neutral-600 sm:table-cell print:table-cell")}>{e.memo}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-b border-black font-bold">
                <td className={td}>稼働小計</td>
                <td className={td} />
                <td className={td} />
                <td className={cn(td, "text-right")}>
                  <Amt value={s.pay} />
                </td>
                <td className={cn(td, "hidden sm:table-cell print:table-cell")} />
              </tr>
            </tfoot>
          </table>
        </section>

        {/* 控除・調整 */}
        <section className="mt-5">
          <h2 className="border-b border-black pb-1 text-sm font-bold">控除・調整</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-500 bg-neutral-100">
                <th className={cn(th, "text-left")}>項目</th>
                <th className={cn(th, "w-32 text-right")}>金額</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-300">
                <td className={td}>ロイヤリティ{showRoyaltyRate && s.royaltyRate != null ? `（${pct(s.royaltyRate)}）` : ""}</td>
                <td className={cn(td, "text-right")}>
                  <Amt value={-s.royalty} />
                </td>
              </tr>
              {s.mgmtFee !== 0 && (
                <tr className="border-b border-neutral-300">
                  <td className={td}>管理費</td>
                  <td className={cn(td, "text-right")}>
                    <Amt value={-s.mgmtFee} />
                  </td>
                </tr>
              )}
              {s.adjustments.map((a) => (
                <tr key={a.id} className="border-b border-neutral-300">
                  <td className={td}>{a.label}</td>
                  <td className={cn(td, "text-right")}>
                    <Amt value={a.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-b border-black font-bold">
                <td className={td}>控除・調整 合計</td>
                <td className={cn(td, "text-right")}>
                  <Amt value={deductionTotal} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* お支払額（再掲） */}
        <section className="mt-5 ml-auto w-full max-w-xs">
          <dl>
            <div className="flex justify-between border-b border-neutral-300 py-1">
              <dt>稼働小計</dt>
              <dd>
                <Amt value={s.pay} />
              </dd>
            </div>
            <div className="flex justify-between border-b border-neutral-300 py-1">
              <dt>控除・調整</dt>
              <dd>
                <Amt value={deductionTotal} />
              </dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-black pt-2 text-base font-bold">
              <dt>お支払額</dt>
              <dd>
                <Amt value={s.payout} />
              </dd>
            </div>
          </dl>
        </section>

        {/* 備考 */}
        {s.company.statement_note && (
          <section className="mt-5">
            <h2 className="border-b border-black pb-1 text-sm font-bold">備考</h2>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">{s.company.statement_note}</p>
          </section>
        )}

        <footer className="mt-6 flex justify-between text-[10px] text-neutral-500">
          <span>
            {s.company.name} / {s.monthLabel} 支払明細書 / {s.driverName} 様
          </span>
        </footer>
      </article>
    </div>
  );
}
