"use client";

import Link from "next/link";
import { Button, buttonClass, Card, Money, TableWrap } from "@/components/ui";
import { cx } from "@/lib/cx";
import { jpDate, jpMonth } from "@/lib/format";
import type { MonthSummary, Statement } from "@/lib/payroll/calc";
import { pct } from "@/lib/payroll/money";
import type { MonthData } from "@/lib/payroll/types";
import { qtyText, unitPrice } from "./format";
import { Disclosure, InvoiceBadge, SectionTitle, td, tdNum, th, thNum } from "./parts";

type Props = { data: MonthData; summary: MonthSummary; storageOk: boolean };

export function StatementsTab({ data, summary, storageOk }: Props) {
  const { statements } = summary;
  const withStatement = new Set(statements.map((st) => st.driver.id));
  const idle = data.drivers.filter((d) => !withStatement.has(d.id));

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {jpMonth(data.settings.month)}分・振込日 {jpDate(data.settings.payDate)}
          </p>
          <p className="mt-1 text-sm">
            振込額の合計（{statements.length} 人）
            <Money value={summary.payout} className="ml-2 text-2xl font-bold" />
          </p>
        </div>
        {statements.length === 0 ? (
          <Button type="button" disabled className="w-full sm:w-auto">
            全員分を印刷・PDF
          </Button>
        ) : (
          <Link href="/demo/print" target="_blank" rel="noopener" className={buttonClass("primary", "w-full sm:w-auto")}>
            全員分を印刷・PDF
          </Link>
        )}
      </Card>

      {!storageOk && (
        <p className="rounded-lg border border-warning px-3 py-2 text-sm text-warning">
          この端末では保存が使えないため、印刷の画面にはサンプルのデータが出ます。
        </p>
      )}

      <section>
        <SectionTitle>ドライバーごとの支払明細</SectionTitle>
        <p className="mt-1 text-sm text-muted-foreground">押すと内訳が開きます。</p>
        {statements.length === 0 ? (
          <Card className="mt-3 text-sm text-muted-foreground">稼働の画面で数量を入れると、ここに明細ができます。</Card>
        ) : (
          <ul className="mt-3 space-y-3">
            {statements.map((st) => (
              <li key={st.driver.id}>
                <Disclosure
                  summary={
                    <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-bold">{st.driver.name || "（名前なし）"}</span>
                        <InvoiceBadge registered={st.driver.invoiceRegistered} />
                      </span>
                      <span className="text-right">
                        <span className="mr-2 text-xs text-muted-foreground">振込額</span>
                        <Money value={st.total} className="text-xl font-bold" />
                      </span>
                    </span>
                  }
                >
                  <StatementDetail st={st} data={data} />
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
        {idle.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            稼働も調整もない方（{idle.map((d) => d.name || "名前なし").join("・")}）の明細は作りません。
          </p>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, strong, note }: { label: string; value: number; strong?: boolean; note?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 py-1.5", strong && "border-t border-border pt-2")}>
      <dt className={cx("min-w-0 text-sm", strong && "font-bold")}>
        {label}
        {note && <span className="ml-1 text-xs text-muted-foreground">{note}</span>}
      </dt>
      <dd>
        <Money value={value} className={strong ? "text-lg font-bold" : undefined} />
      </dd>
    </div>
  );
}

function StatementDetail({ st, data }: { st: Statement; data: MonthData }) {
  const s = data.settings;
  const reg = st.driver.invoiceRegistered;
  const rate = pct(s.taxRate);
  return (
    <div>
      {st.lines.length > 0 && (
        <TableWrap>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th} scope="col">
                  案件
                </th>
                <th className={thNum} scope="col">
                  数量
                </th>
                <th className={thNum} scope="col">
                  単価
                </th>
                <th className={thNum} scope="col">
                  金額
                </th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l) => (
                <tr key={l.projectId}>
                  <td className={td}>
                    <span className="block">{l.projectName}</span>
                    {l.client && <span className="block text-xs text-muted-foreground">{l.client}</span>}
                  </td>
                  <td className={tdNum}>
                    {qtyText(l.qty)} {l.unit}
                  </td>
                  <td className={tdNum}>{unitPrice(l.rate)}</td>
                  <td className={tdNum}>
                    <Money value={l.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <dl className="mt-3">
        <Row label="委託料（税抜）" value={st.subtotal} />
        <Row
          label={reg ? `消費税（${rate}）` : `消費税相当額（${rate}）`}
          value={st.tax}
          note={!reg && !s.payTaxToExempt ? "免税の方には払わない設定" : undefined}
        />
        {st.royalty > 0 && <Row label={`ロイヤリティ（委託料の ${pct(st.driver.royaltyRate)}）`} value={-st.royalty} />}
        {st.fee > 0 && <Row label="管理費" value={-st.fee} />}
        {st.deductionTax > 0 && <Row label={`控除の消費税（${rate}）`} value={-st.deductionTax} note="ロイヤリティ・管理費の分" />}
        {st.adjustments.map((a, i) => (
          <Row key={i} label={`調整：${a.label}`} value={a.amount} note="消費税の対象外" />
        ))}
        <Row label="振込額" value={st.total} strong />
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/demo/print?driver=${encodeURIComponent(st.driver.id)}`}
          target="_blank"
          rel="noopener"
          className={buttonClass("secondary", "w-full sm:w-auto")}
        >
          この明細を印刷・PDF
        </Link>
      </div>
      {!st.driver.bank && <p className="mt-2 text-xs text-warning">口座が未登録のため、振込データには入りません。</p>}
    </div>
  );
}
