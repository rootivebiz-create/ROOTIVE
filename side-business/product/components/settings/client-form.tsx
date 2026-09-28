"use client";

import { useEffect, useRef } from "react";
import { Input, Select } from "@/components/ui";
import { F, ResultLine, SubmitRow, useFormAction, type FormAction } from "./form-kit";

export type ClientInitial = { id?: string; name: string; aliases: string; closingDay: number; notes: string };

const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

/** 元請の追加・変更 */
export function ClientForm({ action, initial, submitLabel }: { action: FormAction; initial?: ClientInitial; submitLabel: string }) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const ref = useRef<HTMLFormElement>(null);
  // 足したら空に戻す（続けて入れられるように）
  useEffect(() => {
    if (state?.ok && !initial?.id) ref.current?.reset();
  }, [state, initial?.id]);
  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="元請の名前" error={fe.name}>
          <Input name="name" defaultValue={initial?.name ?? ""} required maxLength={100} placeholder="例：A物流株式会社" autoComplete="off" />
        </F>
        <F label="元請の締め日" error={fe.closingDay} hint="元請からの支払通知の締め">
          <Select name="closingDay" defaultValue={String(initial?.closingDay ?? 0)}>
            <option value="0">末日</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </Select>
        </F>
      </div>
      <F label="別名（任意）" error={fe.aliases} hint="支払通知や Excel での書き方が違うとき。「、」かカンマで区切る">
        <Input name="aliases" defaultValue={initial?.aliases ?? ""} autoComplete="off" />
      </F>
      <F label="メモ（任意）" error={fe.notes}>
        <textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} maxLength={500} className="block min-h-11 w-full rounded-lg border border-border bg-card px-3 py-2 text-base" />
      </F>
      <ResultLine state={state} />
      <SubmitRow pending={pending} label={submitLabel} />
    </form>
  );
}
