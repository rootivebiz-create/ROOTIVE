"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/db/types";
import { saveDocumentAction } from "@/lib/actions/fleet";
import { documentInputSchema, type DocumentFormInput } from "@/lib/schemas/fleet";
import { expiryLabel, expiryState, DEFAULT_REMINDER_DAYS, type FleetDocument } from "@/lib/fleet/helpers";
import { inactiveSuffix, optionsWithSelected, type FleetChoices } from "./choices";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface DocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  choices: FleetChoices;
  /** 編集対象（mode = "edit"） */
  document?: FleetDocument | null;
  /** 追加時にあらかじめ選んでおく対象 */
  defaultVehicleId?: string;
  defaultDriverId?: string;
  /** 期限の目安を出すための基準日 "YYYY-MM-DD" */
  today: string;
  onSaved?: () => void;
}

type TargetKind = "driver" | "vehicle";

interface FormState {
  target: TargetKind;
  driverId: string;
  vehicleId: string;
  kind: DocumentKind;
  label: string;
  number: string;
  issuedOn: string;
  expiresOn: string;
  reminderDays: string;
  memo: string;
  isActive: boolean;
}

/** ドライバー向け・車両向けでよく使う種類（並び順を変えて選びやすくする） */
const DRIVER_KINDS: DocumentKind[] = ["license", "health_check", "safety_training", "contract", "other"];
const VEHICLE_KINDS: DocumentKind[] = ["vehicle_inspection", "compulsory_insurance", "voluntary_insurance", "contract", "other"];

function kindOptions(target: TargetKind, selected: DocumentKind): DocumentKind[] {
  const preferred = target === "driver" ? DRIVER_KINDS : VEHICLE_KINDS;
  const rest = DOCUMENT_KINDS.filter((k) => !preferred.includes(k));
  const all = [...preferred, ...rest];
  return all.includes(selected) ? all : [selected, ...all];
}

function initialForm(props: DocumentDialogProps): FormState {
  const { mode, document: doc, defaultDriverId = "", defaultVehicleId = "" } = props;
  if (mode === "edit" && doc) {
    return {
      target: doc.vehicleId ? "vehicle" : "driver",
      driverId: doc.driverId,
      vehicleId: doc.vehicleId,
      kind: doc.kind,
      label: doc.label,
      number: doc.number,
      issuedOn: doc.issuedOn,
      expiresOn: doc.expiresOn,
      reminderDays: String(doc.reminderDays || DEFAULT_REMINDER_DAYS),
      memo: doc.memo,
      isActive: doc.isActive,
    };
  }
  const target: TargetKind = defaultVehicleId ? "vehicle" : "driver";
  return {
    target,
    driverId: defaultVehicleId ? "" : defaultDriverId,
    vehicleId: defaultVehicleId,
    kind: target === "vehicle" ? "vehicle_inspection" : "license",
    label: "",
    number: "",
    issuedOn: "",
    expiresOn: "",
    reminderDays: String(DEFAULT_REMINDER_DAYS),
    memo: "",
    isActive: true,
  };
}

