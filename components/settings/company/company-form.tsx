"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateCompanyAction } from "@/lib/actions/company";
import { ROUNDING_LABELS, ROUNDING_MODES, type RoundingMode } from "@/lib/calc/types";
import { parseNumberInput, parsePercentInput } from "@/lib/calc/parse";
import { calcTax } from "@/lib/calc/tax";
import { yen } from "@/lib/format";
import { currentMonthJST, formatDateJa, formatMonthJa, payoutDate } from "@/lib/month";
import { fiscalPeriodOfMonth, fiscalSettingsOf, periodTitle } from "@/lib/fiscal";
import {
  FISCAL_MONTHS,
  PAYOUT_MONTH_OFFSETS,
  PAYOUT_MONTH_OFFSET_LABELS,
  YAYOI_DATE_BASIS,
  YAYOI_DATE_BASIS_LABELS,
  YAYOI_TEXT_KEYS,
  type CompanyFormInput,
  type YayoiTextKey,
} from "@/lib/schemas/company";
import { YAYOI_ACCOUNT_LABELS } from "@/lib/yayoi/accounts";
import { toHalfWidthKana } from "@/lib/schemas/drivers";
import { BANK_ACCOUNT_TYPES, BANK_ACCOUNT_TYPE_LABELS, type BankAccountType } from "@/lib/db/types";

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

const PAYOUT_DAYS = Array.from({ length: 32 }, (_, i) => i);

/** 消費税額の端数処理は「丸めない」を選べない（税額は円単位） */
const TAX_ROUNDING_MODES = ROUNDING_MODES.filter((m) => m !== "none");
/** 消費税の計算例に使う税抜小計 */
const TAX_EXAMPLE_BASE = 100_000;

