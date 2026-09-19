"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { VEHICLE_OWNERSHIP_LABELS, type VehicleOwnership } from "@/lib/db/types";
import { createVehicleAction, updateVehicleAction } from "@/lib/actions/fleet";
import { vehicleInputSchema, VEHICLE_OWNERSHIPS, type VehicleFormInput } from "@/lib/schemas/fleet";
import type { FleetVehicle } from "@/lib/fleet/helpers";
import { inactiveSuffix, optionsWithSelected, type FleetChoices } from "./choices";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface VehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  choices: FleetChoices;
  /** 編集対象（mode = "edit"） */
  vehicle?: FleetVehicle | null;
  onSaved?: () => void;
}

interface FormState {
  plate: string;
  maker: string;
  model: string;
  ownership: VehicleOwnership;
  driverId: string;
  leaseMonthly: string;
  odometer: string;
  memo: string;
  isActive: boolean;
}

function initialForm(mode: "create" | "edit", vehicle: FleetVehicle | null | undefined): FormState {
  if (mode === "edit" && vehicle) {
    return {
      plate: vehicle.plate,
      maker: vehicle.maker,
      model: vehicle.model,
      ownership: vehicle.ownership,
      driverId: vehicle.driverId,
      leaseMonthly: vehicle.leaseMonthly ? String(vehicle.leaseMonthly) : "",
      odometer: vehicle.odometer == null ? "" : String(vehicle.odometer),
      memo: vehicle.memo,
      isActive: vehicle.isActive,
    };
  }
  return { plate: "", maker: "", model: "", ownership: "owned", driverId: "", leaseMonthly: "", odometer: "", memo: "", isActive: true };
}

export function VehicleDialog(props: VehicleDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "車両を編集" : "車両を追加"}</DialogTitle>
          <DialogDescription>黒ナンバーの車両を登録します。車検・自賠責・任意保険の期限は、登録後に「書類」から追加してください。</DialogDescription>
        </DialogHeader>
        {/* 閉じると中身がアンマウントされるため、開くたびにフォーム状態が初期化される */}
        {open && <VehicleForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function VehicleForm({ onOpenChange, mode, choices, vehicle, onSaved }: VehicleDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(mode, vehicle));
  const [errors, setErrors] = useState<FieldErrors>({});

  const driverOptions = useMemo(() => optionsWithSelected(choices.drivers, form.driverId), [choices.drivers, form.driverId]);

  const buildInput = (): VehicleFormInput => ({
    id: mode === "edit" && vehicle ? vehicle.id : null,
    plate: form.plate,
    maker: form.maker,
    model: form.model,
    ownership: form.ownership,
    driver_id: form.driverId,
    lease_monthly: form.leaseMonthly,
    odometer: form.odometer,
    memo: form.memo,
    is_active: form.isActive,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = vehicleInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = mode === "edit" ? await updateVehicleAction(input) : await createVehicleAction(input);
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
      <div className="space-y-1.5">
        <Label htmlFor="vehicle-plate">車両番号</Label>
        <Input
          id="vehicle-plate"
          value={form.plate}
          onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
          placeholder="例: 足立 480 あ 12-34"
          maxLength={40}
          disabled={pending}
          aria-invalid={!!errors.plate}
        />
        <FieldError errors={errors} name="plate" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vehicle-maker">メーカー（任意）</Label>
          <Input id="vehicle-maker" value={form.maker} onChange={(e) => setForm((f) => ({ ...f, maker: e.target.value }))} placeholder="例: ダイハツ" maxLength={50} disabled={pending} />
          <FieldError errors={errors} name="maker" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vehicle-model">車種（任意）</Label>
          <Input id="vehicle-model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="例: ハイゼットカーゴ" maxLength={50} disabled={pending} />
          <FieldError errors={errors} name="model" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vehicle-ownership">所有区分</Label>
          <Select
            id="vehicle-ownership"
            value={form.ownership}
            onChange={(e) => setForm((f) => ({ ...f, ownership: e.target.value as VehicleOwnership }))}
            disabled={pending}
            aria-invalid={!!errors.ownership}
          >
            {VEHICLE_OWNERSHIPS.map((o) => (
              <option key={o} value={o}>
                {VEHICLE_OWNERSHIP_LABELS[o]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="ownership" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vehicle-driver">割当ドライバー（任意）</Label>
          <Select id="vehicle-driver" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} disabled={pending}>
            <option value="">割当なし</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {inactiveSuffix(d.is_active)}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="driver_id" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vehicle-lease">月額リース料（税抜・任意）</Label>
          <NumberInput
            id="vehicle-lease"
            value={form.leaseMonthly}
            onChange={(e) => setForm((f) => ({ ...f, leaseMonthly: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.lease_monthly}
          />
          <FieldError errors={errors} name="lease_monthly" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vehicle-odometer">走行距離 km（任意）</Label>
          <NumberInput
            id="vehicle-odometer"
            value={form.odometer}
            onChange={(e) => setForm((f) => ({ ...f, odometer: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.odometer}
          />
          <FieldError errors={errors} name="odometer" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vehicle-memo">備考（任意）</Label>
        <Textarea id="vehicle-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="vehicle-active">稼働中</Label>
          <p className="text-xs text-muted-foreground">使わなくなった車両は停止中にします（記録は残ります）。</p>
        </div>
        <Switch id="vehicle-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={pending} />
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
