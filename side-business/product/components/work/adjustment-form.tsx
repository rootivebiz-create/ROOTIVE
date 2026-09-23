"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, NumberInput, Select } from "@/components/ui";
import { ResultLine, useFormAction, type FormAction } from "~/components/import/action-form";

export type AdjustmentInitial = {
  id: string;
  driverId: string;
  label: string;
  amount: number;
  taxable: boolean;
  agreedInWriting: boolean;
  basis: string | null;
};

const FL_QA = "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html";

/** その月だけの足し引き（立替の精算・事故の負担 など）。マイナスを打たなくてよいように「足す／引く」を選ぶ */
export function AdjustmentForm({
  action,
  month,
  drivers,
  initial,
  submitLabel,
}: {
  action: FormAction;
  month: string;
  drivers: { id: string; name: string; active: boolean }[];
  initial?: AdjustmentInitial;
  submitLabel: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const formRef = useRef<HTMLFormElement>(null);
  const [direction, setDirection] = useState<"plus" | "minus">(initial && initial.amount < 0 ? "minus" : "plus");
  const [agreed, setAgreed] = useState(initial?.agreedInWriting ?? false);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  useEffect(() => {
    if (state?.ok && !initial) {
      formRef.current?.reset();
      setDirection("plus");
      setAgreed(false);
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
        <Field label="内容" hint={fe.label ?? "明細にこのまま出ます（例：駐車場代の立替・高速代の立替）"}>
          <Input name="label" defaultValue={initial?.label ?? ""} required maxLength={60} />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-bold">支払を</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(
            [
              ["plus", "増やす（＋ 立替の精算 など）"],
              ["minus", "減らす（− 差し引き）"],
            ] as const
          ).map(([v, label]) => (
            <label
              key={v}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${direction === v ? "border-foreground bg-muted font-bold" : "border-border"}`}
            >
              <input type="radio" name="direction" value={v} checked={direction === v} onChange={() => setDirection(v)} className="h-4 w-4" />
              {label}
            </label>
          ))}
        </div>
        {fe.direction && <p className="mt-1 text-xs text-danger">{fe.direction}</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="金額（円）" hint={fe.amount ?? "1 円単位。全角・カンマつきでも入れられます"}>
          <NumberInput name="amount" inputMode="numeric" defaultValue={initial ? String(Math.abs(initial.amount)) : ""} required placeholder="例：3,300" />
        </Field>
        <Field label="根拠（任意）" hint={fe.basis ?? "領収書・事故の報告・合意書 など"}>
          <Input name="basis" defaultValue={initial?.basis ?? ""} maxLength={200} />
        </Field>
      </div>

      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="taxable" defaultChecked={initial?.taxable ?? false} className="mt-1 h-5 w-5 shrink-0" />
        <span>
          消費税の対象にする
          <span className="block text-xs text-muted-foreground">
            立替の精算などは対象にしないことが多いです。どちらか迷うときは、税理士の先生に確かめることをおすすめします。
          </span>
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="agreedInWriting" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} className="mt-1 h-5 w-5 shrink-0" />
        <span>
          書面で合意している
          <span className="block text-xs text-muted-foreground">契約書・合意書などに、この差し引き（または精算）の決まりが書いてあるとき。</span>
        </span>
      </label>
      {direction === "minus" && !agreed && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          書面での合意の記録が無い差し引きは、見張り番が「報酬の減額のおそれ（フリーランス法 第5条）」として知らせます。合意の有無と内容の確認をおすすめします。
          <a href={FL_QA} target="_blank" rel="noopener noreferrer" className="ml-1">
            公正取引委員会の Q&amp;A
          </a>
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "保存しています…" : submitLabel}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}
