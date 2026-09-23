"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, NumberInput, Select } from "@/components/ui";
import { F, ResultLine, useFormAction, type FormAction } from "~/components/form-field";

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
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const formRef = useRef<HTMLFormElement>(null);
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
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
        <F label="ドライバー" error={fe.driverId}>
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
        </F>
        <F label="案件" error={fe.projectId}>
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
        </F>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <F label={unit ? `数量（${unit}）` : "数量"} error={fe.qty} hint="全角・カンマつきでも入れられます">
          <NumberInput name="qty" defaultValue={initial ? String(initial.qty) : ""} required placeholder="例：120" />
        </F>
        <F label="日付（任意）" error={fe.workDate} hint="1 日ごとに入れるときだけ">
          <Input type="date" name="workDate" defaultValue={initial?.workDate ?? ""} />
        </F>
        <F label="備考（任意）" error={fe.note}>
          <Input name="note" defaultValue={initial?.note ?? ""} maxLength={200} />
        </F>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "保存しています…" : submitLabel}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}