export function CompanyForm({ initial, currentMonth }: { initial: CompanyFormInput; currentMonth: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [f, setF] = useState<CompanyFormInput>(initial);
  const set = (patch: Partial<CompanyFormInput>) => setF((prev) => ({ ...prev, ...patch }));
  const setYayoi = (patch: Partial<CompanyFormInput["yayoi_accounts"]>) => setF((prev) => ({ ...prev, yayoi_accounts: { ...prev.yayoi_accounts, ...patch } }));

  const offsetNum = parseNumberInput(f.payout_month_offset);
  const dayNum = parseNumberInput(f.payout_day);
  const preview = offsetNum != null && dayNum != null && Number.isInteger(offsetNum) && Number.isInteger(dayNum) ? payoutDate(currentMonth, offsetNum, dayNum) : null;

  const taxRateNum = parsePercentInput(f.tax_rate);
  const taxExample = taxRateNum != null && taxRateNum >= 0 && taxRateNum <= 1 ? calcTax(TAX_EXAMPLE_BASE, { mode: "taxable", rate: taxRateNum, rounding: f.tax_rounding }) : null;

  const submit = () =>
    startTransition(async () => {
      const res = await updateCompanyAction(f);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });

  const saveButton = (
    <Button onClick={submit} disabled={pending}>
      <Save /> {pending ? "保存中…" : "保存"}
    </Button>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex justify-end">{saveButton}</div>

      <Card>
        <CardHeader>
          <CardTitle>会社情報</CardTitle>
          <CardDescription>支払明細（PDF・印刷）の発行者情報として印字されます。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">会社名</Label>
            <Input id="company-name" value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} required disabled={pending} />
            <FieldError messages={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-address">住所</Label>
            <Input id="company-address" value={f.address} onChange={(e) => set({ address: e.target.value })} maxLength={200} disabled={pending} />
            <FieldError messages={errors.address} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-tel">電話番号</Label>
              <Input id="company-tel" value={f.tel} onChange={(e) => set({ tel: e.target.value })} inputMode="tel" maxLength={50} disabled={pending} />
              <FieldError messages={errors.tel} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-invoice">適格請求書登録番号</Label>
              <Input id="company-invoice" value={f.invoice_reg_no} onChange={(e) => set({ invoice_reg_no: e.target.value })} placeholder="T1234567890123" maxLength={30} disabled={pending} />
              <FieldError messages={errors.invoice_reg_no} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>計算の既定値</CardTitle>
          <CardDescription>ドライバーごとの設定が「会社設定に従う」のときに使う値です。稼働行には入力時点の値が記録されるため、変更しても過去の数字は動きません。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-rounding">ロイヤリティ額の端数処理</Label>
              <Select id="company-rounding" value={f.rounding_mode} onChange={(e) => set({ rounding_mode: e.target.value as RoundingMode })} disabled={pending}>
                {ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUNDING_LABELS[m]}
                  </option>
                ))}
              </Select>
              <FieldError messages={errors.rounding_mode} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-royalty">新規ドライバーの標準ロイヤリティ率（%）</Label>
              <NumberInput id="company-royalty" value={f.default_royalty_rate} onChange={(e) => set({ default_royalty_rate: e.target.value })} placeholder="10" disabled={pending} />
              <FieldError messages={errors.default_royalty_rate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-mgmt">新規ドライバーの標準管理費（月額・円）</Label>
              <NumberInput id="company-mgmt" value={f.default_mgmt_fee} onChange={(e) => set({ default_mgmt_fee: e.target.value })} placeholder="15000" disabled={pending} />
              <FieldError messages={errors.default_mgmt_fee} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>振込予定日</CardTitle>
          <CardDescription>支払明細に表示する振込予定日のルールです（既定：翌月末）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-payout-offset">支払月</Label>
              <Select id="company-payout-offset" value={f.payout_month_offset} onChange={(e) => set({ payout_month_offset: e.target.value })} disabled={pending}>
                {PAYOUT_MONTH_OFFSETS.map((o) => (
                  <option key={o} value={String(o)}>
                    {PAYOUT_MONTH_OFFSET_LABELS[o]}
                  </option>
                ))}
              </Select>
              <FieldError messages={errors.payout_month_offset} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-payout-day">支払日</Label>
              <Select id="company-payout-day" value={f.payout_day} onChange={(e) => set({ payout_day: e.target.value })} disabled={pending}>
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
            例: {formatMonthJa(currentMonth)}分 → <span className="num font-medium text-foreground">{preview ? formatDateJa(preview) : "—"}</span>
            （その月に無い日付は末日になります）
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>消費税</CardTitle>
          <CardDescription>
            単価・管理費・ロイヤリティはすべて税抜で入力します。支払明細では税抜小計（稼働小計 − ロイヤリティ − 管理費）に消費税率を掛けて税込のお支払額を計算します。調整（固定控除・立替など）は税込の金額として扱い、消費税を計算しません。ドライバーごとの課税区分（課税／非課税・免税）はドライバー設定で変更できます。締めた月の税率・端数処理は締めた時点の値で固定されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-tax-rate">消費税率（%）</Label>
              <NumberInput id="company-tax-rate" value={f.tax_rate} onChange={(e) => set({ tax_rate: e.target.value })} placeholder="10" disabled={pending} />
              <FieldError messages={errors.tax_rate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-tax-rounding">消費税額の端数処理</Label>
              <Select id="company-tax-rounding" value={f.tax_rounding} onChange={(e) => set({ tax_rounding: e.target.value as RoundingMode })} disabled={pending}>
                {TAX_ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUNDING_LABELS[m]}
                  </option>
                ))}
              </Select>
              <FieldError messages={errors.tax_rounding} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            例: 税抜小計 {yen(TAX_EXAMPLE_BASE)} → 消費税 <span className="num font-medium text-foreground">{taxExample != null ? yen(taxExample) : "—"}</span> → 税込{" "}
            <span className="num font-medium text-foreground">{taxExample != null ? yen(TAX_EXAMPLE_BASE + taxExample) : "—"}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>決算月と期</CardTitle>
          <CardDescription>
            決算・税務の期限（法人税の申告、消費税の申告など）の目安と、月の切り替え・年次レポートの「第N期」の区切りに使います。分からなければ顧問税理士に確認してください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 md:max-w-[16rem]">
            <Label htmlFor="company-fiscal-month">決算月</Label>
            <Select id="company-fiscal-month" value={f.fiscal_month} onChange={(e) => set({ fiscal_month: e.target.value })} disabled={pending}>
              {FISCAL_MONTHS.map((m) => (
                <option key={m} value={String(m)}>
                  {m} 月
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">例：3 月決算なら「3 月」。多くの会社は 3 月・9 月・12 月です。</p>
            <FieldError messages={errors.fiscal_month} />
          </div>
          <div className="space-y-1.5 md:max-w-[16rem]">
            <Label htmlFor="company-established-on">設立日</Label>
            <Input id="company-established-on" type="date" value={f.established_on} onChange={(e) => set({ established_on: e.target.value })} disabled={pending} />
            <p className="text-xs text-muted-foreground">入れると「第3期」のように期の番号で表示します。空欄なら「2026年9月期」のように決算の年月で表示します。</p>
            <FieldError messages={errors.established_on} />
          </div>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="fiscal-preview">
            今は <span className="font-medium">{periodTitle(fiscalPeriodOfMonth(currentMonthJST(), fiscalSettingsOf({ fiscal_month: f.fiscal_month, established_on: f.established_on })))}</span> です。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>振込元（総合振込のデータに使う）</CardTitle>
          <CardDescription>
            ドライバーへの振込データ（全銀フォーマット）の依頼人情報です。委託者コードと委託者名は<strong>銀行から指定される番号・名前</strong>です。分からなければ空のままで構いません（あとから入力できます）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-consignor-code">委託者コード（10 桁）</Label>
              <Input
                id="company-fb-consignor-code"
                value={f.fb_consignor_code}
                onChange={(e) => set({ fb_consignor_code: e.target.value })}
                inputMode="numeric"
                maxLength={14}
                placeholder="例: 0123456789"
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">銀行から指定される番号です。分からなければ空のままで構いません。</p>
              <FieldError messages={errors.fb_consignor_code} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-consignor-kana">委託者名（半角カナ）</Label>
              <Input
                id="company-fb-consignor-kana"
                value={f.fb_consignor_kana}
                onChange={(e) => set({ fb_consignor_kana: e.target.value })}
                onBlur={() => set({ fb_consignor_kana: toHalfWidthKana(f.fb_consignor_kana) })}
                maxLength={40}
                placeholder="例: ｶ)ﾙｰﾃｨﾌﾞ"
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">全角のカナで入力しても、保存時に半角カナへ変換します。銀行の登録名と同じにしてください。</p>
              <FieldError messages={errors.fb_consignor_kana} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-bank-code">銀行コード（4 桁）</Label>
              <Input id="company-fb-bank-code" value={f.fb_bank_code} onChange={(e) => set({ fb_bank_code: e.target.value })} inputMode="numeric" maxLength={8} placeholder="例: 0001" disabled={pending} />
              <FieldError messages={errors.fb_bank_code} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-bank-name">銀行名</Label>
              <Input id="company-fb-bank-name" value={f.fb_bank_name} onChange={(e) => set({ fb_bank_name: e.target.value })} maxLength={100} placeholder="例: みずほ銀行" disabled={pending} />
              <FieldError messages={errors.fb_bank_name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-branch-code">支店コード（3 桁）</Label>
              <Input id="company-fb-branch-code" value={f.fb_branch_code} onChange={(e) => set({ fb_branch_code: e.target.value })} inputMode="numeric" maxLength={6} placeholder="例: 001" disabled={pending} />
              <FieldError messages={errors.fb_branch_code} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-branch-name">支店名</Label>
              <Input id="company-fb-branch-name" value={f.fb_branch_name} onChange={(e) => set({ fb_branch_name: e.target.value })} maxLength={100} placeholder="例: 東京営業部" disabled={pending} />
              <FieldError messages={errors.fb_branch_name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-account-type">預金種目</Label>
              <Select id="company-fb-account-type" value={f.fb_account_type} onChange={(e) => set({ fb_account_type: e.target.value as BankAccountType | "" })} disabled={pending}>
                <option value="">未選択</option>
                {BANK_ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BANK_ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <FieldError messages={errors.fb_account_type} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-fb-account-number">口座番号（7 桁まで）</Label>
              <Input
                id="company-fb-account-number"
                value={f.fb_account_number}
                onChange={(e) => set({ fb_account_number: e.target.value })}
                inputMode="numeric"
                maxLength={12}
                placeholder="例: 1234567"
                disabled={pending}
              />
              <FieldError messages={errors.fb_account_number} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>支払明細</CardTitle>
          <CardDescription>明細の末尾に印字する定型文と、ドライバーポータルの表示範囲です。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="company-note">明細の備考定型文</Label>
            <Textarea id="company-note" value={f.statement_note} onChange={(e) => set({ statement_note: e.target.value })} maxLength={2000} rows={3} placeholder="例: ご不明点は担当までご連絡ください。" disabled={pending} />
            <FieldError messages={errors.statement_note} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="company-portal-royalty">ドライバーポータルでロイヤリティ率を見せる</Label>
              <p className="mt-1 text-xs text-muted-foreground">オフにするとポータルの明細・PDF ではロイヤリティの金額のみ表示します。</p>
            </div>
            <Switch id="company-portal-royalty" checked={f.driver_portal_show_royalty} onCheckedChange={(v) => set({ driver_portal_show_royalty: v })} disabled={pending} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="company-portal-open-month">未締め月の速報を表示する</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                オンにすると、ドライバーポータルに未締め月の暫定のお支払予定額（速報）を表示します。締め前のため金額は変わることがあります。
              </p>
            </div>
            <Switch
              id="company-portal-open-month"
              checked={f.driver_portal_show_open_month}
              onCheckedChange={(v) => set({ driver_portal_show_open_month: v })}
              disabled={pending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>弥生会計の勘定科目</CardTitle>
          <CardDescription>仕訳インポート CSV に使う勘定科目・補助科目・税区分です（税理士の確認を前提に変更してください）。空欄は既定値になります。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {YAYOI_TEXT_KEYS.map((key: YayoiTextKey) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`yayoi-${key}`}>{YAYOI_ACCOUNT_LABELS[key]}</Label>
                <Input id={`yayoi-${key}`} value={f.yayoi_accounts[key]} onChange={(e) => setYayoi({ [key]: e.target.value } as Partial<CompanyFormInput["yayoi_accounts"]>)} maxLength={50} disabled={pending} />
                <FieldError messages={errors[`yayoi_accounts.${key}`]} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="yayoi-date-basis">{YAYOI_ACCOUNT_LABELS.date_basis}</Label>
              <Select id="yayoi-date-basis" value={f.yayoi_accounts.date_basis} onChange={(e) => setYayoi({ date_basis: e.target.value as CompanyFormInput["yayoi_accounts"]["date_basis"] })} disabled={pending}>
                {YAYOI_DATE_BASIS.map((b) => (
                  <option key={b} value={b}>
                    {YAYOI_DATE_BASIS_LABELS[b]}
                  </option>
                ))}
              </Select>
              <FieldError messages={errors["yayoi_accounts.date_basis"]} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="yayoi-split">{YAYOI_ACCOUNT_LABELS.split_by_driver}</Label>
                <p className="mt-1 text-xs text-muted-foreground">オフにすると月合計で 1 行にまとめます。</p>
              </div>
              <Switch id="yayoi-split" checked={f.yayoi_accounts.split_by_driver} onCheckedChange={(v) => setYayoi({ split_by_driver: v })} disabled={pending} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">{saveButton}</div>
    </form>
  );
}
