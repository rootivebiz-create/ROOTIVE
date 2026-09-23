"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input, NumberInput, Select } from "@/components/ui";
import type { Rounding } from "@/lib/payroll/types";
import { FEE_BEARER_WARNING, NO_AGREEMENT_WARNING, percentToRate, readNumber, rulePreview } from "~/server/features/settings/format";
import { Callout, Check, Choice, F, ResultLine, SubmitRow, useFormAction, type FormAction } from "./form-kit";

export type RuleKind = "percent" | "fixed" | "per_unit";

export type RuleInitial = {
  id?: string;
  name: string;
  driverId: string;
  kind: RuleKind;
  value: string;
  onlyWhenWorked: boolean;
  taxable: boolean;
  agreedInWriting: boolean;
  agreedOn: string;
  basis: string;
  active: boolean;
  sort: string;
};

const EMPTY: RuleInitial = {
  name: "",
  driverId: "",
  kind: "percent",
  value: "",
  onlyWhenWorked: true,
  taxable: true,
  agreedInWriting: false,
  agreedOn: "",
  basis: "",
  active: true,
  sort: "",
};

/** よくある控除のひな形（押すと入力欄に入る。額は会社ごとに入れる） */
const PRESETS: { label: string; values: Partial<RuleInitial> }[] = [
  { label: "ロイヤリティ 10%", values: { name: "ロイヤリティ", kind: "percent", value: "10", onlyWhenWorked: true, taxable: true } },
  { label: "管理費 定額", values: { name: "管理費", kind: "fixed", value: "", onlyWhenWorked: true, taxable: true } },
  { label: "車両リース 定額（稼働が無くても）", values: { name: "車両リース", kind: "fixed", value: "", onlyWhenWorked: false, taxable: true } },
  { label: "保険 定額", values: { name: "保険", kind: "fixed", value: "", onlyWhenWorked: true, taxable: false } },
];

const KIND_OPTIONS = [
  { id: "percent", label: "委託料 × 率", help: "例：ロイヤリティ 10%（委託料は税抜）" },
  { id: "fixed", label: "毎月の定額", help: "例：管理費 15,000円・車両リース 32,000円" },
  { id: "per_unit", label: "数量 × 単価", help: "例：1 個あたり 10円（その月の数量の合計に掛ける）" },
] as const;

