"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { pct } from "@/lib/payroll/money";
import type { AccountType, BankAccount, Driver, MonthData, Project, Rounding } from "@/lib/payroll/types";
import { isRegistrationNo, parseYen, percentTextToRate, rateToPercentText, unitPrice } from "./format";
import { ACCOUNT_TYPES, Disclosure, InvoiceBadge, KanaPreview, NumberField, SectionTitle, commaDisplay, cx, textButton } from "./parts";
import { newDriver, newProject } from "./reducer";
import type { DemoActions } from "./state";

type Props = { data: MonthData; actions: DemoActions; onReset: () => void };

const ROUNDING: { value: Rounding; label: string }[] = [
  { value: "floor", label: "切り捨て" },
  { value: "round", label: "四捨五入" },
  { value: "ceil", label: "切り上げ" },
];

const EMPTY_BANK: BankAccount = {
  bankCode: "",
  bankNameKana: "",
  branchCode: "",
  branchNameKana: "",
  accountType: "ordinary",
  accountNumber: "",
  holderKana: "",
};

const UNITS = ["日", "個", "件", "時間", "便", "回", "km"];

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 shrink-0 accent-current" />
      <span>
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function RegNoHint({ value }: { value?: string }) {
  if (!value?.trim()) return null;
  if (isRegistrationNo(value)) return null;
  return <span className="mt-1 block text-xs text-warning">「T」と 13 桁の数字の形になっていません</span>;
}

