"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteLoanAction, saveLoanAction } from "@/lib/actions/finance";
import { loanInputSchema, LOAN_STATUS_VALUES, type LoanFormInput } from "@/lib/schemas/finance";
import { parseNumberInput, parsePercentInput, rateToPercent } from "@/lib/calc/parse";
import { equalPayment } from "@/lib/finance/loans";
import { LOAN_STATUS_LABELS, type LoanRow, type LoanStatus } from "@/lib/db/types";

export interface LoanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規 */
  loan: LoanRow | null;
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
}

interface FormState {
  name: string;
  lender: string;
  principal: string;
  annualRate: string;
  startOn: string;
  months: string;
  paymentDay: string;
  monthlyPayment: string;
  status: LoanStatus;
  memo: string;
}

type FieldErrors = Record<string, string[]>;

function initialForm(loan: LoanRow | null, today: string): FormState {
  if (loan) {
    return {
      name: loan.name ?? "",
      lender: loan.lender ?? "",
      principal: String(loan.principal ?? 0),
      annualRate: String(rateToPercent(loan.annual_rate ?? 0)),
      startOn: loan.start_on ?? today,
      months: String(loan.months ?? 60),
      paymentDay: String(loan.payment_day ?? 0),
      monthlyPayment: (loan.monthly_payment ?? 0) === 0 ? "" : String(loan.monthly_payment),
      status: loan.status ?? "active",
      memo: loan.memo ?? "",
    };
  }
  return { name: "", lender: "", principal: "", annualRate: "", startOn: today, months: "60", paymentDay: "0", monthlyPayment: "", status: "active", memo: "" };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function LoanDialog(props: LoanDialogProps) {
  const { open, onOpenChange, loan } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{loan ? "借入を編集" : "借入を追加"}</DialogTitle>
          <DialogDescription>保存すると元利均等の返済予定を作り直します（返済済みにした回はそのまま残ります）。</DialogDescription>
        </DialogHeader>
        {open && <LoanForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function LoanForm({ onOpenChange, loan, today }: LoanDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(loan, today));
  const [errors, setErrors] = useState<FieldErrors>({});

  // 毎月の返済額（0 なら元利均等で自動計算）のプレビュー
  const preview = useMemo(() => {
    const fixed = parseNumberInput(form.monthlyPayment) ?? 0;
    if (fixed > 0) return { value: fixed, auto: false };
    const principal = parseNumberInput(form.principal) ?? 0;
    const rate = parsePercentInput(form.annualRate) ?? 0;
    const months = parseNumberInput(form.months) ?? 0;
    return { value: equalPayment(principal, rate, months), auto: true };
  }, [form.monthlyPayment, form.principal, form.annualRate, form.months]);

  const buildInput = (): LoanFormInput => ({
    id: loan?.id ?? null,
    name: form.name,
    lender: form.lender,
    principal: form.principal,
    annual_rate: form.annualRate,
    start_on: form.startOn,
    months: form.months,
    payment_day: form.paymentDay,
    monthly_payment: form.monthlyPayment,
    status: form.status,
    memo: form.memo,
  });

  const save = () => {
    const input = buildInput();
    const parsed = loanInputSchema.safeParse(input);
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
      const res = await saveLoanAction(input);
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
    if (!loan?.id) return;
    if (!window.confirm(`「${loan.name ?? ""}」を削除します。返済予定もまとめて消えます。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteLoanAction(loan.id as string);
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="loan-name">借入の名前</Label>
          <Input
            id="loan-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="例: 運転資金"
            maxLength={100}
            disabled={pending}
            aria-invalid={!!errors.name}
          />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-lender">借入先</Label>
          <Input
            id="loan-lender"
            value={form.lender}
            onChange={(e) => setForm((f) => ({ ...f, lender: e.target.value }))}
            placeholder="例: 日本政策金融公庫"
            maxLength={100}
            disabled={pending}
            aria-invalid={!!errors.lender}
          />
          <FieldError errors={errors} name="lender" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-principal">借入額（円）</Label>
          <NumberInput
            id="loan-principal"
            value={form.principal}
            onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
            placeholder="5,000,000"
            disabled={pending}
            aria-invalid={!!errors.principal}
          />
          <FieldError errors={errors} name="principal" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-rate">年利（%）</Label>
          <NumberInput
            id="loan-rate"
            value={form.annualRate}
            onChange={(e) => setForm((f) => ({ ...f, annualRate: e.target.value }))}
            placeholder="1.8"
            disabled={pending}
            aria-invalid={!!errors.annual_rate}
          />
          <FieldError errors={errors} name="annual_rate" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-start">借入日</Label>
          <Input
            id="loan-start"
            type="date"
            value={form.startOn}
            onChange={(e) => setForm((f) => ({ ...f, startOn: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.start_on}
          />
          <FieldError errors={errors} name="start_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-months">返済回数（か月）</Label>
          <NumberInput
            id="loan-months"
            decimal={false}
            value={form.months}
            onChange={(e) => setForm((f) => ({ ...f, months: e.target.value }))}
            placeholder="60"
            disabled={pending}
            aria-invalid={!!errors.months}
          />
          <FieldError errors={errors} name="months" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-day">返済日（0 = 月末）</Label>
          <NumberInput
            id="loan-day"
            decimal={false}
            value={form.paymentDay}
            onChange={(e) => setForm((f) => ({ ...f, paymentDay: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.payment_day}
          />
          <FieldError errors={errors} name="payment_day" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-status">状態</Label>
          <Select id="loan-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as LoanStatus }))} disabled={pending}>
            {LOAN_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {LOAN_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="status" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="loan-payment">毎月の返済額（空欄・0 で自動計算）</Label>
        <NumberInput
          id="loan-payment"
          value={form.monthlyPayment}
          onChange={(e) => setForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
          placeholder="自動計算"
          disabled={pending}
          aria-invalid={!!errors.monthly_payment}
        />
        <p className="text-xs text-muted-foreground">
          {preview.auto ? "元利均等で計算した毎月の返済額：" : "指定した毎月の返済額："}
          <Money value={preview.value} className="ml-1 inline" />
        </p>
        <FieldError errors={errors} name="monthly_payment" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="loan-memo">メモ（任意）</Label>
        <Textarea id="loan-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
        {loan && (
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
