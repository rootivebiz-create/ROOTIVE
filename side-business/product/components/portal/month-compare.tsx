import { en } from "@/lib/engine/types";
import { TableWrap } from "@/components/ui";
import type { MonthCompare as Compare } from "~/server/features/statements/compare";
import { qtyText } from "~/server/features/statements/view";

function signedYen(v: number): string {
  return v > 0 ? `＋${en(v)}` : v < 0 ? en(v) : "±0円";
}

function signedQty(v: number): string {
  return v > 0 ? `＋${qtyText(v)}` : v < 0 ? `−${qtyText(-v)}` : "±0";
}

/** ドライバーの画面の「先月との比べ」：振込額と、案件ごとの数量を並べる（あなたの明細の数字だけ） */
export function MonthCompare({ compare: c }: { compare: Compare }) {
  const amounts = [
    { key: "total", label: "お振込額", v: c.total, strong: true },
    { key: "subtotal", label: "委託料（税抜）", v: c.subtotal, strong: false },
    { key: "deductions", label: "引かれているもの（税込）", v: c.deductions, strong: false },
  ];
  return (
    <section className="rounded-card border border-border bg-card p-4" aria-label="先月との比べ">
      <h2 className="font-bold">先月との比べ</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {c.prevLabel}分と{c.curLabel}分のあなたの明細を並べています。
      </p>
      <TableWrap>
        <table className="mt-2 w-full min-w-[17rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-normal" />
              <th className="py-2 pr-2 text-right font-normal">{c.prevLabel.replace(/^\d+年/, "")}</th>
              <th className="py-2 pr-2 text-right font-normal">{c.curLabel.replace(/^\d+年/, "")}</th>
              <th className="py-2 text-right font-normal">差</th>
            </tr>
          </thead>
          <tbody>
            {amounts.map((a) => (
              <tr key={a.key} className={`border-b border-border ${a.strong ? "font-bold" : ""}`}>
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  {a.strong ? <strong>{a.label}</strong> : a.label}
                </th>
                <td className="num py-2 pr-2 text-right">{en(a.v.before)}</td>
                <td className="num py-2 pr-2 text-right">{en(a.v.after)}</td>
                <td className="num py-2 text-right">{signedYen(a.v.diff)}</td>
              </tr>
            ))}
            {c.qty.map((q) => (
              <tr key={q.key} className="border-b border-border">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  {q.project}
                  <span className="block text-xs text-muted-foreground">数量（{q.unit}）</span>
                </th>
                <td className="num py-2 pr-2 text-right">{q.before === null ? "—" : qtyText(q.before)}</td>
                <td className="num py-2 pr-2 text-right">{q.after === null ? "—" : qtyText(q.after)}</td>
                <td className="num py-2 text-right">{signedQty(q.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="mt-2 text-xs text-muted-foreground">数量が違うと思うところは、上の明細のその行の「この行について質問する」からお知らせください。</p>
    </section>
  );
}
