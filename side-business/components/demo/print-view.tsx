"use client";

/**
 * 支払明細書の印刷（A4 縦・1 人 1 ページ）。デモの画面と同じ保存（この端末の中）を読む。
 * 画面の飾り（ツールバー・案内）は .no-print で紙に出さない。紙の上は黒い文字と細い線だけにする。
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { buildStatements, type Statement } from "@/lib/payroll/calc";
import { pct, yen } from "@/lib/payroll/money";
import { sampleData } from "@/lib/payroll/sample";
import type { CompanySettings, MonthData } from "@/lib/payroll/types";
import { jpDate, periodText, qtyText, unitPrice } from "./format";
import { cx } from "./parts";
import { loadMonthData, MONTH_KEY } from "./persist";

type Loaded = { data: MonthData; fromStorage: boolean };

export function DemoPrint() {
  const params = useSearchParams();
  const driverId = params.get("driver");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const load = () => {
      const stored = loadMonthData();
      setLoaded({ data: stored ?? sampleData(), fromStorage: stored !== null });
    };
    load();
    // デモの画面で直したら、開いたままの印刷の画面にも反映する
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === MONTH_KEY) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!loaded) {
    return <p className="py-16 text-center text-muted-foreground">読み込み中…</p>;
  }

  const all = buildStatements(loaded.data);
  const statements = driverId ? all.filter((st) => st.driver.id === driverId) : all;

  return (
    <div>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href="/demo#statements" className={buttonClass("secondary")}>
          ← デモに戻る
        </Link>
        <Button type="button" onClick={() => window.print()} disabled={statements.length === 0} className="ml-auto">
          印刷・PDFにする
        </Button>
      </div>
      <div className="no-print mt-3 space-y-1 text-sm text-muted-foreground">
        <p>
          A4・縦で印刷します。{statements.length > 1 ? `${statements.length} 人分、1 人 1 ページです。` : ""}
          印刷の画面で「PDF に保存」を選ぶと PDF になります。
        </p>
        {!loaded.fromStorage && <p className="text-warning">保存された入力が見つからないため、サンプルのデータで表示しています。</p>}
      </div>

      {statements.length === 0 ? (
        <p className="no-print mt-8 rounded-card border border-border bg-card p-6 text-center text-sm">
          {driverId ? "この方の明細はありません（稼働も調整もありません）。" : "明細がありません。デモの稼働の画面で数量を入れてください。"}
        </p>
      ) : (
        statements.map((st, i) => (
          <StatementSheet key={st.driver.id} st={st} settings={loaded.data.settings} breakAfter={i < statements.length - 1} />
        ))
      )}
    </div>
  );
}

function SumRow({ label, value, note, strong }: { label: string; value: number; note?: string; strong?: boolean }) {
  return (
    <tr className={cx(strong && "border-t-2 border-black")}>
      <th scope="row" className={cx("py-1 pr-3 text-left align-top", strong ? "pt-2 text-base font-bold" : "font-normal")}>
        {label}
        {note && <span className="ml-1 text-[11px] text-neutral-600">{note}</span>}
      </th>
      <td className={cx("num whitespace-nowrap py-1 text-right align-top", strong && "pt-2 text-base font-bold")}>{yen(value)}</td>
    </tr>
  );
}

function StatementSheet({ st, settings: s, breakAfter }: { st: Statement; settings: CompanySettings; breakAfter: boolean }) {
  const reg = st.driver.invoiceRegistered;
  const rate = pct(s.taxRate);
  return (
    <article
      className={cx(
        "mx-auto mt-6 w-full max-w-[210mm] border border-neutral-300 bg-white p-5 text-[13px] leading-normal text-black shadow-sm sm:p-10",
        "print:mt-0 print:max-w-none print:border-0 print:p-0 print:shadow-none",
        breakAfter && "print-break",
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-black pb-2">
        <h1 className="text-xl font-bold tracking-wider sm:text-2xl">{reg ? "支払明細書（兼 仕入明細書）" : "支払明細書"}</h1>
        <span className="rounded-sm border border-neutral-500 px-1.5 text-[11px] text-neutral-700">デモ（架空のデータ）</span>
      </header>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <p className="border-b border-black pb-1 text-lg font-bold">{st.driver.name || "（名前なし）"} 様</p>
          {reg && st.driver.registrationNo && <p className="mt-1 text-xs">登録番号：{st.driver.registrationNo}</p>}
          <p className="mt-3">下記のとおりお支払いします。</p>
        </div>
        <div className="sm:text-right print:text-right">
          <p className="text-xs text-neutral-700">作成者</p>
          <p className="font-bold">{s.companyName}</p>
          {s.companyRegistrationNo && <p className="text-xs">登録番号：{s.companyRegistrationNo}</p>}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-neutral-700">対象期間</dt>
        <dd>{periodText(s.month)}</dd>
        <dt className="text-neutral-700">振込予定日</dt>
        <dd>{jpDate(s.payDate)}</dd>
      </dl>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-2 border-black px-4 py-3">
        <span className="font-bold">お振込額</span>
        <span className="num text-2xl font-bold">{yen(st.total)}</span>
      </div>

      {st.lines.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="mb-1 text-left text-xs text-neutral-700">
              委託の内容（金額は税抜・税率 {rate}）
            </caption>
            <thead>
              <tr className="border-y border-black">
                <th scope="col" className="py-1 pr-2 text-left font-bold">
                  案件
                </th>
                <th scope="col" className="px-2 py-1 text-right font-bold">
                  数量
                </th>
                <th scope="col" className="px-2 py-1 text-right font-bold">
                  単価
                </th>
                <th scope="col" className="py-1 pl-2 text-right font-bold">
                  金額
                </th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l) => (
                <tr key={l.projectId} className="border-b border-neutral-300">
                  <td className="py-1 pr-2">
                    {l.projectName}
                    {l.client && <span className="ml-1 text-[11px] text-neutral-600">（{l.client}）</span>}
                  </td>
                  <td className="num whitespace-nowrap px-2 py-1 text-right">
                    {qtyText(l.qty)} {l.unit}
                  </td>
                  <td className="num whitespace-nowrap px-2 py-1 text-right">{unitPrice(l.rate)}</td>
                  <td className="num whitespace-nowrap py-1 pl-2 text-right">{yen(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <table className="mt-5 ml-auto w-full border-collapse sm:w-3/5 print:w-3/5">
        <tbody>
          <SumRow label={reg ? `${rate}対象の委託料（税抜）` : "委託料（税抜）"} value={st.subtotal} />
          <SumRow
            label={reg ? `消費税額（${rate}）` : `消費税相当額（${rate}）`}
            value={st.tax}
            note={!reg && !s.payTaxToExempt ? "お支払いしない設定" : undefined}
          />
          <SumRow label="委託料（税込）" value={st.subtotal + st.tax} />
          {st.royalty > 0 && <SumRow label={`控除：ロイヤリティ（委託料の ${pct(st.driver.royaltyRate)}）`} value={-st.royalty} />}
          {st.fee > 0 && <SumRow label="控除：管理費" value={-st.fee} />}
          {st.deductionTax > 0 && <SumRow label={`控除：上記の消費税（${rate}）`} value={-st.deductionTax} />}
          {st.adjustments.map((a, i) => (
            <SumRow key={i} label={`調整：${a.label}`} value={a.amount} note="消費税の対象外" />
          ))}
          <SumRow label="お振込額" value={st.total} strong />
        </tbody>
      </table>

      <footer className="mt-8 border-t border-black pt-2 text-xs leading-relaxed">
        <p>記載内容に誤りがある場合は、受け取りから7日以内にご連絡ください。ご連絡がない場合は、内容を確認いただいたものとします。</p>
      </footer>
    </article>
  );
}
