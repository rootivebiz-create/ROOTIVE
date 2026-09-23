"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Copy, Grid3x3, Lock, Mic, Pencil, Trash2, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Money, Pct, Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MonthLink } from "@/components/layout/month-link";
import type { Masters, RateDiff } from "@/lib/db/types";
import { sumMoney } from "@/lib/calc";
import { formatMonthJa, prevMonth } from "@/lib/month";
import { cn } from "@/lib/utils";
import { copyPreviousMonthAction, deleteEntryAction } from "@/lib/actions/entries";
import { EntryDialog } from "./entry-dialog";
import { VoiceEntryDialog } from "./voice-entry-dialog";
import { RateDiffBanner } from "./rate-diff-banner";
import { filterRows, isLossRow, isQtyEmpty, projectDisplayName, unitSuffix, type EntryRow } from "./helpers";

export interface EntriesViewProps {
  month: string;
  rows: EntryRow[];
  /** 単価・率・端数処理が現在のマスタと異なる稼働行（締め済み月は空） */
  diffs: RateDiff[];
  /** 編集可能（owner/admin かつ未締め） */
  editable: boolean;
  /** 単価差額利益・行の利益を出す（経営の数字。事務員には出さない） */
  showProfit?: boolean;
  closed: boolean;
  /** 編集可能なときだけ渡す（ダイアログの選択肢） */
  masters: Masters | null;
  allMasters: Masters | null;
  initialDriver?: string;
  initialQuery?: string;
  /** ⌘K の「声で稼働を入力」から来たとき（?voice=1）は開いた状態で始める */
  initialVoice?: boolean;
}

interface DialogState {
  open: boolean;
  mode: "create" | "edit";
  entry: EntryRow | null;
}

function RowBadges({ row }: { row: EntryRow }) {
  const empty = isQtyEmpty(row);
  const loss = isLossRow(row);
  if (!empty && !loss && !row.masterDiff) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {empty && <Badge variant="warning">未入力</Badge>}
      {loss && <Badge variant="destructive">赤字</Badge>}
      {row.masterDiff && (
        <Badge variant="warning" title="単価・率・端数処理が現在のマスタと異なります">
          単価変更あり
        </Badge>
      )}
    </span>
  );
}

