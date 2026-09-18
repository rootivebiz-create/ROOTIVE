"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EXPENSE_KINDS, EXPENSE_KIND_LABELS, type ExpenseKind } from "@/lib/db/types";
import { deleteExpenseCategoryAction, saveExpenseCategoriesAction } from "@/lib/actions/expenses";
import type { ExpenseCategoryRowInput } from "@/lib/schemas/expenses";

/** 設定画面が受け取るカテゴリ 1 行 */
export interface CategorySettingRow {
  id: string;
  name: string;
  kind: ExpenseKind;
  memo: string;
  is_active: boolean;
  /** このカテゴリを使っている経費・毎月かかる経費の件数（0 なら削除できる） */
  usageCount: number;
}

interface RowState {
  key: string;
  /** null = 未保存の新規行 */
  id: string | null;
  name: string;
  kind: ExpenseKind;
  memo: string;
  is_active: boolean;
  usageCount: number;
}

let rowSeq = 0;
const nextKey = () => `new-${++rowSeq}`;

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

export function ExpenseCategoriesCard({ rows: initial, canEdit }: { rows: CategorySettingRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<RowState[]>(() => initial.map((c) => ({ key: c.id, ...c })));
  const [deleteTarget, setDeleteTarget] = useState<RowState | null>(null);
  const disabled = !canEdit || pending;

  const updateRow = (key: string, patch: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { key: nextKey(), id: null, name: "", kind: "variable", memo: "", is_active: true, usageCount: 0 }]);
  const move = (index: number, delta: number) =>
    setRows((rs) => {
      const to = index + delta;
      if (to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const removeRow = (row: RowState) => {
    if (row.id == null) {
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      return;
    }
    setDeleteTarget(row);
  };

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res = await deleteExpenseCategoryAction(target.id as string);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      setRows((rs) => rs.filter((r) => r.key !== target.key));
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const submit = () => {
    if (!canEdit) return;
    const input: ExpenseCategoryRowInput[] = rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, memo: r.memo, is_active: r.is_active }));
    startTransition(async () => {
      const res = await saveExpenseCategoriesAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>経費カテゴリ</CardTitle>
        <CardDescription>経費の分類です。区分（固定費・変動費）は月次の集計に使います。並び順は一覧・集計の表示順になります。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">カテゴリがありません。「カテゴリを追加」から登録してください。</p>}

        {rows.map((r, i) => (
          <div key={r.key} className="space-y-2 rounded-md border p-3">
            <div className="grid gap-2 md:grid-cols-[1fr_10rem]">
              <div className="space-y-1">
                <Label htmlFor={`cat-name-${r.key}`}>カテゴリ名</Label>
                <Input
                  id={`cat-name-${r.key}`}
                  value={r.name}
                  onChange={(e) => updateRow(r.key, { name: e.target.value })}
                  disabled={disabled}
                  maxLength={50}
                  placeholder="例: 事務所家賃"
                />
                <FieldError messages={errors[`rows.${i}.name`]} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`cat-kind-${r.key}`}>区分</Label>
                <Select id={`cat-kind-${r.key}`} value={r.kind} onChange={(e) => updateRow(r.key, { kind: e.target.value as ExpenseKind })} disabled={disabled}>
                  {EXPENSE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EXPENSE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors[`rows.${i}.kind`]} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`cat-memo-${r.key}`}>メモ（任意）</Label>
              <Input id={`cat-memo-${r.key}`} value={r.memo} onChange={(e) => updateRow(r.key, { memo: e.target.value })} disabled={disabled} />
              <FieldError messages={errors[`rows.${i}.memo`]} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.is_active} onCheckedChange={(c) => updateRow(r.key, { is_active: c })} disabled={disabled} aria-label="有効" />
                  {r.is_active ? "有効" : "停止中"}
                </label>
                {r.usageCount > 0 && <Badge variant="secondary">使用中 {r.usageCount} 件</Badge>}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="上へ" onClick={() => move(i, -1)} disabled={pending || i === 0}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="下へ" onClick={() => move(i, 1)} disabled={pending || i === rows.length - 1}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive" aria-label="このカテゴリを削除" onClick={() => removeRow(r)} disabled={pending}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        {canEdit && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={addRow} disabled={pending}>
              <Plus /> カテゴリを追加
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "保存中…" : "カテゴリを保存"}
            </Button>
          </div>
        )}
      </CardContent>

      {/* 削除確認（使用中のカテゴリは DB が拒否する） */}
      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>カテゴリを削除</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  「{deleteTarget.name}」を削除します。
                  {deleteTarget.usageCount > 0
                    ? "このカテゴリは経費で使われているため削除できません。停止中にしてください。"
                    : "この操作は取り消せません。"}
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
    </Card>
  );
}
