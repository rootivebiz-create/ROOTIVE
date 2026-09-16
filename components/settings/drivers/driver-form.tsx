"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MonthLink } from "@/components/layout/month-link";
import { deleteDriverAction, saveDriverAction } from "@/lib/actions/drivers";
import { ROUNDING_LABELS, ROUNDING_MODES, UNIT_LABELS, type RoundingMode, type Unit } from "@/lib/calc/types";
import { rateToPercent } from "@/lib/calc/parse";
import type { Driver, DriverRecurringAdjustment } from "@/lib/db/types";
import { pct, yen } from "@/lib/format";
import { useMonth } from "@/lib/hooks/use-month";
import type { DriverFormInput } from "@/lib/schemas/drivers";
import type { CompanyDefaults } from "./drivers-table";

export interface DriverFormProjectItem {
  id: string;
  name: string;
  unit: Unit;
  bill_rate: number;
  pay_rate: number;
  is_active: boolean;
}

export interface DriverFormProject {
  id: string;
  name: string;
  client_name: string;
  is_active: boolean;
  items: DriverFormProjectItem[];
}

export interface DriverFormProps {
  /** false（viewer）なら閲覧のみ */
  canEdit: boolean;
  defaults: CompanyDefaults;
  /** null = 新規 */
  driver: Driver | null;
  overrides: { project_item_id: string; pay_rate: number }[];
  recurring: DriverRecurringAdjustment[];
  /** 個別単価の対象（有効な案件内容 ＋ 既に個別単価がある内容） */
  projects: DriverFormProject[];
  /** このドライバーを参照する稼働行の件数（削除可否） */
  entryCount: number;
  /** 月別データ（driver_months）の件数（削除可否） */
  monthCount: number;
}

interface FormState {
  name: string;
  kana: string;
  is_active: boolean;
  followRoyalty: boolean;
  royalty_rate: string;
  mgmt_fee: string;
  rounding_mode: RoundingMode | "";
  phone: string;
  email: string;
  bank_info: string;
  memo: string;
}

interface RecurringRow {
  key: string;
  id: string | null;
  label: string;
  amount: string;
  count_as_profit: boolean;
  is_active: boolean;
}

let rowSeq = 0;
const nextKey = () => `new-${++rowSeq}`;

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

