"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePlanYearAction, type PlanYearInput } from "@/lib/actions/plans";
import { planYearSchema } from "@/lib/schemas/executive";
import type { PlanYearActual } from "@/lib/db/types";
import type { FiscalSettings } from "@/lib/fiscal";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";
import { planYearLabel } from "./helpers";

export interface PlanYearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 編集する期（null のときは閉じている） */
  year: PlanYearActual | null;
  /** 決算月と設立日（見出しの「第3期」に使う） */
  fiscal: FiscalSettings;
}

export function PlanYearDialog({ open, onOpenChange, year, fiscal }: PlanYearDialogProps) {
  const heading = year?.year != null ? planYearLabel(year.year, fiscal) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading ? `${heading.label}の目標` : "目標"}</DialogTitle>
          <DialogDescription>
            {heading ? `${heading.range}の` : ""}売上・営業利益・ドライバー数の目標です。月への配分は「月へ配る」で行います。
          </DialogDescription>
        </DialogHeader>
        {open && year && <PlanYearForm onOpenChange={onOpenChange} year={year} />}
      </DialogContent>
    </Dialog>
  );
}

function PlanYearForm({ onOpenChange, year }: { onOpenChange: (open: boolean) => void; year: PlanYearActual }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [billTarget, setBillTarget] = useState(String(year.bill_target ?? 0));
  const [profitTarget, setProfitTarget] = useState(String(year.profit_target ?? 0));
  const [driverTarget, setDriverTarget] = useState(String(year.driver_target ?? 0));
  const [memo, setMemo] = useState(year.memo ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: PlanYearInput = {
      id: year.id as string,
      bill_target: billTarget,
      profit_target: profitTarget,
      driver_target: driverTarget,
      memo,
    };
    const parsed = planYearSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await savePlanYearAction(input);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="plan-year-bill">売上の目標（期の合計・税抜）</Label>
        <NumberInput id="plan-year-bill" value={billTarget} onChange={(e) => setBillTarget(e.target.value)} placeholder="120,000,000" disabled={pending} aria-invalid={!!errors.bill_target} />
        <FieldError errors={errors} name="bill_target" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="plan-year-profit">営業利益の目標（期の合計）</Label>
        <NumberInput id="plan-year-profit" value={profitTarget} onChange={(e) => setProfitTarget(e.target.value)} placeholder="12,000,000" disabled={pending} aria-invalid={!!errors.profit_target} />
        <FieldError errors={errors} name="profit_target" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="plan-year-driver">ドライバー数の目標（期末）</Label>
        <NumberInput id="plan-year-driver" decimal={false} value={driverTarget} onChange={(e) => setDriverTarget(e.target.value)} placeholder="20" disabled={pending} aria-invalid={!!errors.driver_target} />
        <FieldError errors={errors} name="driver_target" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="plan-year-memo">メモ（任意）</Label>
        <Textarea id="plan-year-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
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