export function RuleForm({
  action,
  initial,
  drivers,
  rounding,
  feeWords,
  damageWords,
  submitLabel,
  defaultDriverId,
}: {
  action: FormAction;
  initial?: RuleInitial;
  drivers: { id: string; name: string; code: string | null; active: boolean }[];
  rounding: { amount: Rounding; tax: Rounding };
  /** 振込手数料・事故の負担に見える名前（正規表現の文字） */
  feeWords: string;
  damageWords: string;
  submitLabel: string;
  defaultDriverId?: string;
}) {
  const start = initial ?? { ...EMPTY, driverId: defaultDriverId ?? "" };
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const ref = useRef<HTMLFormElement>(null);
  const [v, setV] = useState<RuleInitial>(start);
  const set = <K extends keyof RuleInitial>(key: K, value: RuleInitial[K]) => setV((cur) => ({ ...cur, [key]: value }));
  useEffect(() => {
    if (state?.ok && !initial?.id) setV({ ...EMPTY, driverId: defaultDriverId ?? "" });
  }, [state, initial?.id, defaultDriverId]);

  const fee = useMemo(() => new RegExp(feeWords), [feeWords]);
  const damage = useMemo(() => new RegExp(damageWords), [damageWords]);
  const n = readNumber(v.value);
  const valid = n !== null && !Number.isNaN(n) && n > 0;
  const preview = valid
    ? rulePreview(
        {
          kind: v.kind,
          rate: v.kind === "percent" ? percentToRate(n) : v.kind === "per_unit" ? n : null,
          amount: v.kind === "fixed" ? n : null,
          taxable: v.taxable,
          onlyWhenWorked: v.onlyWhenWorked,
        },
        rounding,
      )
    : null;
  const valueLabel = v.kind === "percent" ? "率（%）" : v.kind === "per_unit" ? "1 数量あたりの額（円）" : "毎月の額（円）";

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      {!initial?.id && (
        <div>
          <p className="text-sm font-bold">ひな形から始める</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setV((cur) => ({ ...cur, ...p.values, agreedInWriting: cur.agreedInWriting }))}
                className="min-h-11 rounded-full border border-border bg-card px-3 text-sm hover:bg-muted"
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">額と、消費税・稼働の扱いは、会社の契約に合わせて直してください。</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="控除の名前" error={fe.name} hint="明細にこの名前で載ります">
          <Input name="name" value={v.name} onChange={(e) => set("name", e.currentTarget.value)} required maxLength={60} placeholder="例：ロイヤリティ" autoComplete="off" />
        </F>
        <F label="だれに当てるか" error={fe.driverId}>
          <Select name="driverId" value={v.driverId} onChange={(e) => set("driverId", e.currentTarget.value)}>
            <option value="">全員</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code ? `${d.code} ` : ""}
                {d.name}だけ{d.active ? "" : "（無効）"}
              </option>
            ))}
          </Select>
        </F>
      </div>
      {fee.test(v.name) && <Callout tone="red">{FEE_BEARER_WARNING}振込手数料は控除のルールにせず、会社の負担にする設定の確認をおすすめします。</Callout>}
      {damage.test(v.name) && <Callout tone="yellow">事故・破損などの負担を差し引くときは、その都度の根拠（事故の報告・合意書など）を残してください。</Callout>}
      <div>
        <p className="mb-1 text-sm font-bold">引き方</p>
        <input type="hidden" name="kind" value={v.kind} />
        <Choice name="kindChoice" value={v.kind} onChange={(k) => set("kind", k)} options={KIND_OPTIONS} />
        {fe.kind && <p className="mt-1 text-xs font-bold text-danger">{fe.kind}</p>}
      </div>
      <F label={valueLabel} error={fe.value} hint={v.kind === "percent" ? "10 と入れると 10%" : "全角・カンマつきでも入れられます"}>
        <NumberInput name="value" value={v.value} onChange={(e) => set("value", e.currentTarget.value)} required placeholder={v.kind === "percent" ? "例：10" : v.kind === "fixed" ? "例：15,000" : "例：10"} className="max-w-48" />
      </F>
      {preview && <Callout tone="green">{preview}</Callout>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Check
          name="onlyWhenWorked"
          checked={v.onlyWhenWorked}
          onChange={(c) => set("onlyWhenWorked", c)}
          label="稼働がある月だけ引く"
          hint="外すと、稼働が無い月も引きます（車両リースなど）"
        />
        <Check
          name="taxable"
          checked={v.taxable}
          onChange={(c) => set("taxable", c)}
          label="消費税をかける（会社の売上）"
          hint="かけると、控除額の10%も合わせて差し引きます。扱いに迷うときは税理士に"
        />
      </div>
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Check
          name="agreedInWriting"
          checked={v.agreedInWriting}
          onChange={(c) => set("agreedInWriting", c)}
          label="取引条件（契約書など）に書いて、ドライバーと合意している"
        />
        {!v.agreedInWriting && <Callout tone="red">{NO_AGREEMENT_WARNING}（フリーランス法 第5条）。合意したら、書面の名前と日付を残してください。</Callout>}
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="合意した日" error={fe.agreedOn} hint="支払の対象の期間が始まる前か、を見張り番が見ます">
            <Input type="date" name="agreedOn" value={v.agreedOn} onChange={(e) => set("agreedOn", e.currentTarget.value)} />
          </F>
          <F label="根拠（任意）" error={fe.basis} hint="例：業務委託契約 第8条">
            <Input name="basis" value={v.basis} onChange={(e) => set("basis", e.currentTarget.value)} maxLength={200} autoComplete="off" />
          </F>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Check name="active" checked={v.active} onChange={(c) => set("active", c)} label="使う" hint="外すと、これからの明細で引きません。記録は残ります" />
        <F label="明細での並び順（任意）" error={fe.sort} hint="小さい数ほど上。空なら 0">
          <NumberInput name="sort" value={v.sort} onChange={(e) => set("sort", e.currentTarget.value)} inputMode="numeric" className="max-w-32" />
        </F>
      </div>
      <ResultLine state={state} />
      <SubmitRow pending={pending} label={submitLabel} />
    </form>
  );
}
