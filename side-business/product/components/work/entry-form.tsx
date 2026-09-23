"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, NumberInput, Select } from "@/components/ui";
import { ResultLine, useFormAction, type FormAction } from "~/components/import/action-form";

export type EntryInitial = { id: string; driverId: string; projectId: string; qty: number; workDate: string | null; note: string | null };

/** 稼働を 1 行足す・直す（ドライバー・案件・数量・日付（任意）・備考） */
export function EntryForm({
  action,
  month,
  drivers,
  projects,
  initial,
  submitLabel,
}: {
  action: FormAction;
  month: string;
  drivers: { id: string; name: string; active: boolean }[];
  projects: { id: string; name: string; unit: string; active: boolean }[];
  initial?: EntryInitial;
  submitLabel: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const formRef = useRef<HTMLFormElement>(null);
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const unit = projects.find((p) => p.id === projectId)?.unit;

  // 足したら入力欄を空に戻す（続けて入れられるように）
  useEffect(() => {
    if (state?.ok && !initial) {
      formRef.current?.reset();
      setProjectId("");
    }
  }, [state, initial]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ドライバー" hint={fe.driverId}>
          <Select name="driverId" defaultValue={initial?.driverId ?? ""} required>
            <option value="" disabled>
              選んでください
            </option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.active ? "" : "（稼働していない）"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="案件" hint={fe.projectId}>
          <Select name="projectId" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)} required>
            <option value="" disabled>
              選んでください
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.unit}）{p.active ? "" : "・使っていない"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={unit ? `数量（${unit}）` : "数量"} hint={fe.qty ?? "全角・カンマつきでも入れられます"}>
          <NumberInput name="qty" defaultValue={initial ? String(initial.qty) : ""} required placeholder="例：120" />
        </Field>
        <Field label="日付（任意）" hint={fe.workDate ?? "1 日ごとに入れるときだけ"}>
          <Input type="date" name="workDate" defaultValue={initial?.workDate ?? ""} />
        </Field>
        <Field label="備考（任意）" hint={fe.note}>
          <Input name="note" defaultValue={initial?.note ?? ""} maxLength={200} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "保存しています…" : submitLabel}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}
