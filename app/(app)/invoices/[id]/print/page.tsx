/**
 * 印刷用の請求書ページ（ブラウザ印刷）。内容は PDF（lib/pdf/invoice.tsx）と同じ。
 * 金額は DB が計算した値（InvoiceData）をそのまま表示する。
 */
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { itemUnitLabel, loadInvoiceData } from "@/lib/invoice";
import { exportUrls } from "@/lib/exports/urls";
import { uuidSchema } from "@/lib/schemas/common";
import { yen, qty as qtyText } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { PrintButton } from "@/components/invoices/print-button";
import { cn } from "@/lib/utils";

export const metadata = { title: "請求書（印刷用）" };
export const dynamic = "force-dynamic";

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  main { padding: 0 !important; }
  .print-sheet { max-width: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .print-sheet tr { break-inside: avoid; }
  .print-sheet thead { display: table-header-group; }
  .print-sheet img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

function Amt({ value, className }: { value: number; className?: string }) {
  return <span className={cn("num", value < 0 && "text-red-700", className)}>{yen(value)}</span>;
}

const th = "px-1 py-1.5 text-xs font-medium text-neutral-600";
const td = "px-1 py-1.5 align-top";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, company } = await requireStaff();

  const d = await loadInvoiceData(supabase, company.id, id);
  if (!d) notFound();

  return (
    <div>
      <style>{PRINT_CSS}</style>

      {/* 操作（印刷時は非表示） */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <MonthLink href={`/invoices/${d.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4" />
          戻る
        </MonthLink>
        <PrintButton />
        <a href={exportUrls.invoicePdf(d.id)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <Download className="h-4 w-4" />
          PDF
        </a>
        <p className="w-full text-xs text-muted-foreground sm:w-auto">A4 縦で印刷されます。ヘッダー・フッターはブラウザの印刷設定で外してください。</p>
      </div>

      <article className="print-sheet mx-auto w-full max-w-[210mm] rounded-lg border border-neutral-300 bg-white p-4 text-sm text-black shadow-sm sm:p-8">
        {/* 右上：請求書番号・発行日 */}
        <div className="text-right text-xs text-neutral-600">
          <p>請求書番号 {d.invoiceNo}</p>
          <p>発行日 {d.issueDateLabel}</p>
        </div>

        {/* 中央：タイトル */}
        <h1 className="my-3 text-center text-2xl font-bold tracking-[0.3em]">請求書</h1>

        {/* 左：宛名 */}
        <div>
          <p className="inline-block min-w-[12rem] border-b border-black pb-1 text-lg font-bold">
            {d.client.name} {d.client.honorific}
          </p>
          {d.client.address && <p className="mt-1 text-xs text-neutral-600">{d.client.address}</p>}
          {d.client.invoiceRegNo && <p className="text-xs text-neutral-600">登録番号 {d.client.invoiceRegNo}</p>}
          <p className="mt-2 text-xs text-neutral-700">下記のとおりご請求申し上げます。</p>
        </div>

        {/* ご請求金額（税込） */}
        <section className="mt-3 rounded border border-black p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <span className="text-base font-bold">ご請求金額（税込）</span>
            <Amt value={d.total} className="text-2xl font-bold" />
          </div>
        </section>

        <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-600">
          <span>対象月：{d.monthLabel}</span>
          {d.dueDateLabel && <span>お支払い期限：{d.dueDateLabel}</span>}
        </div>

        {/* 明細 */}
        <section className="mt-5">
          <h2 className="border-b border-black pb-1 text-sm font-bold">ご請求明細</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-500 bg-neutral-100">
                <th className={cn(th, "text-left")}>内容</th>
                <th className={cn(th, "text-right")}>数量</th>
                <th className={cn(th, "text-center")}>単位</th>
                <th className={cn(th, "text-right")}>単価</th>
                <th className={cn(th, "text-right")}>金額</th>
              </tr>
            </thead>
            <tbody>
              {d.items.length === 0 ? (
                <tr className="border-b border-neutral-300">
                  <td className={cn(td, "text-neutral-600")} colSpan={5}>
                    明細はありません
                  </td>
                </tr>
              ) : (
                d.items.map((it) => (
                  <tr key={it.id} className="border-b border-neutral-300">
                    <td className={td}>{it.name}</td>
                    <td className={cn(td, "num")}>{qtyText(it.qty)}</td>
                    <td className={cn(td, "text-center text-xs")}>{itemUnitLabel(it.unit) || "—"}</td>
                    <td className={cn(td, "num")}>{yen(it.unitPrice)}</td>
                    <td className={cn(td, "text-right")}>
                      <Amt value={it.amount} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-b border-black font-bold">
                <td className={td}>小計（税抜）</td>
                <td className={td} />
                <td className={td} />
                <td className={td} />
                <td className={cn(td, "text-right")}>
                  <Amt value={d.subtotal} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* 小計・消費税・合計 */}
        <section className="mt-4 ml-auto w-full max-w-xs">
          <dl>
            <div className="flex justify-between border-b border-neutral-300 py-1">
              <dt>小計（税抜）</dt>
              <dd>
                <Amt value={d.subtotal} />
              </dd>
            </div>
            <div className="flex justify-between border-b border-neutral-300 py-1">
              <dt>消費税（{d.taxRateLabel}）</dt>
              <dd>
                <Amt value={d.tax} />
              </dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-black pt-2 text-base font-bold">
              <dt>合計（税込）</dt>
              <dd>
                <Amt value={d.total} />
              </dd>
            </div>
          </dl>
        </section>

        {/* 備考 */}
        {d.note && (
          <section className="mt-5">
            <h2 className="border-b border-black pb-1 text-sm font-bold">備考</h2>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">{d.note}</p>
          </section>
        )}

        {/* 右下：ロゴ・自社情報・認印 */}
        <section className="mt-6 flex justify-end">
          <div className="text-xs text-neutral-700 sm:text-right">
            {d.company.logoPath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/company-asset/logo?v=${encodeURIComponent(d.company.logoPath)}`} alt="" className="mb-1 max-h-12 w-auto sm:ml-auto" />
            )}
            <div className="flex items-start gap-1 sm:justify-end">
              <div>
                <p className="text-sm font-bold text-black">{d.company.name}</p>
                {d.company.address && <p>{d.company.address}</p>}
                {d.company.tel && <p>TEL {d.company.tel}</p>}
                {d.company.invoiceRegNo && <p>登録番号 {d.company.invoiceRegNo}</p>}
              </div>
              {d.company.sealPath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/company-asset/seal?v=${encodeURIComponent(d.company.sealPath)}`} alt="" className="-ml-2 -mt-1 h-12 w-12 shrink-0" />
              )}
            </div>
          </div>
        </section>

        <footer className="mt-6 flex justify-between text-[10px] text-neutral-500">
          <span>
            {d.company.name} / 請求書 {d.invoiceNo} / {d.client.name} {d.client.honorific}
          </span>
        </footer>
      </article>
    </div>
  );
}
