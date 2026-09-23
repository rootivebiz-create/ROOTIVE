import type { ReactNode } from "react";
import { Money, TableWrap } from "@/components/ui";
import { Badge } from "~/components/page";
import { qtyText, rateText } from "~/server/features/profit/format";
import type { ClientProfit, DriverProfit, ProfitTotals, ProjectProfit } from "~/server/features/profit/summary";

/**
 * 利益の表（案件・元請・ドライバー）。赤字の行は赤い字と「赤字」の印。
 * 案件・元請の表は「粗利（売上 − 委託料）」まで。控除と経過措置の負担はドライバーごとのものなので、割り振らずに下の行で足し引きする。
 */

const th = "whitespace-nowrap px-2 py-2 text-right text-xs font-normal text-muted-foreground";
const td = "whitespace-nowrap px-2 py-2 text-right align-top";
/** 横に動かしても、名前の列は左に残す */
const nameCell = "sticky left-0 z-10 bg-card px-2 py-2 text-left align-top";

function LossMark({ value }: { value: number }) {
  return value < 0 ? (
    <span className="ml-1 align-middle">
      <Badge tone="red">赤字</Badge>
    </span>
  ) : null;
}

function RateCell({ rate, loss }: { rate: number | null; loss: boolean }) {
  return <td className={`${td} num ${loss ? "text-danger" : ""}`}>{rateText(rate)}</td>;
}

/** 表の下の足し引き（粗利 ＋ 控除 − 経過措置の負担 ＝ 会社の利益） */
function Bridge({ totals, span }: { totals: ProfitTotals; span: number }) {
  const rows: { label: ReactNode; value: number; strong?: boolean }[] = [
    { label: "＋ 控除（ロイヤリティ・管理費など。会社の売上）", value: totals.deductions },
    { label: "− 経過措置の負担（登録の無い方への支払で、控除できない消費税）", value: -totals.burden },
    { label: "＝ 会社の利益", value: totals.profit, strong: true },
  ];
  return (
    <>
      {rows.map((r, i) => (
        <tr key={i} className={r.strong ? "border-t-2 border-foreground font-bold" : "border-t border-border"}>
          <th scope="row" colSpan={span} className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-sm font-[inherit]">
            {r.label}
          </th>
          <td className={td}>
            <Money value={r.value} />
          </td>
          {r.strong ? <RateCell rate={totals.rate} loss={totals.profit < 0} /> : <td className={td} />}
        </tr>
      ))}
    </>
  );
}

