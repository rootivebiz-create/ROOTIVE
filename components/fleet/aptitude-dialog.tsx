"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APTITUDE_KIND_LABELS, type AptitudeTest } from "@/lib/db/types";
import { saveAptitudeAction } from "@/lib/actions/fleet";
import { aptitudeInputSchema, APTITUDE_KINDS, type AptitudeFormInput, type AptitudeKindInput } from "@/lib/schemas/fleet";
import { inactiveSuffix, optionsWithSelected, type ChoiceOption } from "./choices";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface AptitudeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  drivers: ChoiceOption[];
  test?: AptitudeTest | null;
  defaultDriverId?: string;
  defaultKind?: AptitudeKindInput;
  /** 受診日の既定（日本時間の今日） */
  today: string;
  onSaved?: () => void;
}

interface FormState {
  driverId: string;
  kind: AptitudeKindInput;
  takenOn: string;
  institution: string;
  result: string;
  memo: string;
}

function initialForm(props: AptitudeDialogProps): FormState {
  const { mode, test, defaultDriverId = "", defaultKind = "general", today } = props;
  if (mode === "edit" && test) {
    return {
      driverId: test.driver_id,
      kind: (APTITUDE_KINDS as readonly string[]).includes(test.kind) ? (test.kind as AptitudeKindInput) : "general",
      takenOn: test.taken_on,
      institution: test.institution,
      result: test.result,
      memo: test.memo,
    };
  }
  return { driverId: defaultDriverId, kind: defaultKind, takenOn: today, institution: "", result: "", memo: "" };
}

export function AptitudeDialog(props: AptitudeDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "適性診断の記録を編集" : "適性診断を記録"}</DialogTitle>
          <DialogDescription>
            初任診断は運転者に選任したとき、適齢診断は 65 歳以上で 3 年ごとに受けます。記録は運転者台帳に載ります。
          </DialogDescription>
        </DialogHeader>
        {open && <AptitudeForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function AptitudeForm(props: AptitudeDialogProps) {
  const { onOpenChange, mode, drivers, test, onSaved } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(props));
  const [errors, setErrors] = useState<FieldErrors>({});

  const driverOptions = useMemo(() => optionsWithSelected(drivers, form.driverId), [drivers, form.driverId]);

  const buildInput = (): AptitudeFormInput => ({
    id: mode === "edit" && test ? test.id : null,
    driver_id: form.driverId,
    kind: form.kind,
    taken_on: form.takenOn,
    institution: form.institution,
    result: form.result,
    memo: form.memo,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = aptitudeInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      if (!form.driverId) fe.driver_id = ["ドライバーを選択してください"];
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveAptitudeAction(input);
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
        <Label htmlFor="aptitude-driver">ドライバー</Label>
        <Select
          id="aptitude-driver"
          value={form.driverId}
          onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
          disabled={pending}
          aria-invalid={!!errors.driver_id}
        >
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="aptitude-kind">種類</Label>
          <Select id="aptitude-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as AptitudeKindInput }))} disabled={pending}>
            {APTITUDE_KINDS.map((k) => (
              <option key={k} value={k}>
                {APTITUDE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="kind" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="aptitude-date">受診日</Label>
          <Input
            id="aptitude-date"
            type="date"
            value={form.takenOn}
            onChange={(e) => setForm((f) => ({ ...f, takenOn: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.taken_on}
          />
          <FieldError errors={errors} name="taken_on" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="aptitude-institution">実施機関（任意）</Label>
        <Input
          id="aptitude-institution"
          value={form.institution}
          onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
          maxLength={100}
          placeholder="例: 適性診断センター"
          disabled={pending}
        />
        <FieldError errors={errors} name="institution" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="aptitude-result">結果（任意）</Label>
        <Input
          id="aptitude-result"
          value={form.result}
          onChange={(e) => setForm((f) => ({ ...f, result: e.target.value }))}
          maxLength={200}
          placeholder="例: 良"
          disabled={pending}
        />
        <FieldError errors={errors} name="result" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="aptitude-memo">備考（任意）</Label>
        <Textarea id="aptitude-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
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
