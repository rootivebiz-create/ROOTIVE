"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deletePlanAction, savePlanAction, type PlanInput } from "@/lib/actions/plans";
import { planSchema } from "@/lib/schemas/executive";
import type { Plan } from "@/lib/db/types";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規 */
  plan: Plan | null;
  /** 今年（新規のときの既定） */
  thisYear: number;
}

interface FormState {
  name: string;
  fromYear: string;
  toYear: string;
  vision: string;
  memo: string;
  isActive: boolean;
}

function initialForm(plan: Plan | null, thisYear: number): FormState {
  if (plan) {
    return {
      name: plan.name,
      fromYear: String(plan.from_year),
      toYear: String(plan.to_year),
      vision: plan.vision,
      memo: plan.memo,
      isActive: plan.is_active,
    };
  }
  return { name: `${thisYear}〜${thisYear + 2} 年 中期計画`, fromYear: String(thisYear), toYear: String(thisYear + 2), vision: "", memo: "", isActive: true };
}

export function PlanDialog(props: PlanDialogProps) {
  const { open, onOpenChange, plan } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? "中期計画を編集" : "中期計画を作る"}</DialogTitle>
          <DialogDescription>保存すると、期間ぶんの年（目標を入れる行）がまとめて用意されます。入っている目標はそのまま残ります。</DialogDescription>
        </DialogHeader>
        {open && <PlanForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PlanForm({ onOpenChange, plan, thisYear }: PlanDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(plan, thisYear));
  const [errors, setErrors] = useState<FieldErrors>({});

  const buildInput = (): PlanInput => ({
    id: plan?.id ?? null,
    name: form.name,
    from_year: form.fromYear,
    to_year: form.toYear,
    vision: form.vision,
    memo: form.memo,
    is_active: form.isActive,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await savePlanAction(input);
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
    if (!plan) return;
    if (!window.confirm(`「${plan.name}」を削除します。年ごとの目標もまとめて消えます。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deletePlanAction(plan.id);
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
        <Label htmlFor="plan-name">計画の名前</Label>
        <Input id="plan-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={100} disabled={pending} aria-invalid={!!errors.name} />
        <FieldError errors={errors} name="name" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="plan-from">始まりの年</Label>
          <NumberInput id="plan-from" decimal={false} value={form.fromYear} onChange={(e) => setForm((f) => ({ ...f, fromYear: e.target.value }))} placeholder="2026" disabled={pending} aria-invalid={!!errors.from_year} />
          <FieldError errors={errors} name="from_year" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-to">終わりの年</Label>
          <NumberInput id="plan-to" decimal={false} value={form.toYear} onChange={(e) => setForm((f) => ({ ...f, toYear: e.target.value }))} placeholder="2028" disabled={pending} aria-invalid={!!errors.to_year} />
          <FieldError errors={errors} name="to_year" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan-vision">どうなっていたいか（ビジョン）</Label>
        <Textarea
          id="plan-vision"
          value={form.vision}
          onChange={(e) => setForm((f) => ({ ...f, vision: e.target.value }))}
          rows={3}
          placeholder="例: 3 年後にドライバー 20 名・月商 1,500 万円。元請 1 社への依存を 5 割以下にする。"
          disabled={pending}
        />
        <FieldError errors={errors} name="vision" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan-memo">メモ（任意）</Label>
        <Textarea id="plan-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="plan-active">いま進めている計画</Label>
          <p className="text-xs text-muted-foreground">終わった計画は外します（記録は残ります）。</p>
        </div>
        <Switch id="plan-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={pending} />
      </div>

      <DialogFooter>
        {plan && (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending} className="text-destructive sm:mr-auto">
            <Trash2 /> 削除
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
