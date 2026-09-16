import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money, Pct, Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumMoney } from "@/lib/calc";
import { UNIT_LABELS, type Unit } from "@/lib/calc/types";

export interface ProjectRow {
  key: string;
  projectName: string;
  clientName: string;
  itemName: string;
  unit: Unit;
  entryCount: number;
  /** 全期間は月ごとの distinct のため合算できない → null（「—」表示） */
  driverCount: number | null;
  qtyTotal: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  entryProfit: number;
  profitRate: number;
}

export function projectTitle(r: Pick<ProjectRow, "projectName" | "itemName">): string {
  return r.itemName && r.itemName !== "標準" ? `${r.projectName}（${r.itemName}）` : r.projectName;
}

function unitSuffix(unit: Unit) {
  return unit === "day" ? "日" : "個";
}

/** 案件別集計：PC は表、スマホはカード */
export function ProjectSummaryTable({ rows, emptyDescription }: { rows: ProjectRow[]; emptyDescription?: string }) {
  if (rows.length === 0) {
    return <Empty title="案件の集計データはありません" description={emptyDescription} />;
  }
  const total = {
    entryCount: rows.reduce((a, r) => a + r.entryCount, 0),
    bill: sumMoney(rows.map((r) => r.bill)),
    pay: sumMoney(rows.map((r) => r.pay)),
    margin: sumMoney(rows.map((r) => r.margin)),
    royalty: sumMoney(rows.map((r) => r.royalty)),
    entryProfit: sumMoney(rows.map((r) => r.entryProfit)),
  };
  const totalRate = total.bill !== 0 ? total.entryProfit / total.bill : 0;

  return (
    <>
      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.key}>
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{projectTitle(r)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.clientName ? `${r.clientName} ／ ` : ""}
                    {UNIT_LABELS[r.unit]}・{r.entryCount} 件
                    {r.driverCount != null && ` ・ ${r.driverCount} 名`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">利益（行）</p>
                  <Money value={r.entryProfit} className="text-lg font-semibold" />
                  <p className="text-xs text-muted-foreground">
                    <Pct value={r.profitRate} />
                  </p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">数量</dt>
                  <dd>
                    <Qty value={r.qtyTotal} />
                    {unitSuffix(r.unit)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">会社売上</dt>
                  <dd>
                    <Money value={r.bill} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">ドライバー売上</dt>
                  <dd>
                    <Money value={r.pay} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">単価差額利益</dt>
                  <dd>
                    <Money value={r.margin} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">ロイヤリティ</dt>
                  <dd>
                    <Money value={r.royalty} />
                  </dd>
                </div>
              </dl>
            </Card>
          </li>
        ))}
        <li>
          <Card className="bg-muted/50 p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">合計（{total.entryCount} 件）</p>
              <div className="text-right">
                <Money value={total.entryProfit} className="text-lg font-semibold" />
                <p className="text-xs text-muted-foreground">
                  <Pct value={totalRate} />
                </p>
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">会社売上</dt>
                <dd>
                  <Money value={total.bill} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">ドライバー売上</dt>
                <dd>
                  <Money value={total.pay} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">単価差額利益</dt>
                <dd>
                  <Money value={total.margin} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">ロイヤリティ</dt>
                <dd>
                  <Money value={total.royalty} />
                </dd>
              </div>
            </dl>
          </Card>
        </li>
      </ul>

      {/* PC：表 */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>案件（内容）</TableHead>
              <TableHead>荷主</TableHead>
              <TableHead className="text-right">件数</TableHead>
              <TableHead className="text-right">ドライバー数</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">会社売上</TableHead>
              <TableHead className="text-right">ドライバー売上</TableHead>
              <TableHead className="text-right">単価差額利益</TableHead>
              <TableHead className="text-right">ロイヤリティ</TableHead>
              <TableHead className="text-right">利益（行）</TableHead>
              <TableHead className="text-right">利益率</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">
                  {projectTitle(r)}
                  <span className="ml-1 text-xs text-muted-foreground">{UNIT_LABELS[r.unit]}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{r.clientName || "—"}</TableCell>
                <TableCell className="num">{r.entryCount}</TableCell>
                <TableCell className="num">{r.driverCount ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Qty value={r.qtyTotal} />
                  {unitSuffix(r.unit)}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.bill} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.pay} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.margin} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.royalty} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.entryProfit} className="font-semibold" />
                </TableCell>
                <TableCell className="text-right">
                  <Pct value={r.profitRate} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>合計</TableCell>
              <TableCell className="num">{total.entryCount}</TableCell>
              <TableCell className="num">—</TableCell>
              <TableCell className="num">—</TableCell>
              <TableCell className="text-right">
                <Money value={total.bill} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.pay} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.margin} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.royalty} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.entryProfit} />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={totalRate} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </>
  );
}
