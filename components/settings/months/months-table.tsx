"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Money, Pct } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { closeMonthAction, reopenMonthAction } from "@/lib/actions/months";
import { exportUrls } from "@/lib/exports/urls";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa, isFutureMonth, isPastMonth } from "@/lib/month";
import { cn } from "@/lib/utils";

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  entryCount: number;
  driverCount: number;
  bill: number;
  profit: number;
  payout: number;
  profitRate: number;
  status: "open" | "closed";
  closedAt: string | null;
  closingNote: string;
  backupPath: string | null;
}

function StatusBadge({ row }: { row: MonthRow }) {
  if (row.status === "closed") {
    return (
      <Badge variant="secondary">
        <Lock className="mr-1 h-3 w-3" />
        締め済み
      </Badge>
    );
  }
  if (isPastMonth(row.month)) return <Badge variant="warning">未締め</Badge>;
  if (isFutureMonth(row.month)) return <Badge variant="outline">予定</Badge>;
  return <Badge variant="outline">未締め</Badge>;
}

export function MonthsTable({
  rows,
  currentMonth,
  canClose,
  canReopen,
  showProfit = true,
  canDownloadBackup = canClose,
}: {
  rows: MonthRow[];
  currentMonth: string;
  canClose: boolean;
  canReopen: boolean;
  /** 会社利益を出すか（事務員には出さない） */
  showProfit?: boolean;
  /** 締め時バックアップを落とせるか（全テーブルの控えなので経営の設定ができる人だけ。省くと canClose と同じ） */
  canDownloadBackup?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closeTarget, setCloseTarget] = useState<MonthRow | null>(null);
  const [reopenTarget, setReopenTarget] = useState<MonthRow | null>(null);
  const [note, setNote] = useState("");

  const openClose = (row: MonthRow) => {
    setNote("");
    setCloseTarget(row);
  };

  const doClose = () => {
    if (!closeTarget) return;
    const month = closeTarget.month;
    startTransition(async () => {
      const res = await closeMonthAction(month, note);
      if (res.ok) {
        setCloseTarget(null);
        if (res.data.warning) {
          toast.warning(res.message ?? res.data.warning, { duration: 12000 });
        } else {
          toast.success(res.message ?? `${formatMonthJa(month)} を締めました。`);
        }
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const doReopen = () => {
    if (!reopenTarget) return;
    const month = reopenTarget.month;
    startTransition(async () => {
      const res = await reopenMonthAction(month);
      if (res.ok) {
        setReopenTarget(null);
        toast.success(res.message ?? `${formatMonthJa(month)} の締めを解除しました。`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const actions = (row: MonthRow) => (
    <div className="flex flex-wrap items-center gap-2">
      {row.backupPath && canDownloadBackup && (
        <a href={exportUrls.monthBackup(row.month)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))} aria-label={`${formatMonthJa(row.month)} の締め時バックアップをダウンロード`}>
          <Download /> バックアップ
        </a>
      )}
      {row.status === "open" && canClose && (
        <Button size="sm" onClick={() => openClose(row)} disabled={pending}>
          <Lock /> この月を締める
        </Button>
      )}
      {row.status === "closed" && canReopen && (
        <Button size="sm" variant="outline" onClick={() => setReopenTarget(row)} disabled={pending}>
          <LockOpen /> 締めを解除
        </Button>
      )}
    </div>
  );

  const monthLink = (row: MonthRow) => (
    <Link href={`/dashboard?m=${row.month}`} className="font-semibold hover:underline">
      {formatMonthJa(row.month)}
      {row.month === currentMonth && (
        <Badge variant="default" className="ml-2">
          今月
        </Badge>
      )}
    </Link>
  );

  return (
    <>
      {rows.length === 0 ? (
        <Empty title="まだデータがある月はありません" description="稼働を入力すると、その月がここに表示されます。" />
      ) : (
        <>
          {/* スマホ：カード */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <Card key={r.month} className={cn("p-3", r.month === currentMonth && "ring-1 ring-primary", r.status === "closed" && "bg-muted/40")}>
                <div className="flex items-center justify-between gap-2">
                  {monthLink(r)}
                  <StatusBadge row={r} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">件数</dt>
                  <dd className="num text-right">
                    {r.entryCount} 件（{r.driverCount} 名）
                  </dd>
                  <dt className="text-muted-foreground">売上</dt>
                  <dd className="text-right">
                    <Money value={r.bill} />
                  </dd>
                  {showProfit && (
                    <>
                      <dt className="text-muted-foreground">利益</dt>
                      <dd className="text-right">
                        <Money value={r.profit} /> <Pct value={r.profitRate} className="text-xs text-muted-foreground" />
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">支払</dt>
                  <dd className="text-right">
                    <Money value={r.payout} />
                  </dd>
                  {r.closedAt && (
                    <>
                      <dt className="text-muted-foreground">締め日時</dt>
                      <dd className="num text-right">{formatDateTimeJa(r.closedAt)}</dd>
                    </>
                  )}
                  {r.closingNote && (
                    <>
                      <dt className="text-muted-foreground">備考</dt>
                      <dd className="break-words text-right">{r.closingNote}</dd>
                    </>
                  )}
                </dl>
                <div className="mt-3">{actions(r)}</div>
              </Card>
            ))}
          </div>

          {/* PC：表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>稼動月</TableHead>
                  <TableHead className="text-right">件数</TableHead>
                  <TableHead className="text-right">売上</TableHead>
                  {showProfit && <TableHead className="text-right">利益</TableHead>}
                  <TableHead className="text-right">支払</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>締め日時</TableHead>
                  <TableHead>備考</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.month} className={cn(r.month === currentMonth && "bg-accent/60", r.status === "closed" && "text-muted-foreground")}>
                    <TableCell className="whitespace-nowrap">{monthLink(r)}</TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {r.entryCount} 件<span className="ml-1 text-xs text-muted-foreground">（{r.driverCount} 名）</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={r.bill} />
                    </TableCell>
                    {showProfit && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Money value={r.profit} />
                        <Pct value={r.profitRate} className="ml-1 text-xs text-muted-foreground" />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Money value={r.payout} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge row={r} />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">{formatDateTimeJa(r.closedAt)}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs" title={r.closingNote}>
                      {r.closingNote || "—"}
                    </TableCell>
                    <TableCell>{actions(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* 締めの確認 */}
      <Dialog open={closeTarget != null} onOpenChange={(o) => !o && !pending && setCloseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closeTarget ? `${formatMonthJa(closeTarget.month)} を締める` : "月を締める"}</DialogTitle>
            <DialogDescription>
              締めると、この月の稼働・管理費・調整は変更できなくなります。締め時点の集計スナップショットを保存し、バックアップ JSON を Storage へ自動保存します。
            </DialogDescription>
          </DialogHeader>
          {closeTarget && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted p-3 text-sm">
              <dt className="text-muted-foreground">件数</dt>
              <dd className="num text-right">{closeTarget.entryCount} 件</dd>
              <dt className="text-muted-foreground">会社売上</dt>
              <dd className="text-right">
                <Money value={closeTarget.bill} />
              </dd>
              {showProfit && (
                <>
                  <dt className="text-muted-foreground">会社利益</dt>
                  <dd className="text-right">
                    <Money value={closeTarget.profit} />
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">支払合計</dt>
              <dd className="text-right">
                <Money value={closeTarget.payout} />
              </dd>
            </dl>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="closing-note">メモ（任意）</Label>
            <Textarea id="closing-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="例: 支払確定・振込済み" disabled={pending} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={doClose} disabled={pending}>
              <Lock /> {pending ? "締め処理中…" : "この月を締める"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 締め解除の確認 */}
      <Dialog open={reopenTarget != null} onOpenChange={(o) => !o && !pending && setReopenTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reopenTarget ? `${formatMonthJa(reopenTarget.month)} の締めを解除` : "締めを解除"}</DialogTitle>
            <DialogDescription>
              解除すると、この月の稼働・管理費・調整を再び編集できます。もう一度締めると、スナップショットとバックアップは新しく作り直されます（この操作は監査ログに記録されます）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={doReopen} disabled={pending}>
              <LockOpen /> {pending ? "解除中…" : "締めを解除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
