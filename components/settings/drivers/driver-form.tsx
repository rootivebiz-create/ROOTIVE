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
import { ROUNDING_LABELS, ROUNDING_MODES, TAX_MODES, TAX_MODE_LABELS, UNIT_LABELS, type RoundingMode, type TaxMode, type Unit } from "@/lib/calc/types";
import { parseNumberInput, rateToPercent } from "@/lib/calc/parse";
import type { Driver, DriverRecurringAdjustment } from "@/lib/db/types";
import { pct, yen, yenPlain } from "@/lib/format";
import { useMonth } from "@/lib/hooks/use-month";
import { formatDateJa, formatMonthJa, payoutDate } from "@/lib/month";
import { PAYOUT_MONTH_OFFSETS, PAYOUT_MONTH_OFFSET_LABELS } from "@/lib/schemas/company";
import { toHalfWidthKana, type DriverBankFormInput, type DriverFormInput } from "@/lib/schemas/drivers";
import { BANK_ACCOUNT_TYPES, BANK_ACCOUNT_TYPE_LABELS, type BankAccountType } from "@/lib/db/types";
import { payoutRuleLabel, type CompanyDefaults } from "./drivers-table";

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
  /**
   * 振込先口座を見てよいか（companies.confidential_scope.bank_account）。
   * false なら入力欄ごと出さず、保存時も口座を送らない（Server Action と DB でも拒否される）
   */
  canSeeBank: boolean;
  /** 振込先口座（driver_bank_accounts）。未登録・権限が無いときは null */
  bankAccount: DriverBankFormInput | null;
  /** ドライバー別単価（null＝標準） */
  overrides: { project_item_id: string; bill_rate: number | null; pay_rate: number | null }[];
  recurring: DriverRecurringAdjustment[];
  /** ドライバー別単価の対象（有効な案件内容 ＋ 既に個別単価がある内容） */
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
  tax_mode: TaxMode;
  invoice_reg_no: string;
  /** true = 振込予定日は会社設定に従う */
  followPayout: boolean;
  payout_month_offset: string;
  payout_day: string;
  /** 振込先口座（総合振込データに使う） */
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
  account_type: BankAccountType | "";
  account_number: string;
  account_holder_kana: string;
  /** 運転者台帳（0024） */
  roster_no: string;
  birth_date: string;
  address: string;
  hired_on: string;
  appointed_on: string;
  retired_on: string;
  license_kinds: string;
  license_conditions: string;
}

/** 振込予定日の「日」の選択肢（0 = 末日） */
const PAYOUT_DAYS = Array.from({ length: 32 }, (_, i) => i);

/** ドライバー別単価の入力値（空欄＝標準） */
interface OverrideValue {
  bill: string;
  pay: string;
}

const EMPTY_OVERRIDE: OverrideValue = { bill: "", pay: "" };

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

