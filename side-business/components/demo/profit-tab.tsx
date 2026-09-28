"use client";

import Link from "next/link";
import { Money, TableWrap } from "@/components/ui";
import { cx } from "@/lib/cx";
import { jpDate, jpMonth } from "@/lib/format";
import type { MonthSummary } from "@/lib/payroll/calc";
import { pct } from "@/lib/payroll/money";
import { deductibleRateForExempt, TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import type { MonthData } from "@/lib/payroll/types";
import { qtyText } from "./format";
import { InvoiceBadge, SectionTitle, td, tdNum, th, thNum } from "./parts";

type Props = { data: MonthData; summary: MonthSummary };

const marginText = (m: number | null) => (m === null ? "—" : pct(m));

function Kpi({ label, value, rate, highlight }: { label: string; value?: number; rate?: string; highlight?: boolean }) {
  return (
    <div className={cx("rounded-card bg-card p-4", highlight ? "border-2 border-accent" : "border border-border")}>
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold sm:text-2xl">
        {value !== undefined ? <Money value={value} /> : <span className={cx("num", rate && rate.length > 6 && "text-sm")}>{rate}</span>}
      </p>
    </div>
  );
}

function stepLabel(from: string, to: string | null): string {
  const f = jpMonth(from.slice(0, 7));
  return to ? `${f}〜${jpMonth(to.slice(0, 7))}` : `${f}から`;
}

export function ProfitTab({ data, summary }: Props) {
  const s = data.settings;
  const general = s.taxMethod === "general";
  const rate = deductibleRateForExempt(summary.judgedOn);
  const exemptCount = summary.drivers.filter((d) => !d.driver.invoiceRegistered).length;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>{jpMonth(s.month)}の数字</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label="売上" value={summary.sales} />
          <Kpi label="ドライバーへの委託料" value={summary.cost} />
          <Kpi label="ロイヤリティ・管理費" value={summary.royaltyAndFee} />
          {general ? <Kpi label="インボイスの負担" value={summary.invoiceCost} /> : <Kpi label="インボイスの負担" rate="計算しない（簡易課税）" />}
          <Kpi label="会社に残る利益" value={summary.profit} highlight />
          <Kpi label="利益率" rate={marginText(summary.margin)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          利益 ＝ 売上 − 委託料 ＋ ロイヤリティ・管理費 − インボイスの負担。金額はすべて税抜で、車両・事務所などの経費は引いていません。
        </p>
      </section>

      <section className="rounded-card border-l-4 border-accent bg-card p-4">
        <h2 className="font-bold">インボイスの負担とは</h2>
        {general ? (
          <>
            <p className="mt-2 text-sm leading-relaxed">
              {rate >= 1 ? (
                <>
                  {jpDate(summary.judgedOn)}の取引はインボイス制度の前なので、未登録（免税）の方への支払も消費税を全額控除できます。
                </>
              ) : rate <= 0 ? (
                <>
                  未登録（免税）の方への支払は、<strong>{jpDate(summary.judgedOn)}</strong>の取引なら消費税を控除できません（原則課税の場合）。控除できない分は会社の負担になります。
                </>
              ) : (
                <>
                  未登録（免税）の方への支払は、<strong>{jpDate(summary.judgedOn)}</strong>の取引なら消費税の
                  <strong className="num">{pct(rate)}</strong>
                  しか控除できません（原則課税の場合）。控除できない分は会社の負担になります。
                </>
              )}
              {exemptCount > 0 ? (
                <>
                  この月は未登録の方 {exemptCount} 人で <Money value={summary.invoiceCost} className="font-bold" /> です。
                </>
              ) : (
                <>この月は未登録の方への支払がないため、負担はありません。</>
              )}
            </p>
            <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {TRANSITIONAL_STEPS.map((step) => (
                <li key={step.from} className={cx(summary.judgedOn >= step.from && (step.to === null || summary.judgedOn <= step.to) && "font-bold text-foreground")}>
                  {stepLabel(step.from, step.to)}：控除できるのは {pct(step.rate)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm leading-relaxed">
            設定が簡易課税なので、インボイスの負担は計算していません（簡易課税では、支払先が登録しているかどうかで納める消費税は変わりません）。
          </p>
        )}
        <p className="mt-2 flex flex-wrap gap-x-5 text-sm">
          <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center underline underline-offset-4">
            御社の負担を計算する
          </Link>
          <a
            href={TRANSITIONAL_SOURCE}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            国税庁の説明（経過措置）
          </a>
        </p>
      </section>

      <section>
        <SectionTitle>案件別</SectionTitle>
        <div className="mt-3">
          <TableWrap>
            <table className="w-full min-w-[36rem] border-collapse bg-card text-sm">
              <thead>
                <tr>
                  <th className={th} scope="col">
                    案件
                  </th>
                  <th className={thNum} scope="col">
                    数量
                  </th>
                  <th className={thNum} scope="col">
                    売上
                  </th>
                  <th className={thNum} scope="col">
                    支払
                  </th>
                  <th className={thNum} scope="col">
                    粗利
                  </th>
                  <th className={thNum} scope="col">
                    粗利率
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.projects.map((pl) => (
                  <tr key={pl.project.id}>
                    <td className={td}>
                      <span className="block">{pl.project.name}</span>
                      {pl.project.client && <span className="block text-xs text-muted-foreground">{pl.project.client}</span>}
                    </td>
                    <td className={tdNum}>
                      {qtyText(pl.qty)} {pl.project.unit}
                    </td>
                    <td className={tdNum}>
                      <Money value={pl.sales} />
                    </td>
                    <td className={tdNum}>
                      <Money value={pl.cost} />
                    </td>
                    <td className={tdNum}>
                      <Money value={pl.gross} />
                    </td>
                    <td className={tdNum}>{marginText(pl.margin)}</td>
                  </tr>
                ))}
                {summary.projects.length === 0 && <EmptyRow cols={6} />}
              </tbody>
            </table>
          </TableWrap>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">粗利 ＝ 売上 − ドライバーへの支払（ロイヤリティ・管理費は入れていません）。</p>
      </section>

      <section>
        <SectionTitle>元請別</SectionTitle>
        <div className="mt-3">
          <TableWrap>
            <table className="w-full min-w-[30rem] border-collapse bg-card text-sm">
              <thead>
                <tr>
                  <th className={th} scope="col">
                    元請
                  </th>
                  <th className={thNum} scope="col">
                    売上
                  </th>
                  <th className={thNum} scope="col">
                    支払
                  </th>
                  <th className={thNum} scope="col">
                    粗利
                  </th>
                  <th className={thNum} scope="col">
                    粗利率
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.clients.map((c) => (
                  <tr key={c.client}>
                    <td className={td}>{c.client || "（元請なし）"}</td>
                    <td className={tdNum}>
                      <Money value={c.sales} />
                    </td>
                    <td className={tdNum}>
                      <Money value={c.cost} />
                    </td>
                    <td className={tdNum}>
                      <Money value={c.gross} />
                    </td>
                    <td className={tdNum}>{marginText(c.margin)}</td>
                  </tr>
                ))}
                {summary.clients.length === 0 && <EmptyRow cols={5} />}
              </tbody>
            </table>
          </TableWrap>
        </div>
      </section>

      <section>
        <SectionTitle>ドライバー別</SectionTitle>
        <div className="mt-3">
          <TableWrap>
            <table className="w-full min-w-[40rem] border-collapse bg-card text-sm">
              <thead>
                <tr>
                  <th className={th} scope="col">
                    ドライバー
                  </th>
                  <th className={thNum} scope="col">
                    売上
                  </th>
                  <th className={thNum} scope="col">
                    委託料
                  </th>
                  <th className={thNum} scope="col">
                    ロイヤリティ・管理費
                  </th>
                  <th className={thNum} scope="col">
                    インボイスの負担
                  </th>
                  <th className={thNum} scope="col">
                    利益
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.drivers.map((d) => (
                  <tr key={d.driver.id}>
                    <td className={td}>
                      <span className="block whitespace-nowrap font-bold">{d.driver.name || "（名前なし）"}</span>
                      {!d.driver.invoiceRegistered && <InvoiceBadge registered={false} />}
                    </td>
                    <td className={tdNum}>
                      <Money value={d.sales} />
                    </td>
                    <td className={tdNum}>
                      <Money value={d.cost} />
                    </td>
                    <td className={tdNum}>
                      <Money value={d.royaltyAndFee} />
                    </td>
                    <td className={tdNum}>
                      {d.invoiceCost > 0 ? <Money value={-d.invoiceCost} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={cx(tdNum, "font-bold")}>
                      <Money value={d.profit} />
                    </td>
                  </tr>
                ))}
                {summary.drivers.length === 0 && <EmptyRow cols={6} />}
              </tbody>
              {summary.drivers.length > 0 && (
                <tfoot>
                  <tr className="font-bold">
                    <th scope="row" className={cx(td, "text-left")}>
                      合計
                    </th>
                    <td className={tdNum}>
                      <Money value={summary.sales} />
                    </td>
                    <td className={tdNum}>
                      <Money value={summary.cost} />
                    </td>
                    <td className={tdNum}>
                      <Money value={summary.royaltyAndFee} />
                    </td>
                    <td className={tdNum}>
                      <Money value={-summary.invoiceCost} />
                    </td>
                    <td className={tdNum}>
                      <Money value={summary.profit} />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </TableWrap>
        </div>
      </section>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={cx(td, "text-center text-muted-foreground")}>
        稼働がまだありません
      </td>
    </tr>
  );
}
