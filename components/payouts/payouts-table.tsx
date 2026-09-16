"use client";

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MonthLink } from "@/components/layout/month-link";
import { useMonth } from "@/lib/hooks/use-month";
import { sumMoney } from "@/lib/calc";
import { cn } from "@/lib/utils";

export interface PayoutRow {
  driverId: string;
  driverName: string;
  isActive: boolean;
  entryCount: number;
  pay: number;
  royalty: number;
  mgmtFee: number;
  adjPay: number;
  /** 税抜の支払額 */
  payout: number;
  /** 消費税（v_driver_month_summary.tax） */
  tax: number;
  /** 税込の支払額（v_driver_month_summary.payout_incl）。実際の振込額 */
  payoutIncl: number;
  driverProfit: number;
}

function statementPath(driverId: string) {
  return `/payouts/${encodeURIComponent(driverId)}/statement`;
}

/** 支払明細一覧：PC は表、スマホはカード。行タップで明細へ */
export function PayoutsTable({ rows }: { rows: PayoutRow[] }) {
  const router = useRouter();
  const { href } = useMonth();

  if (rows.length === 0) {
    return <Empty title="この月の支払データはありません" description="稼働を登録すると、ドライバーごとの支払額がここに表示されます。" />;
  }

  const total = {
    entryCount: rows.reduce((a, r) => a + r.entryCount, 0),
    pay: sumMoney(rows.map((r) => r.pay)),
    royalty: sumMoney(rows.map((r) => r.royalty)),
    mgmtFee: sumMoney(rows.map((r) => r.mgmtFee)),
    adjPay: sumMoney(rows.map((r) => r.adjPay)),
    payout: sumMoney(rows.map((r) => r.payout)),
    tax: sumMoney(rows.map((r) => r.tax)),
    payoutIncl: sumMoney(rows.map((r) => r.payoutIncl)),
    driverProfit: sumMoney(rows.map((r) => r.driverProfit)),
  };

  return (
    <>
      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.driverId}>
            <MonthLink href={statementPath(r.driverId)} className="block">
              <Card className="p-3 active:bg-muted">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.driverName}
                      {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">（停止中）</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.entryCount} 件</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">支払額（税抜）</p>
                      <Money value={r.payout} className="text-lg font-semibold" />
                      <p className="text-[11px] text-muted-foreground">
                        税込 <Money value={r.payoutIncl} className="font-medium text-foreground" />
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">ドライバー売上</dt>
                    <dd>
                      <Money value={r.pay} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">ロイヤリティ</dt>
                    <dd>
                      <Money value={r.royalty} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">管理費</dt>
                    <dd>
                      <Money value={r.mgmtFee} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">調整</dt>
                    <dd>
                      <Money value={r.adjPay} showZeroAsDash />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">消費税</dt>
                    <dd>
                      <Money value={r.tax} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">会社利益</dt>
                    <dd>
                      <Money value={r.driverProfit} className="font-medium" />
                    </dd>
                  </div>
                </dl>
              </Card>
            </MonthLink>
          </li>
        ))}
        <li>
          <Card className="bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">合計（{rows.length} 名・{total.entryCount} 件）</p>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">支払額（税抜）</p>
                <Money value={total.payout} className="text-lg font-semibold" />
                <p className="text-[11px] text-muted-foreground">
                  税込 <Money value={total.payoutIncl} className="font-medium text-foreground" />
                </p>
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">ドライバー売上</dt>
                <dd>
                  <Money value={total.pay} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">ロイヤリティ</dt>
                <dd>
                  <Money value={total.royalty} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">管理費</dt>
                <dd>
                  <Money value={total.mgmtFee} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">調整</dt>
                <dd>
                  <Money value={total.adjPay} showZeroAsDash />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">消費税</dt>
                <dd>
                  <Money value={total.tax} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">会社利益</dt>
                <dd>
                  <Money value={total.driverProfit} className="font-medium" />
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
              <TableHead>ドライバー</TableHead>
              <TableHead className="text-right">件数</TableHead>
              <TableHead className="text-right">ドライバー売上</TableHead>
              <TableHead className="text-right">ロイヤリティ</TableHead>
              <TableHead className="text-right">管理費</TableHead>
              <TableHead className="text-right">調整</TableHead>
              <TableHead className="text-right">支払額</TableHead>
              <TableHead className="text-right">消費税</TableHead>
              <TableHead className="text-right">税込支払額</TableHead>
              <TableHead className="text-right">会社利益</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.driverId}
                className="cursor-pointer"
                onClick={() => router.push(href(statementPath(r.driverId)))}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(href(statementPath(r.driverId)));
                }}
              >
                <TableCell className="font-medium">
                  <MonthLink href={statementPath(r.driverId)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.driverName}
                  </MonthLink>
                  {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">（停止中）</span>}
                </TableCell>
                <TableCell className="num">{r.entryCount}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.pay} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.royalty} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.mgmtFee} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.adjPay} showZeroAsDash />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.payout} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.tax} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.payoutIncl} className="font-semibold" />
                </TableCell>
                <TableCell className={cn("text-right")}>
                  <Money value={r.driverProfit} />
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>合計（{rows.length} 名）</TableCell>
              <TableCell className="num">{total.entryCount}</TableCell>
              <TableCell className="text-right">
                <Money value={total.pay} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.royalty} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.mgmtFee} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.adjPay} showZeroAsDash />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.payout} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.tax} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.payoutIncl} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                <Money value={total.driverProfit} />
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </>
  );
}