export function DriverForm({ canEdit, canSeeBank, bankAccount, defaults, driver, overrides, recurring, projects, entryCount, monthCount }: DriverFormProps) {
  const router = useRouter();
  const { href, month } = useMonth();
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
    tax_mode: driver?.tax_mode ?? "taxable",
    invoice_reg_no: driver?.invoice_reg_no ?? "",
    // 月・日のどちらかが null なら会社設定に従う（保存時も両方揃って初めて個別）
    followPayout: driver ? driver.payout_month_offset == null || driver.payout_day == null : true,
    payout_month_offset: String(driver?.payout_month_offset ?? defaults.payout_month_offset),
    payout_day: String(driver?.payout_day ?? defaults.payout_day),
    bank_code: bankAccount?.bank_code ?? "",
    bank_name: bankAccount?.bank_name ?? "",
    branch_code: bankAccount?.branch_code ?? "",
    branch_name: bankAccount?.branch_name ?? "",
    account_type: bankAccount?.account_type ?? "",
    account_number: bankAccount?.account_number ?? "",
    account_holder_kana: bankAccount?.account_holder_kana ?? "",
    roster_no: driver?.roster_no ?? "",
    birth_date: driver?.birth_date ?? "",
    address: driver?.address ?? "",
    hired_on: driver?.hired_on ?? "",
    appointed_on: driver?.appointed_on ?? "",
    retired_on: driver?.retired_on ?? "",
    license_kinds: driver?.license_kinds ?? "",
    license_conditions: driver?.license_conditions ?? "",
  }));
  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));

  // 振込予定日のプレビュー（会社設定に従うなら会社の値、個別なら選択中の値）
  const payoutOffsetNum = f.followPayout ? defaults.payout_month_offset : parseNumberInput(f.payout_month_offset);
  const payoutDayNum = f.followPayout ? defaults.payout_day : parseNumberInput(f.payout_day);
  const payoutPreview =
    payoutOffsetNum != null && payoutDayNum != null && Number.isInteger(payoutOffsetNum) && Number.isInteger(payoutDayNum)
      ? payoutDate(month, payoutOffsetNum, payoutDayNum)
      : null;
  const companyPayoutLabel = payoutRuleLabel(defaults.payout_month_offset, defaults.payout_day);

  const originalOverrideIds = useMemo(() => new Set(overrides.map((o) => o.project_item_id)), [overrides]);
  const [overrideValues, setOverrideValues] = useState<Record<string, OverrideValue>>(() =>
    Object.fromEntries(
      overrides.map((o) => [o.project_item_id, { bill: o.bill_rate == null ? "" : String(o.bill_rate), pay: o.pay_rate == null ? "" : String(o.pay_rate) }]),
    ),
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
    // 入力がある内容 ＋ 元々個別単価があった内容（両方空欄なら「標準に戻す」として送る）
    const overrideInputs = allItems
      .filter(({ item }) => {
        const v = overrideValues[item.id] ?? EMPTY_OVERRIDE;
        return v.bill.trim() !== "" || v.pay.trim() !== "" || originalOverrideIds.has(item.id);
      })
      .map(({ item }) => {
        const v = overrideValues[item.id] ?? EMPTY_OVERRIDE;
        return { project_item_id: item.id, bill_rate: v.bill, pay_rate: v.pay };
      });
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
      tax_mode: f.tax_mode,
      invoice_reg_no: f.invoice_reg_no,
      payout_month_offset: f.followPayout ? null : f.payout_month_offset,
      payout_day: f.followPayout ? null : f.payout_day,
      roster_no: f.roster_no,
      birth_date: f.birth_date,
      address: f.address,
      hired_on: f.hired_on,
      appointed_on: f.appointed_on,
      retired_on: f.retired_on,
      license_kinds: f.license_kinds,
      license_conditions: f.license_conditions,
      // 口座を見られない権限では送らない（送ると Server Action が拒否する）
      bank_account: canSeeBank
        ? {
            bank_code: f.bank_code,
            bank_name: f.bank_name,
            branch_code: f.branch_code,
            branch_name: f.branch_name,
            account_type: f.account_type,
            account_number: f.account_number,
            account_holder_kana: f.account_holder_kana,
          }
        : undefined,
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

  const overrideError = (itemId: string, field: "bill_rate" | "pay_rate") => {
    const idx = submittedOverrideIds.indexOf(itemId);
    return idx >= 0 ? errors[`overrides.${idx}.${field}`] : undefined;
  };
  const setOverride = (itemId: string, patch: Partial<OverrideValue>) =>
    setOverrideValues((v) => ({ ...v, [itemId]: { ...(v[itemId] ?? EMPTY_OVERRIDE), ...patch } }));

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

      {/* 消費税・支払日 */}
      <Card>
        <CardHeader>
          <CardTitle>消費税・支払日</CardTitle>
          <CardDescription>支払明細（PDF・印刷・ポータル）の消費税の計算と振込予定日に使います。消費税率と端数処理は会社設定で変更します。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="driver-tax-mode">課税区分</Label>
            <Select id="driver-tax-mode" value={f.tax_mode} onChange={(e) => set({ tax_mode: e.target.value as TaxMode })} disabled={disabled}>
              {TAX_MODES.map((m) => (
                <option key={m} value={m}>
                  {TAX_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">課税：税抜の支払額に消費税を上乗せしてお支払いします。非課税・免税：消費税を上乗せしません。</p>
            <FieldError messages={errors.tax_mode} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-invoice">適格請求書登録番号（任意）</Label>
            <Input
              id="driver-invoice"
              value={f.invoice_reg_no}
              onChange={(e) => set({ invoice_reg_no: e.target.value })}
              disabled={disabled}
              placeholder="T1234567890123"
              maxLength={30}
              autoComplete="off"
              className="max-w-[16rem]"
            />
            <p className="text-xs text-muted-foreground">ドライバーがインボイス登録事業者の場合に入力すると支払明細に印字します。</p>
            <FieldError messages={errors.invoice_reg_no} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">振込予定日</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.followPayout} onCheckedChange={(c) => set({ followPayout: c === true })} disabled={disabled} />
              振込予定日は会社設定に従う（現在：{companyPayoutLabel}）
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="driver-payout-offset">支払月</Label>
                <Select
                  id="driver-payout-offset"
                  value={f.payout_month_offset}
                  onChange={(e) => set({ payout_month_offset: e.target.value })}
                  disabled={disabled || f.followPayout}
                >
                  {PAYOUT_MONTH_OFFSETS.map((o) => (
                    <option key={o} value={String(o)}>
                      {PAYOUT_MONTH_OFFSET_LABELS[o]}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors.payout_month_offset} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="driver-payout-day">支払日</Label>
                <Select id="driver-payout-day" value={f.payout_day} onChange={(e) => set({ payout_day: e.target.value })} disabled={disabled || f.followPayout}>
                  {PAYOUT_DAYS.map((d) => (
                    <option key={d} value={String(d)}>
                      {d === 0 ? "末日" : `${d} 日`}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors.payout_day} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              例: {formatMonthJa(month)}分 → <span className="num font-medium text-foreground">{payoutPreview ? formatDateJa(payoutPreview) : "—"}</span>
              （その月に無い日付は末日になります）
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 運転者台帳（0024）。監査で求められる項目。免許証の番号と有効期限は「車両と書類」で持つ */}
      <Card>
        <CardHeader>
          <CardTitle>運転者台帳</CardTitle>
          <CardDescription>
            監査で提出する運転者台帳の項目です。空欄のままでも保存できます（足りないものは 法令対応 の画面に出ます）。
            免許証の番号と有効期限は 車両と書類 → 書類 に登録したものを使います。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="driver-roster-no">作成番号（任意）</Label>
              <Input
                id="driver-roster-no"
                value={f.roster_no}
                onChange={(e) => set({ roster_no: e.target.value })}
                disabled={disabled}
                maxLength={30}
                placeholder="例: R-001"
                autoComplete="off"
              />
              <FieldError messages={errors.roster_no} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-birth">生年月日</Label>
              <Input id="driver-birth" type="date" value={f.birth_date} onChange={(e) => set({ birth_date: e.target.value })} disabled={disabled} />
              <FieldError messages={errors.birth_date} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-address">住所</Label>
            <Input
              id="driver-address"
              value={f.address}
              onChange={(e) => set({ address: e.target.value })}
              disabled={disabled}
              maxLength={200}
              autoComplete="off"
            />
            <FieldError messages={errors.address} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="driver-hired">雇入れ年月日</Label>
              <Input id="driver-hired" type="date" value={f.hired_on} onChange={(e) => set({ hired_on: e.target.value })} disabled={disabled} />
              <FieldError messages={errors.hired_on} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-appointed">選任年月日</Label>
              <Input id="driver-appointed" type="date" value={f.appointed_on} onChange={(e) => set({ appointed_on: e.target.value })} disabled={disabled} />
              <p className="text-xs text-muted-foreground">初任の指導・初任診断の起点です。</p>
              <FieldError messages={errors.appointed_on} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-retired">退職年月日</Label>
              <Input id="driver-retired" type="date" value={f.retired_on} onChange={(e) => set({ retired_on: e.target.value })} disabled={disabled} />
              <p className="text-xs text-muted-foreground">入れると台帳の保存期限が決まります。</p>
              <FieldError messages={errors.retired_on} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="driver-license-kinds">免許の種類</Label>
              <Input
                id="driver-license-kinds"
                value={f.license_kinds}
                onChange={(e) => set({ license_kinds: e.target.value })}
                disabled={disabled}
                maxLength={100}
                placeholder="例: 普通"
                autoComplete="off"
              />
              <FieldError messages={errors.license_kinds} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-license-conditions">免許の条件</Label>
              <Input
                id="driver-license-conditions"
                value={f.license_conditions}
                onChange={(e) => set({ license_conditions: e.target.value })}
                disabled={disabled}
                maxLength={100}
                placeholder="例: 眼鏡等"
                autoComplete="off"
              />
              <FieldError messages={errors.license_conditions} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 振込先口座（見てよい権限のときだけ出す。Server Action と DB でも拒否する） */}
      {canSeeBank && (
        <Card>
          <CardHeader>
            <CardTitle>振込先口座</CardTitle>
            <CardDescription>
              銀行の総合振込データ（全銀フォーマット）に使います。通帳やキャッシュカードのとおりに入力してください。未入力のままでも保存できます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="driver-bank-code">銀行コード（4 桁）</Label>
                <Input
                  id="driver-bank-code"
                  value={f.bank_code}
                  onChange={(e) => set({ bank_code: e.target.value })}
                  disabled={disabled}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="例: 0001"
                  autoComplete="off"
                  className="max-w-[10rem]"
                />
                <FieldError messages={errors["bank_account.bank_code"]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="driver-bank-name">銀行名</Label>
                <Input id="driver-bank-name" value={f.bank_name} onChange={(e) => set({ bank_name: e.target.value })} disabled={disabled} maxLength={100} placeholder="例: みずほ銀行" autoComplete="off" />
                <FieldError messages={errors["bank_account.bank_name"]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="driver-branch-code">支店コード（3 桁）</Label>
                <Input
                  id="driver-branch-code"
                  value={f.branch_code}
                  onChange={(e) => set({ branch_code: e.target.value })}
                  disabled={disabled}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="例: 001"
                  autoComplete="off"
                  className="max-w-[10rem]"
                />
                <FieldError messages={errors["bank_account.branch_code"]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="driver-branch-name">支店名</Label>
                <Input id="driver-branch-name" value={f.branch_name} onChange={(e) => set({ branch_name: e.target.value })} disabled={disabled} maxLength={100} placeholder="例: 東京営業部" autoComplete="off" />
                <FieldError messages={errors["bank_account.branch_name"]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="driver-account-type">預金種目</Label>
                <Select id="driver-account-type" value={f.account_type} onChange={(e) => set({ account_type: e.target.value as BankAccountType | "" })} disabled={disabled}>
                  <option value="">未選択</option>
                  {BANK_ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BANK_ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors["bank_account.account_type"]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="driver-account-number">口座番号（7 桁まで）</Label>
                <Input
                  id="driver-account-number"
                  value={f.account_number}
                  onChange={(e) => set({ account_number: e.target.value })}
                  disabled={disabled}
                  inputMode="numeric"
                  maxLength={12}
                  placeholder="例: 1234567"
                  autoComplete="off"
                  className="max-w-[12rem]"
                />
                <FieldError messages={errors["bank_account.account_number"]} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-account-holder">口座名義（半角カナ）</Label>
              <Input
                id="driver-account-holder"
                value={f.account_holder_kana}
                onChange={(e) => set({ account_holder_kana: e.target.value })}
                onBlur={() => set({ account_holder_kana: toHalfWidthKana(f.account_holder_kana) })}
                disabled={disabled}
                maxLength={48}
                placeholder="例: ﾔﾏﾀﾞ ﾀﾛｳ"
                autoComplete="off"
                aria-describedby="driver-account-holder-help"
              />
              <p id="driver-account-holder-help" className="text-xs text-muted-foreground">
                全角のカナで入力しても、保存時に半角カナへ変換します（例：ヤマダ タロウ → ﾔﾏﾀﾞ ﾀﾛｳ）。姓と名の間は半角スペースを空けてください。
              </p>
              <FieldError messages={errors["bank_account.account_holder_kana"]} />
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* ドライバー別単価 */}
      <Card>
        <CardHeader>
          <CardTitle>ドライバー別単価</CardTitle>
          <CardDescription>
            空欄なら案件内容の標準単価を使います。このドライバーだけ受注単価・支払単価が異なる内容に入力してください。
            {driver && (
              <>
                {" "}
                一覧で見る・まとめて直すには
                <MonthLink href={`/settings/rates?driver=${driver.id}`} className="underline underline-offset-2">
                  設定 → ドライバー別単価
                </MonthLink>
                へ。
              </>
            )}
          </CardDescription>
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
                  const value = overrideValues[item.id] ?? EMPTY_OVERRIDE;
                  const hasOverride = value.bill.trim() !== "" || value.pay.trim() !== "";
                  const billErrors = overrideError(item.id, "bill_rate");
                  const payErrors = overrideError(item.id, "pay_rate");
                  return (
                    <li key={item.id} className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="font-medium">{item.name}</span>
                          <Badge variant="outline">{UNIT_LABELS[item.unit]}</Badge>
                          {!item.is_active && <Badge variant="secondary">停止中</Badge>}
                          {hasOverride && <Badge variant="warning">個別</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          標準 受注 <Money value={item.bill_rate} />／支払 <Money value={item.pay_rate} />
                        </p>
                        {billErrors && <p className="text-xs text-destructive">受注単価: {billErrors[0]}</p>}
                        {payErrors && <p className="text-xs text-destructive">支払単価: {payErrors[0]}</p>}
                      </div>
                      <div className="flex shrink-0 items-end gap-2">
                        <div className="space-y-0.5">
                          <span className="block text-[11px] text-muted-foreground" aria-hidden="true">
                            受注
                          </span>
                          <NumberInput
                            aria-label={`${p.name} ${item.name} の受注単価`}
                            value={value.bill}
                            onChange={(e) => setOverride(item.id, { bill: e.target.value })}
                            disabled={disabled}
                            placeholder={yenPlain(item.bill_rate)}
                            className="w-24 md:w-32"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-[11px] text-muted-foreground" aria-hidden="true">
                            支払
                          </span>
                          <NumberInput
                            aria-label={`${p.name} ${item.name} の支払単価`}
                            value={value.pay}
                            onChange={(e) => setOverride(item.id, { pay: e.target.value })}
                            disabled={disabled}
                            placeholder={yenPlain(item.pay_rate)}
                            className="w-24 md:w-32"
                          />
                        </div>
                      </div>
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
