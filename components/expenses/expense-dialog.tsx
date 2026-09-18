"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Money } from "@/components/ui/money";
import { parseNumberInput, TAX_MODES, type TaxMode } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { EXPENSE_TAX_MODE_LABELS, expenseInputSchema, type ExpenseFormInput } from "@/lib/schemas/expenses";
import { saveExpenseAction } from "@/lib/actions/expenses";
import { optionsWithSelected, type ChoiceOption, type ExpenseRow } from "./helpers";

export interface ExpenseChoices {
  categories: ChoiceOption[];
  drivers: ChoiceOption[];
  projects: ChoiceOption[];
}

export interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** 表示中の稼動月（経費はこの月に計上される） */
  month: string;
  choices: ExpenseChoices;
  /** 編集対象（mode = "edit"） */
  expense?: ExpenseRow | null;
  onSaved?: () => void;
}

interface FormState {
  categoryId: string;
  label: string;
  amount: string;
  taxMode: TaxMode;
  incurredOn: string;
  driverId: string;
  projectId: string;
  vendor: string;
  memo: string;
}

type FieldErrors = Record<string, string[]>;

function initialForm(mode: "create" | "edit", choices: ExpenseChoices, expense: ExpenseRow | null | undefined): FormState {
  if (mode === "edit" && expense) {
    return {
      categoryId: expense.categoryId,
      label: expense.label,
      amount: String(expense.amount),
      taxMode: expense.taxMode,
      incurredOn: expense.incurredOn,
      driverId: expense.driverId,
      projectId: expense.projectId,
      vendor: expense.vendor,
      memo: expense.memo,
    };
  }
  return {
    categoryId: choices.categories.find((c) => c.is_active)?.id ?? "",
    label: "",
    amount: "",
    taxMode: "taxable",
    incurredOn: "",
    driverId: "",
    projectId: "",
    vendor: "",
    memo: "",
  };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

const inactiveSuffix = (active: boolean) => (active ? "" : "（停止中）");

export function ExpenseDialog(props: ExpenseDialogProps) {
  const { open, onOpenChange, mode, month } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "経費を編集" : "経費を追加"}</DialogTitle>
          <DialogDescription>{formatMonthJa(month)}の経費として計上します。金額は税抜で入力してください（返金はマイナス）。</DialogDescription>
        </DialogHeader>
        {/* 閉じると中身がアンマウントされるため、開くたびにフォーム状態が初期化される */}
        {open && <ExpenseForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({ onOpenChange, mode, month, choices, expense, onSaved }: ExpenseDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(mode, choices, expense));
  const [errors, setErrors] = useState<FieldErrors>({});
  const labelRef = useRef<HTMLInputElement>(null);

  const categoryOptions = useMemo(() => optionsWithSelected(choices.categories, form.categoryId), [choices.categories, form.categoryId]);
  const driverOptions = useMemo(() => optionsWithSelected(choices.drivers, form.driverId), [choices.drivers, form.driverId]);
  const projectOptions = useMemo(() => optionsWithSelected(choices.projects, form.projectId), [choices.projects, form.projectId]);

  const amountNum = parseNumberInput(form.amount);

  const buildInput = (): ExpenseFormInput => ({
    id: mode === "edit" && expense ? expense.id : null,
    month,
    category_id: form.categoryId,
    label: form.label,
    amount: form.amount,
    tax_mode: form.taxMode,
    incurred_on: form.incurredOn,
    driver_id: form.driverId,
    project_id: form.projectId,
    vendor: form.vendor,
    memo: form.memo,
  });

  const submit = (continueAdding: boolean) => {
    const input = buildInput();
    const parsed = expenseInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fe[key] ??= []).push(issue.message);
      }
      if (!form.categoryId) fe.category_id = ["カテゴリを選択してください"];
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveExpenseAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onSaved?.();
      if (continueAdding) {
        // カテゴリ・支払先を保持したまま内容・金額をクリア
        setForm((f) => ({ ...f, label: "", amount: "", memo: "" }));
        labelRef.current?.focus();
      } else {
        onOpenChange(false);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* カテゴリ・内容 */}
      <div className="space-y-1.5">
        <Label htmlFor="expense-category">カテゴリ</Label>
        <Select id="expense-category" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} disabled={pending} aria-invalid={!!errors.category_id}>
          <option value="">カテゴリを選択</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {inactiveSuffix(c.is_active)}
            </option>
          ))}
        </Select>
        <FieldError errors={errors} name="category_id" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expense-label">内容</Label>
        <Input
          id="expense-label"
          ref={labelRef}
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder="例: 事務所家賃"
          maxLength={100}
          disabled={pending}
          aria-invalid={!!errors.label}
        />
        <FieldError errors={errors} name="label" />
      </div>

      {/* 金額・課税区分 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="expense-amount">金額（税抜）</Label>
          <NumberInput
            id="expense-amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.amount}
            className="text-lg"
          />
          <FieldError errors={errors} name="amount" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expense-tax">課税区分</Label>
          <Select id="expense-tax" value={form.taxMode} onChange={(e) => setForm((f) => ({ ...f, taxMode: e.target.value as TaxMode }))} disabled={pending}>
            {TAX_MODES.map((m) => (
              <option key={m} value={m}>
                {EXPENSE_TAX_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="tax_mode" />
        </div>
      </div>

      {/* 発生日・支払先 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="expense-date">発生日（任意）</Label>
          <Input id="expense-date" type="date" value={form.incurredOn} onChange={(e) => setForm((f) => ({ ...f, incurredOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.incurred_on} />
          <FieldError errors={errors} name="incurred_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expense-vendor">支払先（任意）</Label>
          <Input id="expense-vendor" value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} maxLength={100} disabled={pending} aria-invalid={!!errors.vendor} />
          <FieldError errors={errors} name="vendor" />
        </div>
      </div>

      {/* ドライバー・案件 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="expense-driver">ドライバー（任意）</Label>
          <Select id="expense-driver" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} disabled={pending}>
            <option value="">指定なし</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {inactiveSuffix(d.is_active)}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="driver_id" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expense-project">案件（任意）</Label>
          <Select id="expense-project" value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} disabled={pending}>
            <option value="">指定なし</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {inactiveSuffix(p.is_active)}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="project_id" />
        </div>
      </div>

      {/* 備考 */}
      <div className="space-y-1.5">
        <Label htmlFor="expense-memo">備考（任意）</Label>
        <Textarea id="expense-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      {amountNum != null && amountNum < 0 && <Alert variant="warning">金額がマイナスです。返金・戻しとして経費から差し引かれます。</Alert>}

      <div className="rounded-lg bg-muted p-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">計上する月</dt>
          <dd className="text-right">{formatMonthJa(month)}</dd>
          <dt className="font-semibold">金額（税抜）</dt>
          <dd className="text-right font-semibold">
            <Money value={amountNum ?? 0} />
          </dd>
        </dl>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        {mode === "create" && (
          <Button type="button" variant="secondary" onClick={() => submit(true)} disabled={pending}>
            {pending ? "保存中…" : "保存して続けて追加"}
          </Button>
        )}
        <Button type="button" onClick={() => submit(false)} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
