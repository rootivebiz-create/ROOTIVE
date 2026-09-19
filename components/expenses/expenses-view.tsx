"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarSync, Download, FileSpreadsheet, Lock, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MonthLink } from "@/components/layout/month-link";
import { EXPENSE_KIND_LABELS, type ExpenseKind } from "@/lib/db/types";
import { sumMoney } from "@/lib/calc";
import { EXPENSE_TAX_MODE_LABELS } from "@/lib/schemas/expenses";
import { exportUrls } from "@/lib/exports/urls";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { applyRecurringExpensesAction, deleteExpenseAction } from "@/lib/actions/expenses";
import { ExpenseDialog, type ExpenseChoices } from "./expense-dialog";
import { filterExpenses, shortDate, totalsOf, type CategoryTotal, type ExpenseRow } from "./helpers";

export interface ExpensesViewProps {
  month: string;
  rows: ExpenseRow[];
  /** カテゴリ別の小計（DB ビュー v_expense_summary） */
  categories: CategoryTotal[];
  /** 編集可能（owner/admin かつ未締め） */
  editable: boolean;
  closed: boolean;
  /** 編集可能なときだけ渡す（ダイアログの選択肢） */
  choices: ExpenseChoices | null;
}

interface DialogState {
  open: boolean;
  mode: "create" | "edit";
  expense: ExpenseRow | null;
}

function KindBadge({ kind }: { kind: ExpenseKind }) {
  return <Badge variant={kind === "fixed" ? "secondary" : "outline"}>{EXPENSE_KIND_LABELS[kind]}</Badge>;
}