export function SettingsTab({ data, actions, onReset }: Props) {
  const s = data.settings;
  const [added, setAdded] = useState<string | null>(null);
  const nameCount = new Map<string, number>();
  for (const d of data.drivers) nameCount.set(d.name.trim(), (nameCount.get(d.name.trim()) ?? 0) + 1);

  const addDriver = () => {
    const d = newDriver(data);
    actions.upsertDriver(d);
    setAdded(d.id);
  };
  const addProject = () => actions.upsertProject(newProject(data));

  const removeDriver = (d: Driver) => {
    if (window.confirm(`${d.name || "このドライバー"}を消しますか？ 稼働の数量と調整も消えます。`)) actions.removeDriver(d.id);
  };
  const removeProject = (p: Project) => {
    if (window.confirm(`${p.name || "この案件"}を消しますか？ この案件の稼働の数量も消えます。`)) actions.removeProject(p.id);
  };

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>会社の設定</SectionTitle>
        <Card className="mt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="会社名">
              <Input value={s.companyName} onChange={(e) => actions.setSettings({ companyName: e.target.value })} />
            </Field>
            <Field label="登録番号（インボイス）" hint="T と 13 桁の数字。支払明細の作成者の欄に出ます">
              <Input
                value={s.companyRegistrationNo ?? ""}
                onChange={(e) => actions.setSettings({ companyRegistrationNo: e.target.value })}
                autoComplete="off"
                className="num"
              />
              <RegNoHint value={s.companyRegistrationNo} />
            </Field>
            <Field label="消費税の計算方法" hint="原則課税のときだけ、未登録の方への支払で控除できない分（インボイスの負担）を出します">
              <Select
                value={s.taxMethod}
                onChange={(e) => actions.setSettings({ taxMethod: e.target.value === "simplified" ? "simplified" : "general" })}
              >
                <option value="general">原則課税</option>
                <option value="simplified">簡易課税</option>
              </Select>
            </Field>
            <Field label="振込日">
              <Input type="date" value={s.payDate} onChange={(e) => actions.setSettings({ payDate: e.target.value })} />
            </Field>
            <Field label="金額の端数" hint="単価 × 数量・ロイヤリティ">
              <Select value={s.amountRounding} onChange={(e) => actions.setSettings({ amountRounding: e.target.value as Rounding })}>
                {ROUNDING.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="消費税の端数">
              <Select value={s.taxRounding} onChange={(e) => actions.setSettings({ taxRounding: e.target.value as Rounding })}>
                {ROUNDING.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-2">
            <Checkbox
              checked={s.payTaxToExempt}
              onChange={(v) => actions.setSettings({ payTaxToExempt: v })}
              label="免税の方にも消費税相当額を払う"
              hint="外すと、インボイス未登録の方の委託料に消費税分を上乗せしません"
            />
          </div>
        </Card>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <SectionTitle>ドライバー</SectionTitle>
          <Button type="button" variant="secondary" onClick={addDriver}>
            ＋ ドライバーを足す
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">押すと中身を直せます。名前は Excel から貼り付けるときの照合にも使います。</p>
        <ul className="mt-3 space-y-3">
          {data.drivers.map((d) => {
            const dup = d.name.trim() !== "" && (nameCount.get(d.name.trim()) ?? 0) > 1;
            return (
              <li key={d.id}>
                <Disclosure
                  defaultOpen={d.id === added}
                  summary={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold">{d.name || "（名前なし）"}</span>
                      <InvoiceBadge registered={d.invoiceRegistered} />
                      <span className="text-xs text-muted-foreground">
                        ロイヤリティ {pct(d.royaltyRate)}・管理費 {unitPrice(d.monthlyFee)}
                        {d.bank ? "" : "・口座未登録"}
                      </span>
                    </span>
                  }
                >
                  <DriverEditor driver={d} duplicate={dup} onChange={actions.upsertDriver} onRemove={() => removeDriver(d)} />
                </Disclosure>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <SectionTitle>案件</SectionTitle>
          <Button type="button" variant="secondary" onClick={addProject}>
            ＋ 案件を足す
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">単価はすべて税抜です。</p>
        <datalist id="demo-units">
          {UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <ul className="mt-3 space-y-3">
          {data.projects.map((p) => (
            <li key={p.id}>
              <ProjectEditor project={p} onChange={actions.upsertProject} onRemove={() => removeProject(p)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-card border border-border p-4">
        <SectionTitle>最初からやり直す</SectionTitle>
        <p className="mt-1 text-sm text-muted-foreground">入力した内容を消して、サンプルのデータに戻します。</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => {
            if (window.confirm("入力した内容を消して、サンプルのデータに戻しますか？")) onReset();
          }}
        >
          サンプルに戻す
        </Button>
      </section>
    </div>
  );
}

function DriverEditor({
  driver: d,
  duplicate,
  onChange,
  onRemove,
}: {
  driver: Driver;
  duplicate: boolean;
  onChange: (d: Driver) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Driver>) => onChange({ ...d, ...patch });
  const setBank = (patch: Partial<BankAccount>) => set({ bank: { ...(d.bank ?? EMPTY_BANK), ...patch } });
  const bankText = (key: Exclude<keyof BankAccount, "accountType">, label: string, opts: { numeric?: boolean; max?: number; kana?: boolean } = {}) => (
    <Field label={label}>
      <Input
        value={d.bank?.[key] ?? ""}
        onChange={(e) => setBank({ [key]: e.target.value } as Partial<BankAccount>)}
        inputMode={opts.numeric ? "numeric" : undefined}
        maxLength={opts.max}
        autoComplete="off"
        className={opts.numeric ? "num" : undefined}
      />
      {opts.kana && <KanaPreview value={d.bank?.[key] ?? ""} />}
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名前">
          <Input value={d.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
          {duplicate && <span className="mt-1 block text-xs text-warning">同じ名前の方がいます。貼り付けのときに区別できません</span>}
        </Field>
        <Field label="インボイス登録">
          <Select value={d.invoiceRegistered ? "yes" : "no"} onChange={(e) => set({ invoiceRegistered: e.target.value === "yes" })}>
            <option value="yes">登録済み</option>
            <option value="no">未登録（免税）</option>
          </Select>
        </Field>
        {d.invoiceRegistered && (
          <Field label="登録番号">
            <Input
              value={d.registrationNo ?? ""}
              onChange={(e) => set({ registrationNo: e.target.value })}
              placeholder="T1234567890123"
              autoComplete="off"
              className="num"
            />
            <RegNoHint value={d.registrationNo} />
          </Field>
        )}
        <Field label="管理費（月額・税抜・円）" hint="その月に稼働があるときだけ差し引きます">
          <NumberField value={d.monthlyFee} onValue={(v) => set({ monthlyFee: v })} parse={parseYen} display={commaDisplay} placeholder="0" />
        </Field>
        <Field label="ロイヤリティ（%）" hint="委託料（税抜）に掛けて差し引きます">
          <NumberField
            value={d.royaltyRate}
            onValue={(v) => set({ royaltyRate: v })}
            parse={percentTextToRate}
            display={(v) => (v === 0 ? "" : rateToPercentText(v))}
            placeholder="0"
          />
        </Field>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">振込先の口座</p>
          {d.bank ? (
            <button type="button" className={textButton("danger")} onClick={() => set({ bank: undefined })}>
              口座を消す
            </button>
          ) : (
            <button type="button" className={textButton()} onClick={() => set({ bank: { ...EMPTY_BANK } })}>
              ＋ 口座を入れる
            </button>
          )}
        </div>
        {d.bank ? (
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {bankText("bankCode", "金融機関コード（4 桁）", { numeric: true, max: 4 })}
            {bankText("bankNameKana", "金融機関名（カナ）", { kana: true })}
            {bankText("branchCode", "支店コード（3 桁）", { numeric: true, max: 3 })}
            {bankText("branchNameKana", "支店名（カナ）", { kana: true })}
            <Field label="預金種目">
              <Select value={d.bank.accountType} onChange={(e) => setBank({ accountType: e.target.value as AccountType })}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            {bankText("accountNumber", "口座番号（7 桁まで）", { numeric: true, max: 7 })}
            <div className="sm:col-span-2">{bankText("holderKana", "口座名義（カナ）", { kana: true })}</div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">口座がないと、振込データに入りません。</p>
        )}
      </div>

      <div className="flex justify-end">
        <button type="button" className={textButton("danger")} onClick={onRemove}>
          このドライバーを消す
        </button>
      </div>
    </div>
  );
}

function ProjectEditor({ project: p, onChange, onRemove }: { project: Project; onChange: (p: Project) => void; onRemove: () => void }) {
  const set = (patch: Partial<Project>) => onChange({ ...p, ...patch });
  const gross = p.billRate - p.payRate;
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-5">
        <div className="col-span-2 lg:col-span-1">
          <Field label="案件名">
            <Input value={p.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
          </Field>
        </div>
        <Field label="元請">
          <Input value={p.client} onChange={(e) => set({ client: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="単位">
          <Input value={p.unit} onChange={(e) => set({ unit: e.target.value })} list="demo-units" autoComplete="off" />
        </Field>
        <Field label="受注単価（円）">
          <NumberField value={p.billRate} onValue={(v) => set({ billRate: v })} display={commaDisplay} placeholder="0" />
        </Field>
        <Field label="支払単価（円）">
          <NumberField value={p.payRate} onValue={(v) => set({ payRate: v })} display={commaDisplay} placeholder="0" />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className={cx("text-xs", gross < 0 ? "text-danger" : "text-muted-foreground")}>
          1{p.unit || "単位"}あたりの粗利 {unitPrice(gross)}
          {p.billRate > 0 && `（${pct(gross / p.billRate)}）`}
        </p>
        <button type="button" className={textButton("danger")} onClick={onRemove}>
          この案件を消す
        </button>
      </div>
    </Card>
  );
}