export function ProjectTable({ rows, totals }: { rows: ProjectProfit[]; totals: ProfitTotals }) {
  return (
    <TableWrap>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">案件ごとの利益</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${nameCell} text-xs font-normal text-muted-foreground`}>
              案件（元請）
            </th>
            <th scope="col" className={th}>
              数量
            </th>
            <th scope="col" className={th}>
              売上
            </th>
            <th scope="col" className={th}>
              委託料
            </th>
            <th scope="col" className={th}>
              粗利
            </th>
            <th scope="col" className={th}>
              粗利率
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const loss = p.profit < 0;
            return (
              <tr key={p.key} className={`border-b border-border ${loss ? "text-danger" : ""}`}>
                <th scope="row" className={`${nameCell} font-bold`}>
                  <span className="block min-w-[9rem]">
                    {p.name}
                    <LossMark value={p.profit} />
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {p.client ?? "元請の設定なし"}・{p.drivers}人
                  </span>
                </th>
                <td className={`${td} num`}>
                  {qtyText(p.qty)}
                  <span className="ml-0.5 text-xs text-muted-foreground">{p.unit}</span>
                </td>
                <td className={td}>
                  <Money value={p.sales} />
                </td>
                <td className={td}>
                  <Money value={p.pay} />
                </td>
                <td className={`${td} font-bold`}>
                  <Money value={p.profit} />
                </td>
                <RateCell rate={p.rate} loss={loss} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold">
            <th scope="row" colSpan={2} className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-sm">
              案件の粗利の合計
            </th>
            <td className={td}>
              <Money value={totals.sales} />
            </td>
            <td className={td}>
              <Money value={totals.pay} />
            </td>
            <td className={td}>
              <Money value={totals.gross} />
            </td>
            <td className={td} />
          </tr>
          <Bridge totals={totals} span={4} />
        </tfoot>
      </table>
    </TableWrap>
  );
}

export function ClientTable({ rows, totals }: { rows: ClientProfit[]; totals: ProfitTotals }) {
  return (
    <TableWrap>
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">元請ごとの利益</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${nameCell} text-xs font-normal text-muted-foreground`}>
              元請
            </th>
            <th scope="col" className={th}>
              売上
            </th>
            <th scope="col" className={th}>
              委託料
            </th>
            <th scope="col" className={th}>
              粗利
            </th>
            <th scope="col" className={th}>
              粗利率
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const loss = c.profit < 0;
            return (
              <tr key={c.key} className={`border-b border-border ${loss ? "text-danger" : ""}`}>
                <th scope="row" className={`${nameCell} font-bold`}>
                  <span className="block min-w-[9rem]">
                    {c.name}
                    <LossMark value={c.profit} />
                  </span>
                  <span className="block max-w-[14rem] text-xs font-normal whitespace-normal text-muted-foreground">{c.projects.join("・")}</span>
                </th>
                <td className={td}>
                  <Money value={c.sales} />
                </td>
                <td className={td}>
                  <Money value={c.pay} />
                </td>
                <td className={`${td} font-bold`}>
                  <Money value={c.profit} />
                </td>
                <RateCell rate={c.rate} loss={loss} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold">
            <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-sm">
              粗利の合計
            </th>
            <td className={td}>
              <Money value={totals.sales} />
            </td>
            <td className={td}>
              <Money value={totals.pay} />
            </td>
            <td className={td}>
              <Money value={totals.gross} />
            </td>
            <td className={td} />
          </tr>
          <Bridge totals={totals} span={3} />
        </tfoot>
      </table>
    </TableWrap>
  );
}

export function DriverTable({ rows, totals }: { rows: DriverProfit[]; totals: ProfitTotals }) {
  return (
    <TableWrap>
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <caption className="sr-only">ドライバーごとの会社の利益</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${nameCell} text-xs font-normal text-muted-foreground`}>
              ドライバー
            </th>
            <th scope="col" className={th}>
              売上
            </th>
            <th scope="col" className={th}>
              委託料
            </th>
            <th scope="col" className={th}>
              控除
            </th>
            <th scope="col" className={th}>
              経過措置の負担
            </th>
            <th scope="col" className={th}>
              会社の利益
            </th>
            <th scope="col" className={th}>
              利益率
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const loss = d.profit < 0;
            return (
              <tr key={d.driverId} className={`border-b border-border ${loss ? "text-danger" : ""}`}>
                <th scope="row" className={`${nameCell} font-bold`}>
                  <span className="block min-w-[8rem]">
                    {d.name}
                    <LossMark value={d.profit} />
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {d.code ? `${d.code}・` : ""}
                    {d.registered ? "登録あり" : "登録なし"}
                    {!d.hasWork && "・稼働なし"}
                  </span>
                </th>
                <td className={td}>
                  <Money value={d.sales} />
                </td>
                <td className={td}>
                  <Money value={d.pay} />
                </td>
                <td className={td}>
                  <Money value={d.deductions} />
                </td>
                <td className={td}>{d.burden === 0 ? <span className="text-muted-foreground">—</span> : <Money value={-d.burden} />}</td>
                <td className={`${td} font-bold`}>
                  <Money value={d.profit} />
                </td>
                <RateCell rate={d.rate} loss={loss} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground font-bold">
            <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-sm">
              合計
            </th>
            <td className={td}>
              <Money value={totals.sales} />
            </td>
            <td className={td}>
              <Money value={totals.pay} />
            </td>
            <td className={td}>
              <Money value={totals.deductions} />
            </td>
            <td className={td}>
              <Money value={-totals.burden} />
            </td>
            <td className={td}>
              <Money value={totals.profit} />
            </td>
            <RateCell rate={totals.rate} loss={totals.profit < 0} />
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  );
}
