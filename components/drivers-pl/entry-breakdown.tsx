"use client";

import { Empty } from "@/components/ui/empty";
import { Money, Pct, Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumMoney, UNIT_LABELS } from "@/lib/calc";
import { entryLabel, type DriverEntryRow } from "./helpers";

/** 選んだドライバーの当月の稼働行（案件内容・数量・受注単価・支払単価・行の利益） */
export function EntryBreakdown({ rows, emptyDescription }: { rows: DriverEntryRow[]; emptyDescription: string }) {
  if (rows.length === 0) {
    return (
      <div className="px-4 pb-4">
        <Empty title="この月の稼働行はありません" description={emptyDescription} />
      </div>
    );
  }
  const totals = {
    qty: sumMoney(rows.map((r) => r.qty)),
    bill: sumMoney(rows.map((r) => r.bill)),
    pay: sumMoney(rows.map((r) => r.pay)),
    entryProfit: sumMoney(rows.map((r) => r.entryProfit)),
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 bg-card">案件（内容）</TableHead>
          <TableHead>区分</TableHead>
          <TableHead className="text-right">数量</TableHead>
          <TableHead className="text-right">受注単価</TableHead>
          <TableHead className="text-right">支払単価</TableHead>
          <TableHead className="text-right">売上</TableHead>
          <TableHead className="text-right">支払</TableHead>
          <TableHead className="text-right">ロイヤリティ率</TableHead>
          <TableHead className="text-right">行の利益</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="sticky left-0 whitespace-nowrap bg-card font-medium">{entryLabel(r)}</TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">{UNIT_LABELS[r.unit]}</TableCell>
            <TableCell className="text-right">
              <Qty value={r.qty} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.billRate} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.payRate} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.bill} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.pay} />
            </TableCell>
            <TableCell className="text-right">
              <Pct value={r.royaltyRate} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.entryProfit} className="font-semibold" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="sticky left-0 whitespace-nowrap bg-muted/50" colSpan={2}>
            合計（{rows.length} 件）
          </TableCell>
          <TableCell className="text-right">
            <Qty value={totals.qty} />
          </TableCell>
          <TableCell className="num">—</TableCell>
          <TableCell className="num">—</TableCell>
          <TableCell className="text-right">
            <Money value={totals.bill} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={totals.pay} />
          </TableCell>
          <TableCell className="num">—</TableCell>
          <TableCell className="text-right">
            <Money value={totals.entryProfit} />
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
