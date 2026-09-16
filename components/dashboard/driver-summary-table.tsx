"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money, Pct } from "@/components/ui/money";
import { Empty } from "@/components/ui/empty";
import { useMonth } from "@/lib/hooks/use-month";

export interface DriverSummaryRow {
  driverId: string;
  driverName: string;
  isActive: boolean;
  entryCount: number;
  bill: number;
  profit: number;
  payout: number;
  profitRate: number;
}

export interface DriverSummaryTotals {
  entryCount: number;
  bill: number;
  profit: number;
  payout: number;
  profitRate: number;
}

/** ドライバー別サマリー表（PC は表、スマホはカード）。行タップで支払明細へ */
export function DriverSummaryTable({ rows, totals }: { rows: DriverSummaryRow[]; totals: DriverSummaryTotals }) {
  const router = useRouter();
  const { href } = useMonth();
  const statementHref = (driverId: string) => href(`/payouts/${encodeURIComponent(driverId)}/statement`);

  if (rows.length === 0) {
    return (
      <Empty title="この月のドライバー別データはありません" description="稼働を入力すると、ドライバーごとの売上・利益・支払額がここに表示されます。">
        <Link href={href("/entries")} className="text-sm text-primary underline-offset-4 hover:underline">
          稼働入力へ
        </Link>
      </Empty>
    );
  }

  return (
    <>
      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.driverId}>
            <Link href={statementHref(r.driverId)} className="block rounded-lg border bg-card p-3 hover:bg-muted">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">
                  {r.driverName}
                  {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">（停止中）</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {r.entryCount} 件 <ChevronRight className="h-4 w-4" />
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">会社売上</dt>
                <dd className="text-right">
                  <Money value={r.bill} />
                </dd>
                <dt className="text-muted-foreground">利益</dt>
                <dd className="text-right">
                  <Money value={r.profit} />
                </dd>
                <dt className="text-muted-foreground">支払額</dt>
                <dd className="text-right">
                  <Money value={r.payout} />
                </dd>
                <dt className="text-muted-foreground">利益率</dt>
                <dd className="text-right">
                  <Pct value={r.profitRate} />
                </dd>
              </dl>
            </Link>
          </li>
        ))}
        <li className="rounded-lg border bg-muted/50 p-3 text-sm font-semibold">
          <div className="flex items-center justify-between">
            <span>合計</span>
            <span className="text-xs font-normal text-muted-foreground">{totals.entryCount} 件</span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="font-normal text-muted-foreground">会社売上</dt>
            <dd className="text-right">
              <Money value={totals.bill} />
            </dd>
            <dt className="font-normal text-muted-foreground">利益</dt>
            <dd className="text-right">
              <Money value={totals.profit} />
            </dd>
            <dt className="font-normal text-muted-foreground">支払額</dt>
            <dd className="text-right">
              <Money value={totals.payout} />
            </dd>
            <dt className="font-normal text-muted-foreground">利益率</dt>
            <dd className="text-right">
              <Pct value={totals.profitRate} />
            </dd>
          </dl>
        </li>
      </ul>

      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ドライバー</TableHead>
              <TableHead className="text-right">件数</TableHead>
              <TableHead className="text-right">会社売上</TableHead>
              <TableHead className="text-right">利益</TableHead>
              <TableHead className="text-right">支払額</TableHead>
              <TableHead className="text-right">利益率</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.driverId}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => router.push(statementHref(r.driverId))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(statementHref(r.driverId));
                  }
                }}
                aria-label={`${r.driverName} の支払明細を開く`}
              >
                <TableCell className="font-medium">
                  <Link href={statementHref(r.driverId)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.driverName}
                  </Link>
                  {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">（停止中）</span>}
                </TableCell>
                <TableCell className="num">{r.entryCount}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.bill} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.profit} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.payout} />
                </TableCell>
                <TableCell className="text-right">
                  <Pct value={r.profitRate} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>合計</TableCell>
              <TableCell className="num">{totals.entryCount}</TableCell>
              <TableCell className="text-right">
                <Money value={totals.bill} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.profit} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={totals.payout} />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={totals.profitRate} />
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}
