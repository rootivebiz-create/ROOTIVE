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
import { INCIDENT_KIND_LABELS, type Incident, type IncidentKind } from "@/lib/db/types";
import { saveIncidentAction } from "@/lib/actions/fleet";
import { incidentInputSchema, INCIDENT_KINDS, type IncidentFormInput } from "@/lib/schemas/fleet";
import { isoToLocalInput } from "@/lib/fleet/helpers";
import { inactiveSuffix, optionsWithSelected, type ChoiceOption } from "./choices";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface IncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  drivers: ChoiceOption[];
  vehicles: ChoiceOption[];
  incident?: Incident | null;
  /** 発生日時の既定（日本時間の今日 "YYYY-MM-DD"） */
  today: string;
  onSaved?: () => void;
}

interface FormState {
  driverId: string;
  vehicleId: string;
  occurredAt: string;
  kind: IncidentKind;
  place: string;
  description: string;
  cause: string;
  prevention: string;
  reported: boolean;
  cost: string;
  memo: string;
}

function initialForm(props: IncidentDialogProps): FormState {
  const { mode, incident, today } = props;
  if (mode === "edit" && incident) {
    return {
      driverId: incident.driver_id ?? "",
      vehicleId: incident.vehicle_id ?? "",
      occurredAt: isoToLocalInput(incident.occurred_at),
      kind: incident.kind,
      place: incident.place,
      description: incident.description,
      cause: incident.cause,
      prevention: incident.prevention,
      reported: incident.reported,
      cost: incident.cost ? String(incident.cost) : "",
      memo: incident.memo,
    };
  }
  return {
    driverId: "",
    vehicleId: "",
    occurredAt: `${today}T09:00`,
    kind: "accident",
    place: "",
    description: "",
    cause: "",
    prevention: "",
    reported: false,
    cost: "",
    memo: "",
  };
}

export function IncidentDialog(props: IncidentDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "事故の記録を編集" : "事故・違反・ヒヤリハットを記録"}</DialogTitle>
          <DialogDescription>原因と再発防止策まで残すことが大切です。ヒヤリハットも記録しておくと、同じ事故を防げます。</DialogDescription>
        </DialogHeader>
        {open && <IncidentForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function IncidentForm(props: IncidentDialogProps) {
  const { onOpenChange, mode, drivers, vehicles, incident, onSaved } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(props));
  const [errors, setErrors] = useState<FieldErrors>({});

  const driverOptions = useMemo(() => optionsWithSelected(drivers, form.driverId), [drivers, form.driverId]);
  const vehicleOptions = useMemo(() => optionsWithSelected(vehicles, form.vehicleId), [vehicles, form.vehicleId]);

  const buildInput = (): IncidentFormInput => ({
    id: mode === "edit" && incident ? incident.id : null,
    driver_id: form.driverId,
    vehicle_id: form.vehicleId,
    occurred_at: form.occurredAt,
    kind: form.kind,
    place: form.place,
    description: form.description,
    cause: form.cause,
    prevention: form.prevention,
    reported: form.reported,
    cost: form.cost,
    memo: form.memo,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = incidentInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveIncidentAction(input);
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
          <Label htmlFor="incident-at">発生日時</Label>
          <Input
            id="incident-at"
            type="datetime-local"
            value={form.occurredAt}
            onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.occurred_at}
          />
          <FieldError errors={errors} name="occurred_at" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="incident-kind">種類</Label>
          <Select id="incident-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as IncidentKind }))} disabled={pending}>
            {INCIDENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {INCIDENT_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="kind" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="incident-driver">ドライバー（任意）</Label>
          <Select id="incident-driver" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} disabled={pending}>
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
          <Label htmlFor="incident-vehicle">車両（任意）</Label>
          <Select id="incident-vehicle" value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))} disabled={pending}>
            <option value="">指定なし</option>
            {vehicleOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {inactiveSuffix(v.is_active)}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="vehicle_id" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-place">場所（任意）</Label>
        <Input id="incident-place" value={form.place} onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))} maxLength={200} placeholder="例: 東京都足立区○○ 交差点" disabled={pending} />
        <FieldError errors={errors} name="place" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-description">内容</Label>
        <Textarea id="incident-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} disabled={pending} />
        <FieldError errors={errors} name="description" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-cause">原因</Label>
        <Textarea id="incident-cause" value={form.cause} onChange={(e) => setForm((f) => ({ ...f, cause: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="cause" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-prevention">再発防止策</Label>
        <Textarea id="incident-prevention" value={form.prevention} onChange={(e) => setForm((f) => ({ ...f, prevention: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="prevention" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="incident-cost">費用（税抜・任意）</Label>
          <NumberInput id="incident-cost" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} placeholder="0" disabled={pending} aria-invalid={!!errors.cost} />
          <FieldError errors={errors} name="cost" />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
          <div>
            <Label htmlFor="incident-reported">報告済み</Label>
            <p className="text-xs text-muted-foreground">取引先・保険会社・運輸支局などへの報告が済んでいる。</p>
          </div>
          <Switch id="incident-reported" checked={form.reported} onCheckedChange={(v) => setForm((f) => ({ ...f, reported: v }))} disabled={pending} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incident-memo">備考（任意）</Label>
        <Textarea id="incident-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
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
