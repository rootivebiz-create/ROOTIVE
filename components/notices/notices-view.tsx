"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMonth } from "@/lib/hooks/use-month";
import { formatDateJa, formatMonthJa } from "@/lib/month";
import { AMOUNT_EPSILON, noticeListSummary } from "@/lib/notices/diff";
import type { NoticeClientOption, NoticeListItem } from "@/lib/notices/view";
import { cn } from "@/lib/utils";
import { NoticeStatusBadge } from "./notice-badges";
import { NoticeDialog } from "./notice-dialog";

export interface NoticesViewProps {
  /** 選択中の稼動月 "YYYY-MM" */
  month: string;
  rows: NoticeListItem[];
  clients: NoticeClientOption[];
  canEdit: boolean;
}

/** 差額が 1 円以上あるか */
function hasDiff(row: NoticeListItem): boolean {
  return Math.abs(row.totalDiff) >= AMOUNT_EPSILON;
}

function clientLabel(row: NoticeListItem): string {
  return row.clientName || "取引先の指定なし";
}

/** 合計カードの 1 枚 */
function TotalCard({ label, value, description }: { label: string; value: number; description?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold">
          <Money value={value} />
        </p>
        {description && <CardDescription className="mt-1 text-xs">{description}</CardDescription>}
      </CardContent>
    </Card>
  );
}

/** 差額（0 は控えめに、差があれば色を付ける） */
function DiffValue({ value }: { value: number }) {
  if (Math.abs(value) < AMOUNT_EPSILON) return <span className="num text-muted-foreground">±0</span>;
  return <Money value={value} className={cn("font-semibold", value > 0 ? "text-warning" : "text-destructive")} />;
}

export function NoticesView({ month, rows, clients, canEdit }: NoticesViewProps) {
  const { href } = useMonth();
  const [creating, setCreating] = useState(false);
  const [allMonths, setAllMonths] = useState(false);

  const visible = useMemo(() => (allMonths ? rows : rows.filter((r) => r.month === month)), [rows, month, allMonths]);
  const summary = useMemo(
    () =>
      noticeListSummary(
        visible.map((r) => ({
          total_amount: r.totalAmount,
          our_bill: r.ourBill,
          total_diff: r.totalDiff,
          item_total: r.itemTotal,
          item_count: r.itemCount,
          unmatched_count: r.unmatchedCount,
        })),
      ),
    [visible],
  );
  const otherMonths = rows.length - rows.filter((r) => r.month === month).length;

  const detailHref = (id: string) => href(`/invoices/notices/${id}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {allMonths ? "すべての月" : formatMonthJa(month)}の支払通知 <span className="num font-semibold text-foreground">{visible.length}</span> 件
          {summary.diffCount > 0 && <span className="text-destructive">／差額あり {summary.diffCount} 件</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {otherMonths > 0 && (
            <Button variant="outline" size="sm" onClick={() => setAllMonths((v) => !v)}>
              {allMonths ? `${formatMonthJa(month)}だけ表示` : `すべての月を表示（ほか ${otherMonths} 件）`}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> 支払通知を登録
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty
          title="支払通知書がまだありません"
          description="元請から届く支払明細書を登録すると、自社の売上と自動で突き合わせます。CSV があれば貼り付けるだけで明細を取り込めます。"
        >
          <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
          {canEdit && (
            <Button size="sm" className="mt-2" onClick={() => setCreating(true)}>
              <Plus /> 支払通知を登録
            </Button>
          )}
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <TotalCard label="通知の合計（税抜）" value={summary.noticeTotal} />
            <TotalCard label="自社の売上（税抜）" value={summary.ourTotal} />
            <TotalCard label="差額" value={summary.diffTotal} description="プラスは通知のほうが多い" />
          </div>

          {/* スマホ：カード表示 */}
          <ul className="space-y-2 md:hidden">
            {visible.map((row) => (
              <li key={row.id} className={cn("rounded-lg border bg-card p-3 shadow-sm", hasDiff(row) && "border-destructive/50")}>
                <Link href={detailHref(row.id)} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{clientLabel(row)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatMonthJa(row.month)}
                        {row.noticeNo ? `／${row.noticeNo}` : ""}
                      </p>
                    </div>
                    <NoticeStatusBadge status={row.status} />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">通知の合計</dt>
                    <dd className="text-right">
                      <Money value={row.totalAmount} />
                    </dd>
                    <dt className="text-muted-foreground">自社の売上</dt>
                    <dd className="text-right">
                      <Money value={row.ourBill} />
                    </dd>
                    <dt className="text-muted-foreground">差額</dt>
                    <dd className="text-right">
                      <DiffValue value={row.totalDiff} />
                    </dd>
                    <dt className="text-muted-foreground">明細</dt>
                    <dd className="num text-right">
                      {row.itemCount} 件
                      {row.unmatchedCount > 0 && <span className="text-destructive">（未紐づけ {row.unmatchedCount}）</span>}
                    </dd>
                    <dt className="text-muted-foreground">受領日</dt>
                    <dd className="num text-right">{row.receivedOn ? formatDateJa(row.receivedOn) : "—"}</dd>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>

          {/* PC：一覧表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>稼動月</TableHead>
                  <TableHead>取引先</TableHead>
                  <TableHead>通知番号</TableHead>
                  <TableHead>受領日</TableHead>
                  <TableHead className="text-right">通知の合計</TableHead>
                  <TableHead className="text-right">自社の売上</TableHead>
                  <TableHead className="text-right">差額</TableHead>
                  <TableHead className="text-right">明細</TableHead>
                  <TableHead>状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id} className={cn(hasDiff(row) && "bg-destructive/5")}>
                    <TableCell className="num whitespace-nowrap">
                      <Link href={detailHref(row.id)} className="underline-offset-2 hover:underline">
                        {formatMonthJa(row.month)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem] break-words font-medium">
                      <Link href={detailHref(row.id)} className="underline-offset-2 hover:underline">
                        {clientLabel(row)}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{row.noticeNo || "—"}</TableCell>
                    <TableCell className="num whitespace-nowrap">{row.receivedOn ? formatDateJa(row.receivedOn) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Money value={row.totalAmount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={row.ourBill} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DiffValue value={row.totalDiff} />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-right">
                      {row.itemCount} 件
                      {row.unmatchedCount > 0 && (
                        <Badge variant="secondary" className="ml-1">
                          未紐づけ {row.unmatchedCount}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <NoticeStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            差額は「通知の合計 − 自社の売上（税抜）」です。プラスは通知のほうが多く、マイナスは自社の売上のほうが多い（＝もらい漏れの可能性）ことを表します。
          </p>
        </>
      )}

      {canEdit && <NoticeDialog open={creating} onOpenChange={setCreating} notice={null} clients={clients} month={month} />}
    </div>
  );
}
