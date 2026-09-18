import { Empty } from "@/components/ui/empty";
import { Money, Pct, Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumMoney } from "@/lib/calc/money";
import { EXPENSE_KIND_LABELS } from "@/lib/db/types";
import { projectLabel, type DriverRankRow, type ExpenseRankRow, type ProjectRankRow } from "./helpers";

function Rank({ index }: { index: number }) {
  return <span className="num text-muted-foreground">{index + 1}</span>;
}

/** ドライバー別ランキング（年間・会社利益の降順） */
export function DriverRankingTable({ rows }: { rows: DriverRankRow[] }) {
  if (rows.length === 0) return <div className="px-4 pb-4"><Empty title="ドライバー別のデータはありません" description="この年に稼働行が登録されていません。" /></div>;
  const total = {
    entryCount: rows.reduce((a, r) => a + r.entryCount, 0),
    bill: sumMoney(rows.map((r) => r.bill)),
    profit: sumMoney(rows.map((r) => r.profit)),
    payout: sumMoney(rows.map((r) => r.payout)),
    payoutIncl: sumMoney(rows.map((r) => r.payoutIncl)),
  };
  return (
    <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-right">#</TableHead>
            <TableHead className="sticky left-0 bg-card">ドライバー</TableHead>
            <TableHead className="text-right">稼働月</TableHead>
            <TableHead className="text-right">件数</TableHead>
            <TableHead className="text-right">売上</TableHead>
            <TableHead className="text-right">会社利益</TableHead>
            <TableHead className="text-right">利益率</TableHead>
            <TableHead className="text-right">支払（税抜）</TableHead>
            <TableHead className="text-right">支払（税込）</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.driverId}>
              <TableCell className="text-right">
                <Rank index={i} />
              </TableCell>
              <TableCell className="sticky left-0 whitespace-nowrap bg-card font-medium">
                {r.driverName}
                {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">（停止中）</span>}
              </TableCell>
              <TableCell className="num">{r.monthCount}</TableCell>
              <TableCell className="num">{r.entryCount}</TableCell>
              <TableCell className="text-right">
                <Money value={r.bill} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.profit} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={r.profitRate} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.payout} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.payoutIncl} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell />
            <TableCell className="sticky left-0 whitespace-nowrap bg-muted/50">合計（{rows.length} 名）</TableCell>
            <TableCell className="num">—</TableCell>
            <TableCell className="num">{total.entryCount}</TableCell>
            <TableCell className="text-right">
              <Money value={total.bill} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={total.profit} />
            </TableCell>
            <TableCell className="text-right">
              <Pct value={total.bill !== 0 ? total.profit / total.bill : 0} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={total.payout} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={total.payoutIncl} />
            </TableCell>
          </TableRow>
        </TableFooter>
    </Table>
  );
}

/** 案件（内容）別ランキング（年間・利益の降順） */
export function ProjectRankingTable({ rows }: { rows: ProjectRankRow[] }) {
  if (rows.length === 0) return <div className="px-4 pb-4"><Empty title="案件別のデータはありません" description="この年に稼働行が登録されていません。" /></div>;
  const total = {
    entryCount: rows.reduce((a, r) => a + r.entryCount, 0),
    bill: sumMoney(rows.map((r) => r.bill)),
    profit: sumMoney(rows.map((r) => r.profit)),
  };
  return (
    <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-right">#</TableHead>
            <TableHead className="sticky left-0 bg-card">案件（内容）</TableHead>
            <TableHead>荷主</TableHead>
            <TableHead className="text-right">件数</TableHead>
            <TableHead className="text-right">数量</TableHead>
            <TableHead className="text-right">売上</TableHead>
            <TableHead className="text-right">利益</TableHead>
            <TableHead className="text-right">利益率</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.key}>
              <TableCell className="text-right">
                <Rank index={i} />
              </TableCell>
              <TableCell className="sticky left-0 whitespace-nowrap bg-card font-medium">{projectLabel(r)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{r.clientName || "—"}</TableCell>
              <TableCell className="num">{r.entryCount}</TableCell>
              <TableCell className="text-right">
                <Qty value={r.qtyTotal} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.bill} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.profit} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={r.profitRate} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell />
            <TableCell className="sticky left-0 whitespace-nowrap bg-muted/50" colSpan={2}>
              合計（{rows.length} 件の案件内容）
            </TableCell>
            <TableCell className="num">{total.entryCount}</TableCell>
            <TableCell className="num">—</TableCell>
            <TableCell className="text-right">
              <Money value={total.bill} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={total.profit} />
            </TableCell>
            <TableCell className="text-right">
              <Pct value={total.bill !== 0 ? total.profit / total.bill : 0} />
            </TableCell>
          </TableRow>
        </TableFooter>
    </Table>
  );
}

/** 経費のカテゴリ別内訳（年間・金額の降順） */
export function ExpenseRankingTable({ rows, fixed, variable, total }: { rows: ExpenseRankRow[]; fixed: number; variable: number; total: number }) {
  if (rows.length === 0) return <div className="px-4 pb-4"><Empty title="経費は登録されていません" description="経費を登録すると、カテゴリ別の内訳と営業利益がここに反映されます。" /></div>;
  return (
    <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-card">カテゴリ</TableHead>
            <TableHead>区分</TableHead>
            <TableHead className="text-right">件数</TableHead>
            <TableHead className="text-right">金額</TableHead>
            <TableHead className="text-right">構成比</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.categoryId}>
              <TableCell className="sticky left-0 whitespace-nowrap bg-card font-medium">{r.categoryName}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{EXPENSE_KIND_LABELS[r.kind]}</TableCell>
              <TableCell className="num">{r.expenseCount}</TableCell>
              <TableCell className="text-right">
                <Money value={r.amount} />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={r.share} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="sticky left-0 whitespace-nowrap bg-muted/50">合計</TableCell>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              固定 <Money value={fixed} className="text-xs" /> ／ 変動 <Money value={variable} className="text-xs" />
            </TableCell>
            <TableCell className="num">{rows.reduce((a, r) => a + r.expenseCount, 0)}</TableCell>
            <TableCell className="text-right">
              <Money value={total} />
            </TableCell>
            <TableCell className="text-right">
              <Pct value={total !== 0 ? 1 : 0} />
            </TableCell>
          </TableRow>
        </TableFooter>
    </Table>
  );
}
