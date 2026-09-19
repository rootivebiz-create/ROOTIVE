"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SafetyManager } from "@/lib/db/types";
import { saveSafetyManagerAction } from "@/lib/actions/fleet";
import { safetyManagerInputSchema, type SafetyManagerFormInput } from "@/lib/schemas/fleet";
import { expiryLabel, formatDate, nextTrainingDue, TRAINING_INTERVAL_YEARS } from "@/lib/fleet/helpers";
import { inactiveSuffix, optionsWithSelected, type ChoiceOption } from "./choices";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface SafetyManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  drivers: ChoiceOption[];
  manager?: SafetyManager | null;
  today: string;
  onSaved?: () => void;
}

interface FormState {
  name: string;
  office: string;
  driverId: string;
  appointedOn: string;
  trainingOn: string;
  trainingExpiresOn: string;
  notifiedOn: string;
  memo: string;
  isActive: boolean;
}

function initialForm(mode: "create" | "edit", manager: SafetyManager | null | undefined): FormState {
  if (mode === "edit" && manager) {
    return {
      name: manager.name,
      office: manager.office,
      driverId: manager.driver_id ?? "",
      appointedOn: manager.appointed_on ?? "",
      trainingOn: manager.training_on ?? "",
      trainingExpiresOn: manager.training_expires_on ?? "",
      notifiedOn: manager.notified_on ?? "",
      memo: manager.memo,
      isActive: manager.is_active,
    };
  }
  return { name: "", office: "本店", driverId: "", appointedOn: "", trainingOn: "", trainingExpiresOn: "", notifiedOn: "", memo: "", isActive: true };
}

export function SafetyManagerDialog(props: SafetyManagerDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "安全管理者を編集" : "安全管理者を選任"}</DialogTitle>
          <DialogDescription>
            貨物軽自動車安全管理者は営業所ごとに 1 名以上の選任が必要です（2025 年 4 月施行・2027 年 3 月末まで猶予）。講習は {TRAINING_INTERVAL_YEARS} 年ごとに受講します。
          </DialogDescription>
        </DialogHeader>
        {open && <SafetyManagerForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function SafetyManagerForm({ onOpenChange, mode, drivers, manager, today, onSaved }: SafetyManagerDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(mode, manager));
  const [errors, setErrors] = useState<FieldErrors>({});

  const driverOptions = useMemo(() => optionsWithSelected(drivers, form.driverId), [drivers, form.driverId]);
  const due = nextTrainingDue({ training_on: form.trainingOn || null, training_expires_on: form.trainingExpiresOn || null }, today);

  const buildInput = (): SafetyManagerFormInput => ({
    id: mode === "edit" && manager ? manager.id : null,
    name: form.name,
    office: form.office,
    driver_id: form.driverId,
    appointed_on: form.appointedOn,
    training_on: form.trainingOn,
    training_expires_on: form.trainingExpiresOn,
    notified_on: form.notifiedOn,
    memo: form.memo,
    is_active: form.isActive,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = safetyManagerInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveSafetyManagerAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onSaved?.();
      onOpenChange(false);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manager-name">氏名</Label>
          <Input id="manager-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={100} disabled={pending} aria-invalid={!!errors.name} />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manager-office">営業所</Label>
          <Input id="manager-office" value={form.office} onChange={(e) => setForm((f) => ({ ...f, office: e.target.value }))} placeholder="本店" maxLength={100} disabled={pending} />
          <FieldError errors={errors} name="office" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="manager-driver">ドライバーと結びつける（任意）</Label>
        <Select id="manager-driver" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} disabled={pending}>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manager-appointed">選任日</Label>
          <Input id="manager-appointed" type="date" value={form.appointedOn} onChange={(e) => setForm((f) => ({ ...f, appointedOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.appointed_on} />
          <FieldError errors={errors} name="appointed_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manager-notified">運輸支局への届出日（任意）</Label>
          <Input id="manager-notified" type="date" value={form.notifiedOn} onChange={(e) => setForm((f) => ({ ...f, notifiedOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.notified_on} />
          <FieldError errors={errors} name="notified_on" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manager-training">講習の受講日</Label>
          <Input id="manager-training" type="date" value={form.trainingOn} onChange={(e) => setForm((f) => ({ ...f, trainingOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.training_on} />
          <FieldError errors={errors} name="training_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manager-training-expires">次回講習の期限（任意）</Label>
          <Input
            id="manager-training-expires"
            type="date"
            value={form.trainingExpiresOn}
            onChange={(e) => setForm((f) => ({ ...f, trainingExpiresOn: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.training_expires_on}
          />
          <FieldError errors={errors} name="training_expires_on" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="manager-memo">備考（任意）</Label>
        <Textarea id="manager-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="manager-active">選任中</Label>
          <p className="text-xs text-muted-foreground">交代した管理者は選任中を外します（記録は残ります）。</p>
        </div>
        <Switch id="manager-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={pending} />
      </div>

      {due.dueOn && (
        <Alert variant={due.status === "expired" ? "destructive" : due.status === "soon" ? "warning" : "success"}>
          次回講習の期限は {formatDate(due.dueOn)}（{expiryLabel(due)}）。空欄のときは受講日の {TRAINING_INTERVAL_YEARS} 年後として扱います。
        </Alert>
      )}

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
