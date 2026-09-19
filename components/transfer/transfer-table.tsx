"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/db/types";
import { sumMoney } from "@/lib/calc";
import { formatDateJa } from "@/lib/month";
import type { TransferTarget } from "@/lib/exports/zengin";

/** 振込先の 1 行表示（銀行・支店・預金種目・口座番号） */
export function accountLine(t: TransferTarget): string {
  if (!t.ready) return "口座情報が未登録";
  const type = t.accountType ? BANK_ACCOUNT_TYPE_LABELS[t.accountType] : "";
  return `${t.bankName}（${t.bankCode}）${t.branchName}（${t.branchCode}）${type} ${t.accountNumber}`;
}

/** 振込対象の一覧：スマホはカード、PC は表（横スクロール） */
export function TransferTable({ targets, transferDate }: { targets: TransferTarget[]; transferDate: string }) {
  const total = sumMoney(targets.filter((t) => t.ready).map((t) => t.amount));

  return (
    <>
      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {targets.map((t) => (
          <li key={t.driverId}>
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.driverName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{accountLine(t)}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.ready ? t.holderKana : t.missing.join("・")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Money value={t.amount} />
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateJa(t.payoutDate)}</p>
                  {!t.ready && (
                    <Badge variant="warning" className="mt-1">
                      未登録
                    </Badge>
                  )}
                  {t.ready && t.payoutDate !== transferDate && (
                    <Badge variant="secondary" className="mt-1">
                      予定日が別
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ドライバー</TableHead>
              <TableHead>振込先</TableHead>
              <TableHead>カナ名義</TableHead>
              <TableHead className="text-right">税込支払額</TableHead>
              <TableHead>振込予定日</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.map((t) => (
              <TableRow key={t.driverId}>
                <TableCell className="font-medium">
                  {t.driverName}
                  {!t.ready && (
                    <Badge variant="warning" className="ml-2">
                      未登録
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{accountLine(t)}</TableCell>
                <TableCell className="num">{t.ready ? t.holderKana : t.missing.join("・")}</TableCell>
                <TableCell className="text-right">
                  <Money value={t.amount} />
                </TableCell>
                <TableCell>
                  {formatDateJa(t.payoutDate)}
                  {t.ready && t.payoutDate !== transferDate && (
                    <Badge variant="secondary" className="ml-2">
                      予定日が別
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>全銀データに載る合計（{targets.filter((t) => t.ready).length} 件）</TableCell>
              <TableCell className="text-right">
                <Money value={total} />
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}