export function EntriesView({ month, rows, diffs, editable, showProfit = true, closed, masters, allMasters, initialDriver = "", initialQuery = "", initialVoice = false }: EntriesViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [driverFilter, setDriverFilter] = useState(initialDriver);
  const [query, setQuery] = useState(initialQuery);
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: "create", entry: null });
  const [deleteTarget, setDeleteTarget] = useState<EntryRow | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(initialVoice && editable && masters != null);

  // 絞り込み・検索を URL（?driver= / ?q=）へ反映（サーバー再描画はしない）
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (driverFilter) sp.set("driver", driverFilter);
    else sp.delete("driver");
    if (query) sp.set("q", query);
    else sp.delete("q");
    sp.delete("voice"); // 一度開いたら URL からは外す（再読み込みで勝手に開かない）
    const qs = sp.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [driverFilter, query]);

  const driverChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.driverId)) seen.set(r.driverId, r.driverName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  // 月を移動して選択中のドライバーの行が無い場合は絞り込みを解除する（一覧が空になるのを防ぐ）
  const effectiveDriver = driverFilter && driverChoices.some((d) => d.id === driverFilter) ? driverFilter : "";
  const filtered = useMemo(() => filterRows(rows, effectiveDriver, query), [rows, effectiveDriver, query]);
  const isFiltered = filtered.length !== rows.length;

  const totals = useMemo(
    () => ({
      bill: sumMoney(filtered.map((r) => r.bill)),
      pay: sumMoney(filtered.map((r) => r.pay)),
      margin: sumMoney(filtered.map((r) => r.margin)),
      royalty: sumMoney(filtered.map((r) => r.royalty)),
      entryProfit: sumMoney(filtered.map((r) => r.entryProfit)),
    }),
    [filtered],
  );

  const openCreate = () => setDialog({ open: true, mode: "create", entry: null });
  const openEdit = (row: EntryRow) => {
    if (!editable) return;
    setDialog({ open: true, mode: "edit", entry: row });
  };

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res = await deleteEntryAction(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const runCopy = () => {
    startTransition(async () => {
      const res = await copyPreviousMonthAction(month);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.count > 0) toast.success(res.message ?? "複製しました");
      else toast.info(res.message ?? "複製対象がありません");
      setCopyOpen(false);
      router.refresh();
    });
  };

  const canDialog = editable && masters && allMasters;

  return (
    <div>
      <PageHeader
        title="稼働入力"
        description={`${formatMonthJa(month)}の稼働行 ${rows.length} 件`}
        actions={
          <>
            {closed && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> 締め済み
              </Badge>
            )}
            {editable && (
              <>
                <Button onClick={openCreate}>
                  <Plus /> 稼働を追加
                </Button>
                {masters && (
                  <Button variant="outline" onClick={() => setVoiceOpen(true)}>
                    <Mic /> 声で入力
                  </Button>
                )}
                <Button variant="outline" onClick={() => setCopyOpen(true)}>
                  <Copy /> 前月から複製
                </Button>
                <MonthLink href="/entries/bulk" className={buttonVariants({ variant: "outline" })}>
                  <Grid3x3 /> 一括入力
                </MonthLink>
              </>
            )}
          </>
        }
      />

      {/* 現在のマスタと異なる稼働行（締め済み月は出ない） */}
      <RateDiffBanner month={month} diffs={diffs} editable={editable} />

      {/* 絞り込み・検索 */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={effectiveDriver} onChange={(e) => setDriverFilter(e.target.value)} className="sm:w-56" aria-label="ドライバーで絞り込み">
            <option value="">すべてのドライバー</option>
            {driverChoices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="案件名・備考・ドライバー名で検索" className="pl-9" aria-label="検索" />
          </div>
          {isFiltered && (
            <p className="text-sm text-muted-foreground">
              {filtered.length} / {rows.length} 件
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="この月の稼働はまだありません" description={editable ? "「稼働を追加」または「前月から複製」で入力を始めてください。" : undefined}>
          {editable && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button onClick={openCreate}>
                <Plus /> 稼働を追加
              </Button>
              {masters && (
                <Button variant="outline" onClick={() => setVoiceOpen(true)}>
                  <Mic /> 声で入力
                </Button>
              )}
              <Button variant="outline" onClick={() => setCopyOpen(true)}>
                <Copy /> 前月から複製
              </Button>
            </div>
          )}
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty title="該当する稼働がありません" description="絞り込み・検索条件を変更してください。" />
      ) : (
        <>
          {/* PC：表 */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ドライバー</TableHead>
                  <TableHead>案件</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">受注単価</TableHead>
                  <TableHead className="text-right">支払単価</TableHead>
                  <TableHead className="text-right">会社売上</TableHead>
                  <TableHead className="text-right">ドライバー売上</TableHead>
                  {showProfit && (
                    <TableHead className="text-right">単価差額利益</TableHead>
                  )}
                  <TableHead className="text-right">ロイヤリティ</TableHead>
                  {showProfit && (
                    <TableHead className="text-right">行の利益</TableHead>
                  )}
                  <TableHead>備考</TableHead>
                  {editable && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const loss = isLossRow(row);
                  return (
                    <TableRow key={row.id} className={cn(editable && "cursor-pointer")} onClick={() => openEdit(row)}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.driverName}
                        {!row.driverIsActive && <span className="ml-1 text-xs text-muted-foreground">（停止中）</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{projectDisplayName(row.projectName, row.itemName)}</span>
                          <RowBadges row={row} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Qty value={row.qty} className={cn(isQtyEmpty(row) && "text-warning")} />
                        <span className="ml-0.5 text-xs text-muted-foreground">{unitSuffix(row.unit)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={row.billRate} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={row.payRate} className={cn(loss && "text-destructive")} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={row.bill} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={row.pay} />
                      </TableCell>
                      {showProfit && (
                        <TableCell className="text-right">
                          <Money value={row.margin} className={cn(loss && "text-destructive")} />
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Money value={row.royalty} />
                        <span className="ml-1 text-xs text-muted-foreground">
                          （<Pct value={row.royaltyRate} />）
                        </span>
                      </TableCell>
                      {showProfit && (
                        <TableCell className="text-right font-medium">
                          <Money value={row.entryProfit} />
                        </TableCell>
                      )}
                      <TableCell className="max-w-[12rem] truncate text-muted-foreground" title={row.memo}>
                        {row.memo}
                      </TableCell>
                      {editable && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="編集" onClick={() => openEdit(row)}>
                              <Pencil />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="削除" onClick={() => setDeleteTarget(row)}>
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>合計{isFiltered ? "（表示中）" : ""}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right">
                    <Money value={totals.bill} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={totals.pay} />
                  </TableCell>
                  {showProfit && (
                    <TableCell className="text-right">
                      <Money value={totals.margin} />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Money value={totals.royalty} />
                  </TableCell>
                  {showProfit && (
                    <TableCell className="text-right">
                      <Money value={totals.entryProfit} />
                    </TableCell>
                  )}
                  <TableCell colSpan={editable ? 2 : 1} />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>

          {/* スマホ：カード */}
          <div className="flex flex-col gap-2 md:hidden">
            {filtered.map((row) => {
              const loss = isLossRow(row);
              return (
                <Card key={row.id} className={cn("p-3", editable && "active:bg-muted")} onClick={() => openEdit(row)} role={editable ? "button" : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {row.driverName}
                        {!row.driverIsActive && <span className="ml-1 text-xs font-normal text-muted-foreground">（停止中）</span>}
                      </p>
                      <p className="text-sm">{projectDisplayName(row.projectName, row.itemName)}</p>
                    </div>
                    <RowBadges row={row} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <Qty value={row.qty} className={cn(isQtyEmpty(row) && "text-warning")} />
                    {unitSuffix(row.unit)} × 受注 <Money value={row.billRate} /> ／ 支払 <Money value={row.payRate} className={cn(loss && "text-destructive")} />
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted-foreground">会社売上</dt>
                    <dd className="text-right">
                      <Money value={row.bill} />
                    </dd>
                    <dt className="text-muted-foreground">ドライバー売上</dt>
                    <dd className="text-right">
                      <Money value={row.pay} />
                    </dd>
                    {showProfit && (
                      <>
                        <dt className="text-muted-foreground">単価差額利益</dt>
                        <dd className="text-right">
                          <Money value={row.margin} className={cn(loss && "text-destructive")} />
                        </dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">
                      ロイヤリティ（<Pct value={row.royaltyRate} />）
                    </dt>
                    <dd className="text-right">
                      <Money value={row.royalty} />
                    </dd>
                    {showProfit && (
                      <>
                        <dt className="font-medium">行の利益</dt>
                        <dd className="text-right font-medium">
                          <Money value={row.entryProfit} />
                        </dd>
                      </>
                    )}
                  </dl>
                  {row.memo && <p className="mt-1 break-words text-xs text-muted-foreground">備考：{row.memo}</p>}
                  {editable && (
                    <div className="mt-2 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                        <Pencil /> 編集
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget(row)}>
                        <Trash2 /> 削除
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
            <Card className="bg-muted/50 p-3">
              <p className="mb-1 font-semibold">合計{isFiltered ? "（表示中）" : ""}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-muted-foreground">会社売上</dt>
                <dd className="text-right">
                  <Money value={totals.bill} />
                </dd>
                <dt className="text-muted-foreground">ドライバー売上</dt>
                <dd className="text-right">
                  <Money value={totals.pay} />
                </dd>
                {showProfit && (
                  <>
                    <dt className="text-muted-foreground">単価差額利益</dt>
                    <dd className="text-right">
                      <Money value={totals.margin} />
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">ロイヤリティ</dt>
                <dd className="text-right">
                  <Money value={totals.royalty} />
                </dd>
                {showProfit && (
                  <>
                    <dt className="font-medium">行の利益</dt>
                    <dd className="text-right font-medium">
                      <Money value={totals.entryProfit} />
                    </dd>
                  </>
                )}
              </dl>
            </Card>
          </div>
        </>
      )}

      {/* 追加・編集ダイアログ */}
      {canDialog && (
        <EntryDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          mode={dialog.mode}
          month={month}
          masters={masters}
          allMasters={allMasters}
          entry={dialog.entry}
          showProfit={showProfit}
        />
      )}

      {/* 声で入力（マイクが使えない端末では文字入力で同じことができる） */}
      {editable && masters && (
        <VoiceEntryDialog open={voiceOpen} onOpenChange={setVoiceOpen} month={month} masters={masters} rows={rows} />
      )}

      {/* 削除確認 */}
      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>稼働を削除</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.driverName}／{projectDisplayName(deleteTarget.projectName, deleteTarget.itemName)}（{formatMonthJa(deleteTarget.month || month)}）を削除します。この操作は取り消せません。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={pending}>
              {pending ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 前月から複製の確認 */}
      <Dialog open={copyOpen} onOpenChange={(open) => !pending && setCopyOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>前月から複製</DialogTitle>
            <DialogDescription>
              {formatMonthJa(prevMonth(month))}の稼働行を数量 0 で{formatMonthJa(month)}に複製します。単価・率・端数処理は現在のマスタから取得します。停止中のドライバー・案件と、既にある組み合わせは除外されます（何度実行しても重複しません）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={runCopy} disabled={pending}>
              {pending ? "複製中…" : "複製する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