export function ExpensesView({ month, rows, categories, editable, closed, choices }: ExpensesViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: "create", expense: null });
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);

  const totals = useMemo(() => totalsOf(categories), [categories]);

  // 月を移動して選択中のカテゴリの行が無い場合は絞り込みを解除する
  const effectiveCategory = categoryFilter && rows.some((r) => r.categoryId === categoryFilter) ? categoryFilter : "";
  const filtered = useMemo(() => filterExpenses(rows, effectiveCategory, query), [rows, effectiveCategory, query]);
  const isFiltered = filtered.length !== rows.length;
  const filteredTotal = useMemo(() => sumMoney(filtered.map((r) => r.amount)), [filtered]);

  const openCreate = () => setDialog({ open: true, mode: "create", expense: null });
  const openEdit = (row: ExpenseRow) => {
    if (!editable) return;
    setDialog({ open: true, mode: "edit", expense: row });
  };

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res = await deleteExpenseAction(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const runApplyRecurring = () => {
    startTransition(async () => {
      const res = await applyRecurringExpensesAction(month);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.count > 0) toast.success(res.message ?? "計上しました");
      else toast.info(res.message ?? "計上が必要な経費はありませんでした");
      setRecurringOpen(false);
      router.refresh();
    });
  };

  const canDialog = editable && choices != null;

  return (
    <div>
      <PageHeader
        title="経費"
        description={`${formatMonthJa(month)}の経費 ${rows.length} 件。金額はすべて税抜です。`}
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
                  <Plus /> 経費を追加
                </Button>
                <Button variant="outline" onClick={() => setRecurringOpen(true)}>
                  <CalendarSync /> 毎月かかる経費をこの月に計上
                </Button>
              </>
            )}
            <a href={exportUrls.expensesCsv(month)} download className={buttonVariants({ variant: "outline" })}>
              <Download /> CSV
            </a>
            <a href={exportUrls.expensesXlsx(month)} download className={buttonVariants({ variant: "outline" })}>
              <FileSpreadsheet /> Excel
            </a>
          </>
        }
      />

      {closed && <Alert className="mb-3">この月は締め済みのため、経費の追加・編集・削除はできません。変更するには月締めを解除してください。</Alert>}

      {/* 合計（固定費・変動費・合計） */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="min-w-0 p-3 md:p-4">
          <p className="text-xs text-muted-foreground md:text-sm">固定費</p>
          <p className="mt-1 text-lg font-semibold md:text-2xl">
            <Money value={totals.fixed} />
          </p>
        </Card>
        <Card className="min-w-0 p-3 md:p-4">
          <p className="text-xs text-muted-foreground md:text-sm">変動費</p>
          <p className="mt-1 text-lg font-semibold md:text-2xl">
            <Money value={totals.variable} />
          </p>
        </Card>
        <Card className="col-span-2 min-w-0 bg-muted/50 p-3 md:col-span-1 md:p-4">
          <p className="text-xs text-muted-foreground md:text-sm">経費合計</p>
          <p className="mt-1 text-lg font-semibold md:text-2xl">
            <Money value={totals.total} />
          </p>
        </Card>
      </div>

      {/* カテゴリ別の小計 */}
      {categories.length > 0 && (
        <Card className="mb-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>カテゴリ</TableHead>
                <TableHead>区分</TableHead>
                <TableHead className="text-right">件数</TableHead>
                <TableHead className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.categoryId}>
                  <TableCell className="font-medium">{c.categoryName}</TableCell>
                  <TableCell>
                    <KindBadge kind={c.kind} />
                  </TableCell>
                  <TableCell className="num text-right">{c.count}</TableCell>
                  <TableCell className="text-right">
                    <Money value={c.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>合計</TableCell>
                <TableCell className="num text-right">{totals.count}</TableCell>
                <TableCell className="text-right">
                  <Money value={totals.total} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      )}

      {/* 絞り込み・検索 */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={effectiveCategory} onChange={(e) => setCategoryFilter(e.target.value)} className="sm:w-56" aria-label="カテゴリで絞り込み">
            <option value="">すべてのカテゴリ</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.categoryName}
              </option>
            ))}
          </Select>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="内容・支払先・備考で検索" className="pl-9" aria-label="検索" />
          </div>
          {isFiltered && (
            <p className="text-sm text-muted-foreground">
              {filtered.length} / {rows.length} 件
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title="まだ経費がありません"
          description={editable ? "「経費を追加」で登録するか、設定の「毎月かかる経費」からこの月に計上してください。" : "この月に登録された経費はありません。"}
        >
          {editable && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button onClick={openCreate}>
                <Plus /> 経費を追加
              </Button>
              <Button variant="outline" onClick={() => setRecurringOpen(true)}>
                <CalendarSync /> 毎月かかる経費をこの月に計上
              </Button>
              <MonthLink href="/settings/expenses" className={buttonVariants({ variant: "outline" })}>
                経費の設定
              </MonthLink>
            </div>
          )}
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty title="該当する経費がありません" description="絞り込み・検索条件を変更してください。" />
      ) : (
        <>
          {/* PC：表 */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>カテゴリ</TableHead>
                  <TableHead>内容</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead>課税区分</TableHead>
                  <TableHead>発生日</TableHead>
                  <TableHead>ドライバー</TableHead>
                  <TableHead>案件</TableHead>
                  <TableHead>支払先</TableHead>
                  <TableHead>備考</TableHead>
                  {editable && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id} className={cn(editable && "cursor-pointer")} onClick={() => openEdit(row)}>
                    <TableCell className="whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {row.categoryName}
                        <KindBadge kind={row.kind} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{row.label}</span>
                        {row.fromRecurring && (
                          <Badge variant="secondary" title="毎月かかる経費から計上されました">
                            毎月
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={row.amount} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{EXPENSE_TAX_MODE_LABELS[row.taxMode]}</TableCell>
                    <TableCell className="num whitespace-nowrap text-muted-foreground">{shortDate(row.incurredOn)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{row.driverName || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{row.projectName || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{row.vendor || "—"}</TableCell>
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
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>合計{isFiltered ? "（表示中）" : ""}</TableCell>
                  <TableCell className="text-right">
                    <Money value={filteredTotal} />
                  </TableCell>
                  <TableCell colSpan={editable ? 7 : 6} />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>

          {/* スマホ：カード */}
          <div className="flex flex-col gap-2 md:hidden">
            {filtered.map((row) => (
              <Card key={row.id} className={cn("p-3", editable && "active:bg-muted")} onClick={() => openEdit(row)} role={editable ? "button" : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{row.label}</p>
                    <p className="text-sm text-muted-foreground">{row.categoryName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">
                      <Money value={row.amount} />
                    </p>
                    <p className="mt-0.5 flex flex-wrap justify-end gap-1">
                      <KindBadge kind={row.kind} />
                      {row.fromRecurring && <Badge variant="secondary">毎月</Badge>}
                    </p>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                  <dt className="text-muted-foreground">課税区分</dt>
                  <dd className="text-right">{EXPENSE_TAX_MODE_LABELS[row.taxMode]}</dd>
                  {row.incurredOn && (
                    <>
                      <dt className="text-muted-foreground">発生日</dt>
                      <dd className="num text-right">{shortDate(row.incurredOn)}</dd>
                    </>
                  )}
                  {row.driverName && (
                    <>
                      <dt className="text-muted-foreground">ドライバー</dt>
                      <dd className="text-right">{row.driverName}</dd>
                    </>
                  )}
                  {row.projectName && (
                    <>
                      <dt className="text-muted-foreground">案件</dt>
                      <dd className="text-right">{row.projectName}</dd>
                    </>
                  )}
                  {row.vendor && (
                    <>
                      <dt className="text-muted-foreground">支払先</dt>
                      <dd className="text-right">{row.vendor}</dd>
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
            ))}
            <Card className="bg-muted/50 p-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">合計{isFiltered ? "（表示中）" : ""}</p>
                <p className="font-semibold">
                  <Money value={filteredTotal} />
                </p>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* 追加・編集ダイアログ */}
      {canDialog && (
        <ExpenseDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          mode={dialog.mode}
          month={month}
          choices={choices}
          expense={dialog.expense}
        />
      )}

      {/* 削除確認 */}
      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>経費を削除</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.categoryName}／{deleteTarget.label}（{formatMonthJa(deleteTarget.month || month)}）を削除します。この操作は取り消せません。
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

      {/* 毎月かかる経費の計上確認 */}
      <Dialog open={recurringOpen} onOpenChange={(open) => !pending && setRecurringOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>毎月かかる経費をこの月に計上</DialogTitle>
            <DialogDescription>
              設定の「毎月かかる経費」のうち、有効でこの月が対象期間に入っているものを{formatMonthJa(month)}の経費として計上します。既に計上済みのものは除外されます（何度実行しても重複しません）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecurringOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={runApplyRecurring} disabled={pending}>
              {pending ? "計上中…" : "計上する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
