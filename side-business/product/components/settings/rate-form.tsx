"use client";

import { useEffect, useRef, useState } from "react";
import { Input, NumberInput, Select } from "@/components/ui";
import { jpDate } from "@/lib/format";
import { RATE_CHANGE_HINT, rateText, readNumber } from "~/server/features/settings/format";
import { Callout, F, ResultLine, SubmitRow, useFormAction, type FormAction } from "./form-kit";
import { OpenMonthConfirm } from "./open-month-confirm";

export type RateProject = { id: string; name: string; clientName: string | null; unit: string; payRate: number; billRate: number; active: boolean };
export type RateDriver = { id: string; name: string; code: string | null; active: boolean };
export type RateExisting = { driverId: string; projectId: string; payRate: number; agreedOn: string | null };

/**
 * ドライバー別の単価を登録する（同じ人 × 案件がすでにあれば上書き）。
 * 選んだ案件の標準の単価と、標準との差をその場で出す。
 */
export function RateForm({
  action,
  drivers,
  projects,
  existing,
  initial,
  today,
}: {
  action: FormAction;
  drivers: RateDriver[];
  projects: RateProject[];
  existing: RateExisting[];
  initial?: { driverId: string; projectId: string; payRate: string; agreedOn: string; fixed?: boolean };
  today: string;
}) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const ref = useRef<HTMLFormElement>(null);
  const [driverId, setDriverId] = useState(initial?.driverId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [rate, setRate] = useState(initial?.payRate ?? "");
  const [agreedOn, setAgreedOn] = useState(initial?.agreedOn ?? "");
  const fixed = !!initial?.fixed;
  useEffect(() => {
    if (state?.ok && !fixed) {
      ref.current?.reset();
      setProjectId("");
      setRate("");
      setAgreedOn("");
    }
  }, [state, fixed]);

  const project = projects.find((p) => p.id === projectId);
  const already = !fixed ? existing.find((e) => e.driverId === driverId && e.projectId === projectId) : undefined;
  const n = readNumber(rate);
  const valid = n !== null && !Number.isNaN(n);
  const diff = valid && project ? Math.round((n - project.payRate) * 1e4) / 1e4 : null;
  const prev = fixed ? readNumber(initial?.payRate) : null;
  const lowered = valid && ((diff !== null && diff < 0) || (prev !== null && !Number.isNaN(prev) && n < prev));

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      {fixed ? (
        <>
          <input type="hidden" name="driverId" value={driverId} />
          <input type="hidden" name="projectId" value={projectId} />
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="ドライバー" error={fe.driverId}>
            <Select name="driverId" value={driverId} onChange={(e) => setDriverId(e.currentTarget.value)} required>
              <option value="" disabled>
                選んでください
              </option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code ? `${d.code} ` : ""}
                  {d.name}
                  {d.active ? "" : "（無効）"}
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
                  {p.name}
                  {p.clientName ? `（${p.clientName}）` : ""}
                  {p.active ? "" : "・使わない"}
                </option>
              ))}
            </Select>
          </F>
        </div>
      )}
      {project && (
        <p className="text-sm text-muted-foreground">
          この案件の標準：支払 {rateText(project.payRate)}・受注 {rateText(project.billRate)}（1{project.unit}あたり・税抜）
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <F label={`この人の支払単価（税抜${project ? `・1${project.unit}あたり` : ""}）`} error={fe.payRate}>
          <NumberInput name="payRate" value={rate} onChange={(e) => setRate(e.currentTarget.value)} required placeholder="例：155" />
        </F>
        <F label="この単価で合意した日" error={fe.agreedOn} hint={RATE_CHANGE_HINT}>
          <div className="flex gap-2">
            <Input type="date" name="agreedOn" value={agreedOn} onChange={(e) => setAgreedOn(e.currentTarget.value)} className="min-w-0 flex-1" />
            <button type="button" onClick={() => setAgreedOn(today)} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-muted">
              今日
            </button>
          </div>
        </F>
      </div>
      {diff !== null && project && (
        <p className="text-sm">
          標準との差：<span className="num font-bold">{diff > 0 ? `+${rateText(diff)}` : diff < 0 ? `−${rateText(-diff)}` : "同じ"}</span>
          {diff === 0 && "（標準と同じなので、登録しなくても同じ金額になります）"}
        </p>
      )}
      {valid && project && n > project.billRate && <Callout tone="red">この人の支払単価が、受注単価（{rateText(project.billRate)}）より高くなっています。入れ間違いでないか確かめてください。</Callout>}
      {lowered && (
        <Callout tone="yellow">{diff !== null && diff < 0 ? "標準より低い単価です。" : "前の単価より下げています。"}すでに仕事をした分に当てると、報酬の減額にあたるおそれがあります（フリーランス法 第5条）。合意の日と、取引条件の明示の記録を残してください。</Callout>
      )}
      {!agreedOn && valid && <Callout tone="yellow">合意した日が空です。{RATE_CHANGE_HINT}</Callout>}
      {already && (
        <Callout tone="gray">
          この人 × この案件には、すでに {rateText(already.payRate)}
          {already.agreedOn ? `（${jpDate(already.agreedOn)} 合意）` : ""} があります。保存すると上書きします。
        </Callout>
      )}
      <ResultLine state={state} />
      <OpenMonthConfirm state={state} />
      <SubmitRow pending={pending} label={fixed ? "保存" : already ? "上書きする" : "登録する"} />
    </form>
  );
}
