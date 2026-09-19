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
import { Textarea } from "@/components/ui/textarea";
import { INSTRUCTION_KIND_LABELS, type DriverInstruction } from "@/lib/db/types";
import { saveInstructionAction } from "@/lib/actions/fleet";
import { instructionInputSchema, INSTRUCTION_KINDS, type InstructionFormInput, type InstructionKind } from "@/lib/schemas/fleet";
import { inactiveSuffix, optionsWithSelected, type ChoiceOption } from "./choices";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface InstructionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  drivers: ChoiceOption[];
  instruction?: DriverInstruction | null;
  /** 追加時にあらかじめ選んでおくドライバー */
  defaultDriverId?: string;
  /** 追加時の既定の種類 */
  defaultKind?: InstructionKind;
  /** 実施日の既定（日本時間の今日） */
  today: string;
  onSaved?: () => void;
}

interface FormState {
  driverId: string;
  kind: InstructionKind;
  instructedOn: string;
  hours: string;
  topics: string;
  instructor: string;
  memo: string;
}

function initialForm(props: InstructionDialogProps): FormState {
  const { mode, instruction, defaultDriverId = "", defaultKind = "regular", today } = props;
  if (mode === "edit" && instruction) {
    return {
      driverId: instruction.driver_id,
      kind: (INSTRUCTION_KINDS as readonly string[]).includes(instruction.kind) ? (instruction.kind as InstructionKind) : "regular",
      instructedOn: instruction.instructed_on,
      hours: instruction.hours ? String(instruction.hours) : "",
      topics: instruction.topics,
      instructor: instruction.instructor,
      memo: instruction.memo,
    };
  }
  return { driverId: defaultDriverId, kind: defaultKind, instructedOn: today, hours: defaultKind === "initial" ? "15" : "", topics: "", instructor: "", memo: "" };
}

export function InstructionDialog(props: InstructionDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "指導・監督の記録を編集" : "指導・監督を記録"}</DialogTitle>
          <DialogDescription>運転者への指導・監督の記録です。初任運転者には運転させる前に特別な指導（15 時間以上）が必要で、記録は 3 年間保存します。</DialogDescription>
        </DialogHeader>
        {open && <InstructionForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function InstructionForm(props: InstructionDialogProps) {
  const { onOpenChange, mode, drivers, instruction, onSaved } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(props));
  const [errors, setErrors] = useState<FieldErrors>({});

  const driverOptions = useMemo(() => optionsWithSelected(drivers, form.driverId), [drivers, form.driverId]);
  const hoursNum = Number(form.hours.replace(/[^\d.]/g, "")) || 0;

  const buildInput = (): InstructionFormInput => ({
    id: mode === "edit" && instruction ? instruction.id : null,
    driver_id: form.driverId,
    kind: form.kind,
    instructed_on: form.instructedOn,
    hours: form.hours,
    topics: form.topics,
    instructor: form.instructor,
    memo: form.memo,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = instructionInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      if (!form.driverId) fe.driver_id = ["ドライバーを選択してください"];
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveInstructionAction(input);
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
        <Label htmlFor="instruction-driver">ドライバー</Label>
        <Select id="instruction-driver" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} disabled={pending} aria-invalid={!!errors.driver_id}>
          <option value="">ドライバーを選択</option>
          {driverOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {inactiveSuffix(d.is_active)}
            </option>
          ))}
        </Select>
        <FieldError errors={errors} name="driver_id" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="instruction-kind">種類</Label>
          <Select id="instruction-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as InstructionKind }))} disabled={pending}>
            {INSTRUCTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {INSTRUCTION_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="kind" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="instruction-date">実施日</Label>
          <Input
            id="instruction-date"
            type="date"
            value={form.instructedOn}
            onChange={(e) => setForm((f) => ({ ...f, instructedOn: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.instructed_on}
          />
          <FieldError errors={errors} name="instructed_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="instruction-hours">実施時間（時間）</Label>
          <NumberInput id="instruction-hours" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} placeholder="0" disabled={pending} aria-invalid={!!errors.hours} />
          <FieldError errors={errors} name="hours" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="instruction-topics">内容</Label>
        <Textarea
          id="instruction-topics"
          value={form.topics}
          onChange={(e) => setForm((f) => ({ ...f, topics: e.target.value }))}
          rows={3}
          placeholder="例: 事業用自動車を運転する心構え、安全運行の基本、健康管理、日常点検の方法"
          disabled={pending}
        />
        <FieldError errors={errors} name="topics" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="instruction-instructor">実施者（任意）</Label>
        <Input id="instruction-instructor" value={form.instructor} onChange={(e) => setForm((f) => ({ ...f, instructor: e.target.value }))} maxLength={100} disabled={pending} />
        <FieldError errors={errors} name="instructor" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="instruction-memo">備考（任意）</Label>
        <Textarea id="instruction-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      {form.kind === "initial" && hoursNum < 15 && <Alert variant="warning">初任運転者への特別な指導は 15 時間以上が必要です（実技を除く）。</Alert>}

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
