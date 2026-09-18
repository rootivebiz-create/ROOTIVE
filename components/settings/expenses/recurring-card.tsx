"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { parseNumberInput, sumMoney, TAX_MODES, type TaxMode } from "@/lib/calc";
import { saveRecurringExpensesAction } from "@/lib/actions/expenses";
import { EXPENSE_TAX_MODE_LABELS, type RecurringExpenseRowInput } from "@/lib/schemas/expenses";
import type { ChoiceOption } from "@/components/expenses/helpers";
import { optionsWithSelected } from "@/components/expenses/helpers";

/** 設定画面が受け取る「毎月かかる経費」1 行（月は "YYYY-MM"、空文字は制限なし） */
export interface RecurringSettingRow {
  id: string;
  category_id: string;
  label: string;
  amount: number;
  tax_mode: TaxMode;
  driver_id: string;
  project_id: string;
  vendor: string;
  start_month: string;
  end_month: string;
  is_active: boolean;
}

interface RowState {
  key: string;
  /** null = 未保存の新規行 */
  id: string | null;
  category_id: string;
  label: string;
  amount: string;
  tax_mode: TaxMode;
  driver_id: string;
  project_id: string;
  vendor: string;
  start_month: string;
  end_month: string;
  is_active: boolean;
}

export interface RecurringExpensesCardProps {
  rows: RecurringSettingRow[];
  categories: ChoiceOption[];
  drivers: ChoiceOption[];
  projects: ChoiceOption[];
  canEdit: boolean;
}

let rowSeq = 0;
const nextKey = () => `new-${++rowSeq}`;

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

const inactiveSuffix = (active: boolean) => (active ? "" : "（停止中）");

