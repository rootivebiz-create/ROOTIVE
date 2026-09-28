import { Money } from "@/components/ui";
import type { DiffParts, Explanation } from "~/server/features/parallel/explain";

/** 差の理由の見当（いちばん当たりそうなものを先に） */
export function Explanations({ items }: { items: Explanation[] }) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="font-bold">理由の見当：{first.title}</span>
      </p>
      <p className="text-muted-foreground">{first.detail}</p>
      {rest.length > 0 && <p className="text-xs text-muted-foreground">ほかに同じ額のもの：{rest.map((r) => r.title).join("・")}</p>}
    </div>
  );
}

/** しめ日ラボの振込額の内訳（Excel の計算と 1 行ずつ比べる用） */
export function Breakdown({ parts, excelTotal }: { parts: DiffParts; excelTotal: number | null }) {
  const rows: { label: string; value: number }[] = [
    { label: "委託料（税抜）", value: parts.subtotal },
    ...(parts.tax ? [{ label: parts.taxLabel ?? "消費税", value: parts.tax }] : []),
    ...parts.deductions.map((d) => ({ label: `控除：${d.name}`, value: -d.amount })),
    ...(parts.deductionTax ? [{ label: "控除の消費税", value: -parts.deductionTax }] : []),
    ...parts.adjustments.map((a) => ({ label: `調整：${a.label}`, value: a.amount })),
    ...(parts.adjustmentTax ? [{ label: "調整の消費税", value: parts.adjustmentTax }] : []),
    ...(parts.withholding ? [{ label: "源泉徴収", value: -parts.withholding }] : []),
  ];
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">振込額の内訳</caption>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.label}:${i}`} className="border-b border-border">
            <th scope="row" className="py-1 pr-2 text-left font-normal">
              {r.label}
            </th>
            <td className="py-1 text-right">
              <Money value={r.value} />
            </td>
          </tr>
        ))}
        <tr className="border-b border-border font-bold">
          <th scope="row" className="py-1 pr-2 text-left">
            しめ日ラボの振込額
          </th>
          <td className="py-1 text-right">
            <Money value={parts.total} />
          </td>
        </tr>
        {excelTotal !== null && (
          <>
            <tr>
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                Excel の振込額
              </th>
              <td className="py-1 text-right">
                <Money value={excelTotal} />
              </td>
            </tr>
            <tr className="font-bold">
              <th scope="row" className="py-1 pr-2 text-left">
                差（しめ日ラボ − Excel）
              </th>
              <td className="py-1 text-right">
                <Money value={parts.total - excelTotal} />
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

/** 差を「+37,450円」のように符号つきで */
export function signedYen(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("ja-JP")}円`;
}
