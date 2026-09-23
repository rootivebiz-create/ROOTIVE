import { Money, TableWrap } from "@/components/ui";
import { yen } from "@/lib/payroll/money";
import { monthLabelJa } from "~/server/month";
import { rateText, shortMonthLabel } from "~/server/features/profit/format";
import type { TrendPoint } from "~/server/features/profit/summary";

/**
 * 会社の利益の推移（直近 6 か月の棒グラフ）。グラフの部品は使わず、CSS の棒だけで描く。
 * - 1 系列なので凡例は出さない（見出しが「会社の利益」）。選んだ月の棒だけ濃くする
 * - 赤字の月は赤い棒と「赤字」の文字（色だけに頼らない）。記録が無い月は「記録なし」
 * - 棒に指を当てる・マウスを乗せると数字が出る（title）。同じ数字を下の表にも並べる
 */
export function TrendChart({ points, month }: { points: TrendPoint[]; month: string }) {
  const maxPos = Math.max(0, ...points.map((p) => p.profit));
  const maxNeg = Math.max(0, ...points.map((p) => -p.profit));
  const span = maxPos + maxNeg || 1;
  // 0 の線より上と下の高さの割合（赤字が無ければ全部を上に使う）
  const posShare = (maxPos / span) * 100;
  const negShare = (maxNeg / span) * 100;
  const hasAny = points.some((p) => p.drivers > 0);
  const summary = points
    .map((p) => `${monthLabelJa(p.month)} ${p.drivers === 0 ? "記録なし" : `${p.profit < 0 ? "赤字 " : ""}${yen(p.profit)}`}`)
    .join("、");

  return (
    <figure className="space-y-3">
      <figcaption className="sr-only">会社の利益の推移（直近 6 か月）</figcaption>
      <div role="img" aria-label={`会社の利益の推移：${summary}`} className="rounded-lg border border-border bg-card p-3">
        {!hasAny ? (
          <p className="py-10 text-center text-sm text-muted-foreground">この 6 か月は、まだ記録がありません。</p>
        ) : (
          <div className="flex h-40 items-stretch gap-2 sm:gap-4" aria-hidden>
            {points.map((p) => {
              const selected = p.month === month;
              const empty = p.drivers === 0;
              const up = maxPos > 0 && p.profit > 0 ? (p.profit / maxPos) * 100 : 0;
              const down = maxNeg > 0 && p.profit < 0 ? (-p.profit / maxNeg) * 100 : 0;
              const tip = `${monthLabelJa(p.month)}：${empty ? "記録なし" : `会社の利益 ${yen(p.profit)}（利益率 ${rateText(p.rate)}）・売上 ${yen(p.sales)}`}`;
              return (
                <div key={p.month} title={tip} className="flex min-w-0 flex-1 flex-col">
                  <div className="flex flex-col justify-end" style={{ height: `${posShare}%` }}>
                    {up > 0 && (
                      <div className={`mx-auto w-full max-w-12 rounded-t ${selected ? "bg-foreground" : "bg-muted-foreground/45"}`} style={{ height: `max(3px, ${up}%)` }} />
                    )}
                  </div>
                  <div className={empty ? "border-t border-dashed border-muted-foreground/60" : "h-px bg-muted-foreground/60"} />
                  <div className="flex flex-col justify-start" style={{ height: `${negShare}%` }}>
                    {down > 0 && <div className="mx-auto w-full max-w-12 rounded-b bg-danger" style={{ height: `max(3px, ${down}%)` }} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex gap-2 sm:gap-4" aria-hidden>
          {points.map((p, i) => (
            <div key={p.month} className={`min-w-0 flex-1 text-center text-[11px] leading-tight sm:text-xs ${p.month === month ? "font-bold" : "text-muted-foreground"}`}>
              <span className="block truncate">{shortMonthLabel(p.month, i)}</span>
              {p.drivers === 0 ? <span className="block">記録なし</span> : p.profit < 0 ? <span className="block font-bold text-danger">赤字</span> : null}
            </div>
          ))}
        </div>
      </div>

      <TableWrap>
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="sr-only">月ごとの売上と会社の利益</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 font-normal">
                月
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                売上
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                会社の利益
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                利益率
              </th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.month} className={`border-b border-border ${p.month === month ? "font-bold" : ""}`}>
                <th scope="row" className="py-1.5 text-left font-[inherit]">
                  {monthLabelJa(p.month)}
                  {p.closed && <span className="block text-xs font-normal text-muted-foreground">締め済み</span>}
                </th>
                {p.drivers === 0 ? (
                  <td colSpan={3} className="py-1.5 text-right text-muted-foreground">
                    記録なし
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 text-right">
                      <Money value={p.sales} />
                    </td>
                    <td className="py-1.5 text-right">
                      <Money value={p.profit} />
                    </td>
                    <td className={`num py-1.5 text-right ${p.profit < 0 ? "text-danger" : ""}`}>{rateText(p.rate)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </figure>
  );
}