export function RecurringExpensesCard({ rows: initial, categories, drivers, projects, canEdit }: RecurringExpensesCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<RowState[]>(() => initial.map((r) => ({ key: r.id, ...r, id: r.id, amount: String(r.amount) })));
  const disabled = !canEdit || pending;

  const updateRow = (key: string, patch: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        key: nextKey(),
        id: null,
        category_id: categories.find((c) => c.is_active)?.id ?? "",
        label: "",
        amount: "",
        tax_mode: "taxable",
        driver_id: "",
        project_id: "",
        vendor: "",
        start_month: "",
        end_month: "",
        is_active: true,
      },
    ]);

  const activeTotal = useMemo(
    () => sumMoney(rows.filter((r) => r.is_active).map((r) => parseNumberInput(r.amount) ?? 0)),
    [rows],
  );
  const activeCount = rows.filter((r) => r.is_active).length;

  const submit = () => {
    if (!canEdit) return;
    const input: RecurringExpenseRowInput[] = rows.map((r) => ({
      id: r.id,
      category_id: r.category_id,
      label: r.label,
      amount: r.amount,
      tax_mode: r.tax_mode,
      driver_id: r.driver_id,
      project_id: r.project_id,
      vendor: r.vendor,
      start_month: r.start_month,
      end_month: r.end_month,
      is_active: r.is_active,
    }));
    startTransition(async () => {
      const res = await saveRecurringExpensesAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>毎月かかる経費</CardTitle>
        <CardDescription>
          家賃・リース・保険などのテンプレートです。経費画面の「毎月かかる経費をこの月に計上」でその月の経費として作られます（同じ月に二重計上はされません）。金額は税抜で入力します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">毎月かかる経費はありません。「毎月かかる経費を追加」から登録してください。</p>}

        {rows.map((r, i) => {
          const categoryOptions = optionsWithSelected(categories, r.category_id);
          const driverOptions = optionsWithSelected(drivers, r.driver_id);
          const projectOptions = optionsWithSelected(projects, r.project_id);
          return (
            <div key={r.key} className="space-y-2 rounded-md border p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`rec-category-${r.key}`}>カテゴリ</Label>
                  <Select id={`rec-category-${r.key}`} value={r.category_id} onChange={(e) => updateRow(r.key, { category_id: e.target.value })} disabled={disabled}>
                    <option value="">カテゴリを選択</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {inactiveSuffix(c.is_active)}
                      </option>
                    ))}
                  </Select>
                  <FieldError messages={errors[`rows.${i}.category_id`]} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rec-label-${r.key}`}>内容</Label>
                  <Input id={`rec-label-${r.key}`} value={r.label} onChange={(e) => updateRow(r.key, { label: e.target.value })} disabled={disabled} maxLength={100} placeholder="例: 事務所家賃" />
                  <FieldError messages={errors[`rows.${i}.label`]} />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`rec-amount-${r.key}`}>金額（税抜）</Label>
                  <NumberInput id={`rec-amount-${r.key}`} value={r.amount} onChange={(e) => updateRow(r.key, { amount: e.target.value })} disabled={disabled} placeholder="例: 120000" />
                  <FieldError messages={errors[`rows.${i}.amount`]} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rec-tax-${r.key}`}>課税区分</Label>
                  <Select id={`rec-tax-${r.key}`} value={r.tax_mode} onChange={(e) => updateRow(r.key, { tax_mode: e.target.value as TaxMode })} disabled={disabled}>
                    {TAX_MODES.map((m) => (
                      <option key={m} value={m}>
                        {EXPENSE_TAX_MODE_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  <FieldError messages={errors[`rows.${i}.tax_mode`]} />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`rec-driver-${r.key}`}>ドライバー（任意）</Label>
                  <Select id={`rec-driver-${r.key}`} value={r.driver_id} onChange={(e) => updateRow(r.key, { driver_id: e.target.value })} disabled={disabled}>
                    <option value="">指定なし</option>
                    {driverOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {inactiveSuffix(d.is_active)}
                      </option>
                    ))}
                  </Select>
                  <FieldError messages={errors[`rows.${i}.driver_id`]} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rec-project-${r.key}`}>案件（任意）</Label>
                  <Select id={`rec-project-${r.key}`} value={r.project_id} onChange={(e) => updateRow(r.key, { project_id: e.target.value })} disabled={disabled}>
                    <option value="">指定なし</option>
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {inactiveSuffix(p.is_active)}
                      </option>
                    ))}
                  </Select>
                  <FieldError messages={errors[`rows.${i}.project_id`]} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rec-vendor-${r.key}`}>支払先（任意）</Label>
                  <Input id={`rec-vendor-${r.key}`} value={r.vendor} onChange={(e) => updateRow(r.key, { vendor: e.target.value })} disabled={disabled} maxLength={100} />
                  <FieldError messages={errors[`rows.${i}.vendor`]} />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`rec-start-${r.key}`}>開始月（任意）</Label>
                  <Input id={`rec-start-${r.key}`} type="month" value={r.start_month} onChange={(e) => updateRow(r.key, { start_month: e.target.value })} disabled={disabled} />
                  <FieldError messages={errors[`rows.${i}.start_month`]} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rec-end-${r.key}`}>終了月（任意）</Label>
                  <Input id={`rec-end-${r.key}`} type="month" value={r.end_month} onChange={(e) => updateRow(r.key, { end_month: e.target.value })} disabled={disabled} />
                  <FieldError messages={errors[`rows.${i}.end_month`]} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.is_active} onCheckedChange={(c) => updateRow(r.key, { is_active: c })} disabled={disabled} aria-label="有効" />
                  {r.is_active ? "有効" : "停止中"}
                </label>
                {canEdit && (
                  <Button variant="ghost" size="icon" className="text-destructive" aria-label="この毎月かかる経費を削除" onClick={() => removeRow(r.key)} disabled={pending}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-sm text-muted-foreground">
          有効 {activeCount} 件／毎月の合計（税抜） <Money value={activeTotal} />
        </p>

        {canEdit && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={addRow} disabled={pending}>
              <Plus /> 毎月かかる経費を追加
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "保存中…" : "毎月かかる経費を保存"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