export function DriverForm({ canEdit, defaults, driver, overrides, recurring, projects, entryCount, monthCount }: DriverFormProps) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const listHref = href("/settings/drivers");
  const isNew = driver == null;
  const disabled = !canEdit || pending;

  const [f, setF] = useState<FormState>(() => ({
    name: driver?.name ?? "",
    kana: driver?.kana ?? "",
    is_active: driver?.is_active ?? true,
    followRoyalty: driver ? driver.royalty_rate == null : true,
    royalty_rate: driver?.royalty_rate != null ? String(rateToPercent(Number(driver.royalty_rate))) : "",
    mgmt_fee: String(driver ? Number(driver.mgmt_fee ?? 0) : Number(defaults.default_mgmt_fee ?? 0)),
    rounding_mode: driver?.rounding_mode ?? "",
    phone: driver?.phone ?? "",
    email: driver?.email ?? "",
    bank_info: driver?.bank_info ?? "",
    memo: driver?.memo ?? "",
  }));
  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));

  const originalOverrideIds = useMemo(() => new Set(overrides.map((o) => o.project_item_id)), [overrides]);
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(overrides.map((o) => [o.project_item_id, String(Number(o.pay_rate ?? 0))])),
  );
  const [recurringRows, setRecurringRows] = useState<RecurringRow[]>(() =>
    recurring.map((r) => ({
      key: r.id,
      id: r.id,
      label: r.label,
      amount: String(Number(r.amount ?? 0)),
      count_as_profit: r.count_as_profit,
      is_active: r.is_active,
    })),
  );
  /** 送信した個別単価の順序（エラーのパス index → 案件内容 id） */
  const [submittedOverrideIds, setSubmittedOverrideIds] = useState<string[]>([]);

  const allItems = useMemo(() => projects.flatMap((p) => p.items.map((item) => ({ project: p, item }))), [projects]);

  const buildInput = (): DriverFormInput => {
    const overrideInputs = allItems
      .filter(({ item }) => (overrideValues[item.id] ?? "").trim() !== "" || originalOverrideIds.has(item.id))
      .map(({ item }) => ({ project_item_id: item.id, pay_rate: overrideValues[item.id] ?? "" }));
    return {
      id: driver?.id ?? null,
      name: f.name,
      kana: f.kana,
      is_active: f.is_active,
      royalty_rate: f.followRoyalty ? null : f.royalty_rate,
      mgmt_fee: f.mgmt_fee,
      rounding_mode: f.rounding_mode,
      phone: f.phone,
      email: f.email,
      bank_info: f.bank_info,
      memo: f.memo,
      overrides: overrideInputs,
      recurring: recurringRows.map((r) => ({ id: r.id, label: r.label, amount: r.amount, count_as_profit: r.count_as_profit, is_active: r.is_active })),
    };
  };

  const submit = () => {
    if (!canEdit) return;
    const input = buildInput();
    setSubmittedOverrideIds(input.overrides.map((o) => o.project_item_id));
    startTransition(async () => {
      const res = await saveDriverAction(input);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        router.push(listHref);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!driver) return;
    startTransition(async () => {
      const res = await deleteDriverAction(driver.id);
      setConfirmOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "削除しました");
        router.push(listHref);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const overrideError = (itemId: string) => {
    const idx = submittedOverrideIds.indexOf(itemId);
    return idx >= 0 ? errors[`overrides.${idx}.pay_rate`] : undefined;
  };

  const addRecurring = () =>
    setRecurringRows((rows) => [...rows, { key: nextKey(), id: null, label: "", amount: "", count_as_profit: true, is_active: true }]);
  const updateRecurring = (key: string, patch: Partial<RecurringRow>) => setRecurringRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRecurring = (key: string) => setRecurringRows((rows) => rows.filter((r) => r.key !== key));

  const cannotDeleteReason =
    entryCount > 0
      ? `稼働行が ${entryCount} 件あるため削除できません。不要な場合は「停止中」にしてください。`
      : monthCount > 0
        ? "月別データ（管理費・調整）があるため削除できません。不要な場合は「停止中」にしてください。"
        : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!canEdit && <Alert>閲覧のみです（編集権限がありません）。</Alert>}
      {errors._ && <Alert variant="destructive">{errors._[0]}</Alert>}

      {/* 基本情報 */}
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="driver-name">名前（必須）</Label>
            <Input id="driver-name" value={f.name} onChange={(e) => set({ name: e.target.value })} disabled={disabled} required maxLength={100} autoComplete="off" />
            <FieldError messages={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-kana">かな</Label>
            <Input id="driver-kana" value={f.kana} onChange={(e) => set({ kana: e.target.value })} disabled={disabled} maxLength={100} autoComplete="off" />
            <FieldError messages={errors.kana} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="driver-active">状態</Label>
              <p className="text-xs text-muted-foreground">{f.is_active ? "稼働中（稼働入力の候補に表示）" : "停止中（稼働入力の候補に表示しない）"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={f.is_active ? "success" : "secondary"}>{f.is_active ? "稼働中" : "停止中"}</Badge>
              <Switch id="driver-active" checked={f.is_active} onCheckedChange={(c) => set({ is_active: c })} disabled={disabled} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 契約条件 */}
      <Card>
        <CardHeader>
          <CardTitle>契約条件</CardTitle>
          <CardDescription>稼働行の新規作成時に自動入力されます。保存済みの稼働行には影響しません。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="driver-royalty">ロイヤリティ率</Label>
            <div className="flex items-center gap-2">
              <NumberInput
                id="driver-royalty"
                value={f.followRoyalty ? "" : f.royalty_rate}
                onChange={(e) => set({ royalty_rate: e.target.value })}
                disabled={disabled || f.followRoyalty}
                placeholder={f.followRoyalty ? pct(defaults.default_royalty_rate) : "例: 10"}
                className="max-w-[10rem]"
                aria-describedby="driver-royalty-help"
              />
              <span className="text-sm">%</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.followRoyalty} onCheckedChange={(c) => set({ followRoyalty: c === true })} disabled={disabled} />
              会社設定に従う（現在 {pct(defaults.default_royalty_rate)}）
            </label>
            <p id="driver-royalty-help" className="text-xs text-muted-foreground">
              0〜100% で入力。オーナー本人など支払をしない場合は 0% で登録します。
            </p>
            <FieldError messages={errors.royalty_rate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-mgmt">管理費（月額）</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm">¥</span>
              <NumberInput id="driver-mgmt" value={f.mgmt_fee} onChange={(e) => set({ mgmt_fee: e.target.value })} disabled={disabled} className="max-w-[12rem]" />
            </div>
            <p className="text-xs text-muted-foreground">数量 &gt; 0 の稼働行がある月にだけ計上されます。会社の標準は {yen(defaults.default_mgmt_fee)}。</p>
            <FieldError messages={errors.mgmt_fee} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-rounding">ロイヤリティ額の端数処理</Label>
            <Select id="driver-rounding" value={f.rounding_mode} onChange={(e) => set({ rounding_mode: e.target.value as RoundingMode | "" })} disabled={disabled}>
              <option value="">会社設定に従う（現在: {ROUNDING_LABELS[defaults.rounding_mode]}）</option>
              {ROUNDING_MODES.map((m) => (
                <option key={m} value={m}>
                  {ROUNDING_LABELS[m]}
                </option>
              ))}
            </Select>
            <FieldError messages={errors.rounding_mode} />
          </div>
        </CardContent>
      </Card>

      {/* 連絡先 */}
      <Card>
        <CardHeader>
          <CardTitle>連絡先・メモ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="driver-phone">電話</Label>
              <Input id="driver-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} disabled={disabled} maxLength={50} autoComplete="off" />
              <FieldError messages={errors.phone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-email">メール</Label>
              <Input id="driver-email" type="email" inputMode="email" value={f.email} onChange={(e) => set({ email: e.target.value })} disabled={disabled} maxLength={200} autoComplete="off" />
              <FieldError messages={errors.email} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-bank">振込先メモ</Label>
            <Textarea id="driver-bank" value={f.bank_info} onChange={(e) => set({ bank_info: e.target.value })} disabled={disabled} maxLength={500} rows={2} placeholder="銀行名・支店・口座番号など" />
            <FieldError messages={errors.bank_info} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-memo">メモ</Label>
            <Textarea id="driver-memo" value={f.memo} onChange={(e) => set({ memo: e.target.value })} disabled={disabled} maxLength={2000} rows={3} />
            <FieldError messages={errors.memo} />
          </div>
        </CardContent>
      </Card>

      {/* 個別支払単価 */}
      <Card>
        <CardHeader>
          <CardTitle>案件内容ごとの個別支払単価</CardTitle>
          <CardDescription>空欄なら案件の標準支払単価を使います。このドライバーだけ単価が異なる内容に入力してください。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {projects.length === 0 && <p className="text-sm text-muted-foreground">有効な案件内容がありません。先に「案件・単価」で登録してください。</p>}
          {projects.map((p) => (
            <div key={p.id} className="space-y-2">
              <p className="text-sm font-semibold">
                {p.name}
                {p.client_name && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.client_name}</span>}
                {!p.is_active && (
                  <Badge variant="secondary" className="ml-2">
                    停止中
                  </Badge>
                )}
              </p>
              <ul className="divide-y rounded-md border">
                {p.items.map((item) => {
                  const value = overrideValues[item.id] ?? "";
                  const hasOverride = value.trim() !== "";
                  return (
                    <li key={item.id} className="flex items-center gap-2 p-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="font-medium">{item.name}</span>
                          <Badge variant="outline">{UNIT_LABELS[item.unit]}</Badge>
                          {!item.is_active && <Badge variant="secondary">停止中</Badge>}
                          {hasOverride && <Badge variant="warning">個別</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          標準 <Money value={item.pay_rate} />（受注 <Money value={item.bill_rate} />）
                        </p>
                        <FieldError messages={overrideError(item.id)} />
                      </div>
                      <NumberInput
                        aria-label={`${p.name} ${item.name} の個別支払単価`}
                        value={value}
                        onChange={(e) => setOverrideValues((v) => ({ ...v, [item.id]: e.target.value }))}
                        disabled={disabled}
                        placeholder="標準"
                        className="w-28 shrink-0 md:w-36"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 固定控除 */}
      <Card>
        <CardHeader>
          <CardTitle>固定控除（毎月自動計上）</CardTitle>
          <CardDescription>その月に最初の稼働行が作られたとき、有効な項目が調整として複写されます。控除はマイナスで入力します。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recurringRows.length === 0 && <p className="text-sm text-muted-foreground">固定控除はありません。</p>}
          {recurringRows.map((r, i) => (
            <div key={r.key} className="space-y-2 rounded-md border p-3">
              <div className="grid gap-2 md:grid-cols-[1fr_11rem]">
                <div className="space-y-1">
                  <Label htmlFor={`rec-label-${r.key}`}>項目名</Label>
                  <Input id={`rec-label-${r.key}`} value={r.label} onChange={(e) => updateRecurring(r.key, { label: e.target.value })} disabled={disabled} maxLength={100} placeholder="例: リース代" />
                  <FieldError messages={errors[`recurring.${i}.label`]} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rec-amount-${r.key}`}>金額（控除はマイナス）</Label>
                  <NumberInput id={`rec-amount-${r.key}`} value={r.amount} onChange={(e) => updateRecurring(r.key, { amount: e.target.value })} disabled={disabled} placeholder="例: -30000" />
                  <FieldError messages={errors[`recurring.${i}.amount`]} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={r.count_as_profit} onCheckedChange={(c) => updateRecurring(r.key, { count_as_profit: c === true })} disabled={disabled} />
                  利益計上（会社利益に含める）
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={r.is_active} onCheckedChange={(c) => updateRecurring(r.key, { is_active: c })} disabled={disabled} aria-label="有効" />
                    {r.is_active ? "有効" : "無効"}
                  </label>
                  {canEdit && (
                    <Button variant="ghost" size="icon" aria-label="この固定控除を削除" onClick={() => removeRecurring(r.key)} disabled={pending}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {canEdit && (
            <Button variant="outline" onClick={addRecurring} disabled={pending}>
              <Plus /> 固定控除を追加
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 操作 */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <MonthLink href="/settings/drivers" className={buttonVariants({ variant: "outline" })}>
          一覧へ戻る
        </MonthLink>
        {canEdit && (
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "保存中…" : isNew ? "登録する" : "保存する"}
          </Button>
        )}
      </div>

      {canEdit && driver && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">削除</CardTitle>
            <CardDescription>
              {cannotDeleteReason ?? "稼働行が無いドライバーのみ削除できます。個別単価・固定控除も一緒に削除されます。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={pending || cannotDeleteReason != null}>
              <Trash2 /> このドライバーを削除
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ドライバーを削除しますか？</DialogTitle>
            <DialogDescription>「{driver?.name}」を削除します。この操作は取り消せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
