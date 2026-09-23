import type { ReactNode } from "react";
import { en } from "@/lib/engine/types";
import { jpDate } from "@/lib/format";
import { Badge } from "~/components/page";
import {
  jpDateWithWeekday,
  jpMonthLabel,
  qtyText,
  summaryRows,
  taxBreakdown,
  totalNote,
  unitPriceText,
  type DriverStatementView,
  type MaskedAccount,
} from "~/server/features/statements/view";

/**
 * 支払明細の中身（ドライバーが見るものと同じ。会社の画面でもこれをそのまま出す）。
 * 受け取るのは DriverStatementView だけ（会社の利益・売上はこの形に入っていない）。
 * lineAction を渡すと、各行の下に「この行について質問する」などを差し込める。
 */

function Yen({ value, className }: { value: number; className?: string }) {
  return <span className={`num whitespace-nowrap ${className ?? ""}`}>{en(value)}</span>;
}

export type LineTarget = { key: string; label: string };

export function StatementView({
  view: v,
  account,
  showAccount = true,
  lineAction,
}: {
  view: DriverStatementView;
  account?: MaskedAccount | null;
  showAccount?: boolean;
  lineAction?: (target: LineTarget) => ReactNode;
}) {
  const tb = taxBreakdown(v);
  const rows = summaryRows(v);
  const zeroNote = totalNote(v.total);
  return (
    <article className="space-y-4" aria-label={v.title}>
      {/* いちばん上：いつ・いくら */}
      <section className="rounded-card border-2 border-foreground bg-card p-4">
        <p className="text-sm text-muted-foreground">{jpMonthLabel(v.month)}分のお振込額</p>
        <p className={`num mt-1 break-all text-4xl font-bold leading-tight tracking-tight ${v.total < 0 ? "text-danger" : ""}`}>{en(v.total)}</p>
        {zeroNote && <p className="mt-1 text-sm font-bold">{zeroNote}</p>}
        <p className="mt-2 text-base">
          振込予定日 <strong className="whitespace-nowrap">{jpDateWithWeekday(v.payDate)}</strong>
        </p>
        {showAccount &&
          (account ? (
            <p className="mt-1 text-sm text-muted-foreground">
              振込先 {account.bank} {account.branch} {account.type} 口座番号の下3桁 {account.last3}
            </p>
          ) : (
            <p className="mt-1 text-sm text-warning">振込先の口座が会社に登録されていません。会社にお知らせください。</p>
          ))}
      </section>

      {/* 記載事項：書類の名前・作った会社・相手・期間 */}
      <section className="rounded-card border border-border bg-card p-4">
        <h2 className="text-lg font-bold">{v.title}</h2>
        <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">お支払先</dt>
            <dd className="font-bold">
              {v.driver.name} 様{v.driver.code ? <span className="ml-2 font-normal text-muted-foreground">番号 {v.driver.code}</span> : null}
            </dd>
            <dd>{v.driver.registrationNo ? `登録番号 ${v.driver.registrationNo}` : "登録番号 なし"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">作成者</dt>
            <dd className="font-bold">{v.company.name}</dd>
            {v.company.registrationNo && <dd>登録番号 {v.company.registrationNo}</dd>}
          </div>
          <div>
            <dt className="text-muted-foreground">取引の期間</dt>
            <dd>
              {jpDate(v.period.from)}〜{jpDate(v.period.to)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">振込予定日</dt>
            <dd>{jpDateWithWeekday(v.payDate)}</dd>
          </div>
        </dl>
        {v.isPurchaseStatement && <p className="mt-3 text-xs text-muted-foreground">登録番号のある方への明細は、仕入明細書の記載事項を載せています。</p>}
      </section>

      {/* 委託料 */}
      <section className="rounded-card border border-border bg-card p-4">
        <h2 className="font-bold">委託料の内容</h2>
        {v.lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">この月の稼働はありません。</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {v.lines.map((l) => (
              <li key={l.key} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{l.project}</p>
                    {l.client && <p className="text-xs text-muted-foreground">{l.client}</p>}
                    <p className="num mt-1 text-sm">
                      {qtyText(l.qty)}
                      {l.unit} × {unitPriceText(l.rate)}
                    </p>
                  </div>
                  <Yen value={l.amount} className="text-base font-bold" />
                </div>
                {lineAction?.({ key: l.key, label: l.project })}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 rounded-lg bg-muted p-3 text-sm">
          {tb ? (
            <>
              <p className="font-bold">税率ごとの合計</p>
              <div className="mt-1 flex justify-between gap-3">
                <span>{tb.rateLabel}（税抜）</span>
                <Yen value={tb.base} />
              </div>
              <div className="flex justify-between gap-3">
                <span>
                  {tb.taxLabel}（{v.taxRatePercent}%）
                </span>
                <Yen value={tb.tax} />
              </div>
            </>
          ) : (
            <div className="flex justify-between gap-3">
              <span>委託料の合計（税抜）</span>
              <Yen value={v.subtotal} />
            </div>
          )}
        </div>
        {!tb && <p className="mt-2 text-xs text-muted-foreground">この明細には消費税相当額の支払はありません（会社の設定によります）。</p>}
      </section>

      {/* 引かれているもの */}
      {v.deductions.length > 0 && (
        <section className="rounded-card border border-border bg-card p-4">
          <h2 className="font-bold">引かれているもの</h2>
          <ul className="mt-2 divide-y divide-border">
            {v.deductions.map((d) => (
              <li key={d.key} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {d.name}
                      {d.agreedInWriting && <Badge tone="green">取引条件で合意</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">{d.how}</p>
                    {!d.taxable && <p className="text-xs text-muted-foreground">消費税の対象外</p>}
                  </div>
                  <Yen value={-d.amount} className="text-base font-bold" />
                </div>
                {lineAction?.({ key: d.key, label: d.name })}
              </li>
            ))}
          </ul>
          {v.deductionTax !== 0 && (
            <div className="flex justify-between gap-3 border-t border-border pt-3 text-sm">
              <span>
                引かれているものの消費税（{v.taxRatePercent}%）
                <span className="block text-xs text-muted-foreground">消費税の対象の合計 × {v.taxRatePercent}%</span>
              </span>
              <Yen value={-v.deductionTax} />
            </div>
          )}
        </section>
      )}

      {/* 調整 */}
      {v.adjustments.length > 0 && (
        <section className="rounded-card border border-border bg-card p-4">
          <h2 className="font-bold">調整（立替の精算など）</h2>
          <ul className="mt-2 divide-y divide-border">
            {v.adjustments.map((a) => (
              <li key={a.key} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {a.label}
                      {a.agreedInWriting && <Badge tone="green">取引条件で合意</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{a.amount >= 0 ? "お支払に足すもの" : "お支払から引くもの"}・{a.taxable ? "消費税の対象" : "消費税の対象外"}</p>
                  </div>
                  <Yen value={a.amount} className="text-base font-bold" />
                </div>
                {lineAction?.({ key: a.key, label: a.label })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 振込額までの計算 */}
      <section className="rounded-card border border-border bg-card p-4">
        <h2 className="font-bold">お振込額の計算</h2>
        <dl className="mt-2 text-sm">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-3 border-b border-border py-2">
              <dt className="min-w-0">
                {r.label}
                {r.hint && <span className="block text-xs text-muted-foreground">{r.hint}</span>}
              </dt>
              <dd>
                <Yen value={r.amount} />
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-3">
            <dt className="text-base font-bold">お振込額</dt>
            <dd>
              <Yen value={v.total} className="text-2xl font-bold" />
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-card border border-border bg-muted p-4 text-sm">
        <p>{v.note}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          版 {v.version}・目印 <span className="font-mono">{v.hashShort}</span>（内容が変わると版が上がります）
        </p>
      </section>
    </article>
  );
}
