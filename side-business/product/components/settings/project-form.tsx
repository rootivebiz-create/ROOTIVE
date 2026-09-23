"use client";

import { useEffect, useRef, useState } from "react";
import { Input, NumberInput, Select } from "@/components/ui";
import { marginOf, rateText, readNumber } from "~/server/features/settings/format";
import { Callout, Check, F, ResultLine, SubmitRow, useFormAction, type FormAction } from "./form-kit";

export type ProjectInitial = {
  id?: string;
  clientId: string;
  name: string;
  aliases: string;
  unit: string;
  billRate: string;
  payRate: string;
  active: boolean;
};

const UNITS = ["個", "件", "日", "時間", "便", "台", "回"];

/** 案件の追加・変更。受注 − 支払（1 数量あたりの粗利）をその場で出す */
export function ProjectForm({
  action,
  initial,
  clients,
  submitLabel,
  overrides = 0,
}: {
  action: FormAction;
  initial?: ProjectInitial;
  clients: { id: string; name: string }[];
  submitLabel: string;
  /** この案件のドライバー別の単価の数（単価を変えるときの注意に使う） */
  overrides?: number;
}) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const ref = useRef<HTMLFormElement>(null);
  const [bill, setBill] = useState(initial?.billRate ?? "");
  const [pay, setPay] = useState(initial?.payRate ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "個");
  useEffect(() => {
    if (state?.ok && !initial?.id) {
      ref.current?.reset();
      setBill("");
      setPay("");
      setUnit("個");
    }
  }, [state, initial?.id]);

  const b = readNumber(bill);
  const p = readNumber(pay);
  const ok = (n: number | null): n is number => n !== null && !Number.isNaN(n);
  const m = ok(b) && ok(p) ? marginOf(b, p) : null;
  const before = initial?.id ? readNumber(initial.payRate) : null;
  const lowered = ok(before) && ok(p) && p < before;
  const listId = `units-${initial?.id ?? "new"}`;

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="案件の名前" error={fe.name}>
          <Input name="name" defaultValue={initial?.name ?? ""} required maxLength={100} placeholder="例：宅配（個建て）" autoComplete="off" />
        </F>
        <F label="元請" error={fe.clientId}>
          <Select name="clientId" defaultValue={initial?.clientId ?? ""}>
            <option value="">（元請なし）</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="数量の単位" error={fe.unit} hint="個・件・日・時間・便・台・回 など。ほかの書き方も入れられます">
          <Input name="unit" value={unit} onChange={(e) => setUnit(e.currentTarget.value)} list={listId} required maxLength={10} autoComplete="off" />
          <datalist id={listId}>
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </F>
        <F label="別名（任意）" error={fe.aliases} hint="Excel での書き方が違うとき。「、」かカンマで区切る">
          <Input name="aliases" defaultValue={initial?.aliases ?? ""} autoComplete="off" />
        </F>
        <F label={`受注単価（税抜・1${unit || "数量"}あたり）`} error={fe.billRate} hint="元請からもらう額。突合と利益に使います">
          <NumberInput name="billRate" value={bill} onChange={(e) => setBill(e.currentTarget.value)} required placeholder="例：190" />
        </F>
        <F label={`支払単価（税抜・1${unit || "数量"}あたり）`} error={fe.payRate} hint="ドライバーへ払う標準の額。人ごとに違うときは「人ごとの単価」で">
          <NumberInput name="payRate" value={pay} onChange={(e) => setPay(e.currentTarget.value)} required placeholder="例：150" />
        </F>
      </div>
      {m && (
        <p className="text-sm">
          1{unit || "数量"}あたりの粗利（受注 − 支払）：<span className={m.loss ? "font-bold text-danger" : "font-bold"}>{m.label}</span>
        </p>
      )}
      {m?.loss && <Callout tone="red">支払単価が受注単価より高くなっています（1{unit}あたり {rateText(-m.perUnit)} の持ち出し）。入れ間違いでないか確かめてください。</Callout>}
      {ok(b) && b === 0 && <Callout tone="yellow">受注単価が 0 円です。元請との突合と利益の計算に使うので、分かれば入れてください。</Callout>}
      {lowered && (
        <Callout tone="yellow">
          支払単価を下げようとしています。すでに仕事をした分に下げた単価を当てると、報酬の減額にあたるおそれがあります（フリーランス法 第5条）。変えるときはドライバーと合意し、取引条件の変更を書面等で明示してください。まだ締めていない月の明細は、作り直すと新しい単価になります。
        </Callout>
      )}
      {initial?.id && overrides > 0 && (
        <p className="text-xs text-muted-foreground">この案件には人ごとの単価が {overrides}件 あります。その人たちは、標準を変えても人ごとの単価のままです。</p>
      )}
      {/* 使う・使わないの切り替えは、登録したあとは下のボタンで（ここの古い値で戻さないように） */}
      {!initial?.id && (
        <Check name="active" defaultChecked={initial?.active ?? true} label="使っている" hint="外すと、取り込みの候補や選ぶところで後ろに回ります。記録は残ります" />
      )}
      <ResultLine state={state} />
      <SubmitRow pending={pending} label={submitLabel} />
    </form>
  );
}
