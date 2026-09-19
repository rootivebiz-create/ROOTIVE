"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteTaxTaskAction, saveTaxTaskAction } from "@/lib/actions/finance";
import { taxTaskInputSchema, TAX_TASK_STATUS_VALUES, type TaxTaskFormInput } from "@/lib/schemas/finance";
import { TAX_TASK_STATUS_LABELS, type TaxTaskStatus } from "@/lib/db/types";
import type { TaxTaskView } from "@/lib/finance/tax";

export interface TaxTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規 */
  task: TaxTaskView | null;
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
}

interface FormState {
  title: string;
  detail: string;
  dueOn: string;
  status: TaxTaskStatus;
  amount: string;
  memo: string;
}

type FieldErrors = Record<string, string[]>;

function initialForm(task: TaxTaskView | null, today: string): FormState {
  if (task) {
    return {
      title: task.title,
      detail: task.detail,
      dueOn: task.dueOn,
      status: task.status,
      amount: task.amount == null ? "" : String(task.amount),
      memo: task.memo,
    };
  }
  return { title: "", detail: "", dueOn: today, status: "todo", amount: "", memo: "" };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function TaxTaskDialog(props: TaxTaskDialogProps) {
  const { open, onOpenChange, task } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? "期限を編集" : "期限を追加"}</DialogTitle>
          <DialogDescription>納付額とメモは、実際に申告・納付した内容の控えとして残せます。期限は目安なので自由に直せます。</DialogDescription>
        </DialogHeader>
        {open && <TaxTaskForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function TaxTaskForm({ onOpenChange, task, today }: TaxTaskDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(task, today));
  const [errors, setErrors] = useState<FieldErrors>({});

  const buildInput = (): TaxTaskFormInput => ({
    id: task?.id ?? null,
    title: form.title,
    detail: form.detail,
    due_on: form.dueOn,
    status: form.status,
    amount: form.amount,
    memo: form.memo,
  });

  const save = () => {
    const input = buildInput();
    const parsed = taxTaskInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fe[key] ??= []).push(issue.message);
      }
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveTaxTaskAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  const remove = () => {
    if (!task) return;
    if (!window.confirm(`「${task.title}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteTaxTaskAction(task.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="tax-title">内容</Label>
        <Input
          id="tax-title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="例: 法人税の確定申告と納付"
          maxLength={200}
          disabled={pending}
          aria-invalid={!!errors.title}
        />
        <FieldError errors={errors} name="title" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tax-due">期限</Label>
          <Input id="tax-due" type="date" value={form.dueOn} onChange={(e) => setForm((f) => ({ ...f, dueOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.due_on} />
          <FieldError errors={errors} name="due_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tax-status">状態</Label>
          <Select id="tax-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaxTaskStatus }))} disabled={pending}>
            {TAX_TASK_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {TAX_TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="status" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tax-amount">納付額（任意・税込）</Label>
        <NumberInput
          id="tax-amount"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          placeholder="未入力"
          disabled={pending}
          aria-invalid={!!errors.amount}
        />
        <FieldError errors={errors} name="amount" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tax-detail">説明（任意）</Label>
        <Textarea
          id="tax-detail"
          value={form.detail}
          onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
          rows={2}
          className="min-h-[56px]"
          disabled={pending}
          aria-invalid={!!errors.detail}
        />
        <FieldError errors={errors} name="detail" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tax-memo">メモ（任意）</Label>
        <Textarea id="tax-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
        {task && (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending} className="text-destructive sm:mr-auto">
            <Trash2 /> 削除
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
