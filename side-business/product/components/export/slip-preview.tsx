import { Money, TableWrap } from "@/components/ui";
import { jpDate } from "@/lib/format";
import type { Side, Slip } from "~/server/features/accounting/journal";

function SideText({ side, amount, showTax }: { side: Side; amount: number; showTax: boolean }) {
  return (
    <div className="min-w-0">
      <p className="font-bold">
        {side.account}
        {side.sub && <span className="font-normal text-muted-foreground">（{side.sub}）</span>}
      </p>
      <p className="text-xs text-muted-foreground">
        {side.taxLabel || "税区分なし"}
        {side.invoice && `・${side.invoice}`}
      </p>
      <p>
        <Money value={amount} />
        {showTax && side.tax !== null && (
          <span className="ml-1 text-xs text-muted-foreground">
            （うち税 <Money value={side.tax} />）
          </span>
        )}
      </p>
    </div>
  );
}

/** 1 枚の伝票の中身（スマホでは 1 行ずつのカード） */
export function SlipPreview({ slip, showTax }: { slip: Slip; showTax: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        伝票 {slip.no}・{jpDate(slip.date)}・{slip.rows.length} 行
      </p>
      <ol className="divide-y divide-border rounded-card border border-border bg-card text-sm">
        {slip.rows.map((r, i) => (
          <li key={i} className="p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">借方</p>
                <SideText side={r.debit} amount={r.amount} showTax={showTax} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">貸方</p>
                <SideText side={r.credit} amount={r.amount} showTax={showTax} />
              </div>
            </div>
            <p className="mt-2 break-all text-xs text-muted-foreground">摘要：{r.memo}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm">
        借方の合計 <Money value={slip.debitTotal} />・貸方の合計 <Money value={slip.creditTotal} />・未払金の残り <Money value={slip.payableNet} className="font-bold" />
        （明細の振込額 <Money value={slip.statementTotal} />）
      </p>
    </div>
  );
}

/** 科目ごとの合計（この月の全員ぶん） */
export function AccountTotals({ totals }: { totals: { account: string; debit: number; credit: number }[] }) {
  return (
    <TableWrap>
      <table className="w-full min-w-[20rem] border-collapse text-sm">
        <caption className="sr-only">科目ごとの合計</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-left font-normal">
              勘定科目
            </th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              借方
            </th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              貸方
            </th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t) => (
            <tr key={t.account} className="border-b border-border">
              <th scope="row" className="px-2 py-2 text-left font-bold">
                {t.account}
              </th>
              <td className="px-2 py-2 text-right">{t.debit ? <Money value={t.debit} /> : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-2 py-2 text-right">{t.credit ? <Money value={t.credit} /> : <span className="text-muted-foreground">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
