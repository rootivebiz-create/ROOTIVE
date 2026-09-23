"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/ui";
import { saveAccountingAction, type SaveAccountingState } from "~/app/(app)/export/actions";

export type MappingField = {
  key: string;
  label: string;
  help: string;
  value: string;
  defaultValue: string;
  saved: boolean;
  rare?: boolean;
};

type Props = {
  software: string;
  softwareLabel: string;
  accountFields: MappingField[];
  taxFields: MappingField[];
  payableSubByDriver: boolean;
};

function FieldRow({ name, field, value, onChange }: { name: string; field: MappingField; value: string; onChange: (v: string) => void }) {
  const id = `f-${name.replace(/\W/g, "-")}`;
  const changed = value.trim() !== field.value.trim();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-bold">
          {field.label}
        </label>
        {changed ? (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">変更あり（未保存）</span>
        ) : field.saved ? (
          <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-bold text-success">保存済み</span>
        ) : (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning">要確認（既定の値）</span>
        )}
      </div>
      <Input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} />
      <p className="text-xs text-muted-foreground">
        {field.help}
        {field.defaultValue !== "" && value.trim() !== field.defaultValue && <> 既定は「{field.defaultValue}」。</>}
      </p>
    </div>
  );
}

/** 勘定科目と税区分の対応（会社ごとに 1 回決めれば、翌月からはそのまま使う） */
export function MappingForm({ software, softwareLabel, accountFields, taxFields, payableSubByDriver }: Props) {
  const [state, action, pending] = useActionState<SaveAccountingState, FormData>(saveAccountingAction, undefined);
  const initial = () => Object.fromEntries([...accountFields.map((f) => [`account.${f.key}`, f.value]), ...taxFields.map((f) => [`tax.${f.key}`, f.value])]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [payableSub, setPayableSub] = useState(payableSubByDriver);
  const set = (name: string) => (v: string) => setValues((prev) => ({ ...prev, [name]: v }));

  const resetToDefaults = () =>
    setValues(Object.fromEntries([...accountFields.map((f) => [`account.${f.key}`, f.defaultValue]), ...taxFields.map((f) => [`tax.${f.key}`, f.defaultValue])]));
  const undo = () => {
    setValues(initial());
    setPayableSub(payableSubByDriver);
  };

  const common = accountFields.filter((f) => !f.rare);
  const rare = accountFields.filter((f) => f.rare);
  const unsaved = [...accountFields, ...taxFields].filter((f) => !f.saved).length;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="software" value={software} />
      {unsaved > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          「要確認」の {unsaved} か所は、しめ日ラボが入れた既定の値です。お使いの会計ソフトの勘定科目・税区分の一覧と同じ文字になっているか確かめて、保存してください。
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-base font-bold">勘定科目</legend>
        {common.map((f) => (
          <FieldRow key={f.key} name={`account.${f.key}`} field={f} value={values[`account.${f.key}`] ?? ""} onChange={set(`account.${f.key}`)} />
        ))}
        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border p-3">
          <input type="checkbox" name="payableSub" checked={payableSub} onChange={(e) => setPayableSub(e.target.checked)} className="mt-1 h-5 w-5" />
          <span className="text-sm">
            <span className="font-bold">未払金の補助科目に、ドライバーの名前を入れる</span>
            <span className="block text-muted-foreground">会計ソフトに、ドライバーごとの補助科目を先に登録しておく必要があります。登録が無いと取り込めないことがあります。</span>
          </span>
        </label>
        {rare.length > 0 && (
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">あまり使わない科目（消費税の対象にした調整）</summary>
            <div className="mt-3 space-y-4">
              {rare.map((f) => (
                <FieldRow key={f.key} name={`account.${f.key}`} field={f} value={values[`account.${f.key}`] ?? ""} onChange={set(`account.${f.key}`)} />
              ))}
            </div>
          </details>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-bold">税区分（{softwareLabel}）</legend>
        <p className="text-sm text-muted-foreground">税区分の名前はソフトごとに違うので、ソフトごとに覚えます。空にした欄は、ファイルでも空けて出します。</p>
        {taxFields.map((f) => (
          <FieldRow key={f.key} name={`tax.${f.key}`} field={f} value={values[`tax.${f.key}`] ?? ""} onChange={set(`tax.${f.key}`)} />
        ))}
      </fieldset>

      {state && !state.ok && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="submit" disabled={pending}>
          {pending ? "保存しています…" : "この対応を保存する"}
        </Button>
        <Button variant="secondary" onClick={resetToDefaults} disabled={pending}>
          既定の値に戻す（まだ保存しません）
        </Button>
        <Button variant="ghost" onClick={undo} disabled={pending}>
          保存してある値に戻す
        </Button>
      </div>
    </form>
  );
}
