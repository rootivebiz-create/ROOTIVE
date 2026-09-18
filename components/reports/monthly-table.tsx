import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Money, Pct } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMonthJa } from "@/lib/month";
import type { ReportMonthRow, ReportTotals } from "./helpers";

/** 月次の表（月 / 売上 / 会社利益 / 経費 / 営業利益 / 営業利益率 / 支払（税込） / 状態）＋合計行。スマホは横スクロール */
export function ReportMonthlyTable({ rows, totals }: { rows: ReportMonthRow[]; totals: ReportTotals }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 bg-card">月</TableHead>
          <TableHead className="text-right">売上</TableHead>
          <TableHead className="text-right">会社利益</TableHead>
          <TableHead className="text-right">経費</TableHead>
          <TableHead className="text-right">営業利益</TableHead>
          <TableHead className="text-right">営業利益率</TableHead>
          <TableHead className="text-right">支払（税込）</TableHead>
          <TableHead>状態</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.month} className={r.hasData ? undefined : "text-muted-foreground"}>
            <TableCell className="sticky left-0 whitespace-nowrap bg-card font-medium">{formatMonthJa(r.month)}</TableCell>
            <TableCell className="text-right">
              <Money value={r.bill} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.profit} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.expenseTotal} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.operatingProfit} className="font-semibold" />
            </TableCell>
            <TableCell className="text-right">
              <Pct value={r.operatingMargin} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.payoutIncl} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {!r.hasData ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : r.status === "closed" ? (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" /> 締め済み
                </Badge>
              ) : (
                <Badge variant="outline">未締め</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="sticky left-0 bg-muted/50 whitespace-nowrap">合計</TableCell>
          <TableCell className="text-right">
            <Money value={totals.bill} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={totals.profit} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={totals.expenseTotal} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={totals.operatingProfit} />
          </TableCell>
          <TableCell className="text-right">
            <Pct value={totals.operatingMargin} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={totals.payoutIncl} />
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}