export function DocumentDialog(props: DocumentDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "書類を編集" : "書類を追加"}</DialogTitle>
          <DialogDescription>免許証・車検・自賠責・任意保険・健康診断などの有効期限を登録します。期限が近づくとこの画面とダッシュボードで知らせます。</DialogDescription>
        </DialogHeader>
        {open && <DocumentForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function DocumentForm(props: DocumentDialogProps) {
  const { onOpenChange, mode, choices, document: doc, today, onSaved } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(props));
  const [errors, setErrors] = useState<FieldErrors>({});

  const driverOptions = useMemo(() => optionsWithSelected(choices.drivers, form.driverId), [choices.drivers, form.driverId]);
  const vehicleOptions = useMemo(() => optionsWithSelected(choices.vehicles, form.vehicleId), [choices.vehicles, form.vehicleId]);

  const reminderDays = Number(form.reminderDays) || 0;
  const preview = expiryState(form.expiresOn, reminderDays, today);

  const buildInput = (): DocumentFormInput => ({
    id: mode === "edit" && doc ? doc.id : null,
    kind: form.kind,
    driver_id: form.target === "driver" ? form.driverId : "",
    vehicle_id: form.target === "vehicle" ? form.vehicleId : "",
    label: form.label,
    number: form.number,
    issued_on: form.issuedOn,
    expires_on: form.expiresOn,
    reminder_days: form.reminderDays,
    memo: form.memo,
    is_active: form.isActive,
  });

  const submit = (continueAdding: boolean) => {
    const input = buildInput();
    const parsed = documentInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveDocumentAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onSaved?.();
      if (continueAdding) {
        // 対象は保持したまま、書類の内容だけをクリアする
        setForm((f) => ({ ...f, label: "", number: "", issuedOn: "", expiresOn: "", memo: "" }));
      } else {
        onOpenChange(false);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 対象（ドライバー or 車両） */}
      <div className="space-y-1.5">
        <Label htmlFor="document-target">対象</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={form.target === "driver" ? "default" : "outline"}
            onClick={() => setForm((f) => ({ ...f, target: "driver", vehicleId: "", kind: DRIVER_KINDS.includes(f.kind) ? f.kind : "license" }))}
            disabled={pending}
          >
            ドライバー
          </Button>
          <Button
            type="button"
            variant={form.target === "vehicle" ? "default" : "outline"}
            onClick={() => setForm((f) => ({ ...f, target: "vehicle", driverId: "", kind: VEHICLE_KINDS.includes(f.kind) ? f.kind : "vehicle_inspection" }))}
            disabled={pending}
          >
            車両
          </Button>
        </div>
        {form.target === "driver" ? (
          <Select
            id="document-target"
            value={form.driverId}
            onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.driver_id}
            aria-label="ドライバー"
          >
            <option value="">ドライバーを選択</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {inactiveSuffix(d.is_active)}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            id="document-target"
            value={form.vehicleId}
            onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.vehicle_id}
            aria-label="車両"
          >
            <option value="">車両を選択</option>
            {vehicleOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {inactiveSuffix(v.is_active)}
              </option>
            ))}
          </Select>
        )}
        <FieldError errors={errors} name="driver_id" />
        <FieldError errors={errors} name="vehicle_id" />
      </div>

      {/* 種類・名称 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="document-kind">種類</Label>
          <Select id="document-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as DocumentKind }))} disabled={pending} aria-invalid={!!errors.kind}>
            {kindOptions(form.target, form.kind).map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="kind" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-number">番号（任意）</Label>
          <Input id="document-number" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} maxLength={100} disabled={pending} />
          <FieldError errors={errors} name="number" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="document-label">名称（任意）</Label>
        <Input
          id="document-label"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder={`空欄なら「${DOCUMENT_KIND_LABELS[form.kind]}」`}
          maxLength={100}
          disabled={pending}
        />
        <FieldError errors={errors} name="label" />
      </div>

      {/* 取得日・有効期限 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="document-issued">取得日（任意）</Label>
          <Input id="document-issued" type="date" value={form.issuedOn} onChange={(e) => setForm((f) => ({ ...f, issuedOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.issued_on} />
          <FieldError errors={errors} name="issued_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-expires">有効期限</Label>
          <Input
            id="document-expires"
            type="date"
            value={form.expiresOn}
            onChange={(e) => setForm((f) => ({ ...f, expiresOn: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.expires_on}
          />
          <FieldError errors={errors} name="expires_on" />
        </div>
      </div>

      {/* 通知のタイミング */}
      <div className="space-y-1.5">
        <Label htmlFor="document-reminder">何日前から知らせるか</Label>
        <div className="flex items-center gap-2">
          <NumberInput
            id="document-reminder"
            decimal={false}
            value={form.reminderDays}
            onChange={(e) => setForm((f) => ({ ...f, reminderDays: e.target.value }))}
            className="w-24"
            disabled={pending}
            aria-invalid={!!errors.reminder_days}
          />
          <span className="text-sm text-muted-foreground">日前（既定 {DEFAULT_REMINDER_DAYS} 日）</span>
        </div>
        <FieldError errors={errors} name="reminder_days" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="document-memo">備考（任意）</Label>
        <Textarea id="document-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="document-active">この書類を見張る</Label>
          <p className="text-xs text-muted-foreground">更新して不要になった書類は停止中にします（一覧と通知から外れます）。</p>
        </div>
        <Switch id="document-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={pending} />
      </div>

      {form.expiresOn && (
        <Alert variant={preview.status === "expired" ? "destructive" : preview.status === "soon" ? "warning" : "success"}>
          今日（{today.replace(/-/g, "/")}）の時点で <span className="font-semibold">{expiryLabel(preview)}</span> です。
        </Alert>
      )}

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
