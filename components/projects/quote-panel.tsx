"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money, Pct } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  calcQuote,
  quoteSensitivity,
  ROUNDING_LABELS,
  ROUNDING_MODES,
  SENSITIVITY_FIELD_LABELS,
  type QuoteVerdictLevel,
  type RateSolution,
  type RoundingMode,
  type SensitivityField,
  type Unit,
} from "@/lib/calc";
import { defaultQuoteForm, parseQuoteForm, type QuoteFormErrors, type QuoteFormInput, type QuoteNumericField } from "@/lib/schemas/quote";
import { pct, qty as qtyText, yen } from "@/lib/format";
import { cn } from "@/lib/utils";

/** プルダウンに出す案件内容（単価を読み込むために使う） */
export interface QuoteItemOption {
  id: string;
  projectName: string;
  itemName: string;
  unit: Unit;
  billRate: number;
  payRate: number;
  /** 案件に設定された目標利益率（0.2 = 20%）。null なら読み込まない */
  targetMargin: number | null;
}

export interface QuoteDefaults {
  /** 会社設定の既定のロイヤリティ率 */
  royaltyRate: number;
  /** 会社設定の既定の管理費 */
  mgmtFee: number;
  roundingMode: RoundingMode;
}

const VERDICT_VARIANT: Record<QuoteVerdictLevel, "success" | "warning" | "destructive"> = {
  good: "success",
  thin: "warning",
  loss: "destructive",
};

const VERDICT_BADGE: Record<QuoteVerdictLevel, "success" | "warning" | "destructive"> = {
  good: "success",
  thin: "warning",
  loss: "destructive",
};

/** 入力 1 項目（ラベル ＋ テンキー ＋ 単位 ＋ エラー） */
function Field({
  field,
  label,
  unit,
  hint,
  form,
  errors,
  onChange,
}: {
  field: QuoteNumericField;
  label: string;
  unit: string;
  hint?: string;
  form: QuoteFormInput;
  errors: QuoteFormErrors;
  onChange: (field: QuoteNumericField, value: string) => void;
}) {
  const id = `quote-${field}`;
  const error = errors[field];
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        <span className="ml-1 text-xs font-normal text-muted-foreground">（{unit}）</span>
      </Label>
      <NumberInput
        id={id}
        className="mt-1"
        value={form[field]}
        onChange={(e) => onChange(field, e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="0"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** 収支の 1 行（ラベル左・金額右） */
function Row({ label, value, note, strong = false }: { label: string; value: number; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-2 last:border-b-0">
      <span className={cn("text-sm", strong ? "font-semibold" : "text-muted-foreground")}>
        {label}
        {note && <span className="ml-1 text-xs text-muted-foreground">{note}</span>}
      </span>
      <Money value={value} className={cn("text-sm", strong && "font-semibold")} />
    </div>
  );
}

/** 逆算の 1 行（解が無いときは理由を出す） */
function SolutionRow({ label, solution, description }: { label: string; solution: RateSolution; description: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {solution.rate == null ? (
        <p className="mt-1 text-sm text-muted-foreground">—</p>
      ) : (
        <p className="mt-1 text-lg font-semibold">
          <Money value={solution.rate} />
          {solution.diff !== 0 && (
            <span className={cn("ml-2 num text-xs font-medium", solution.diff > 0 ? "text-destructive" : "text-success")}>
              {solution.diff > 0 ? `+${yen(solution.diff)}` : `-${yen(-solution.diff)}`}
            </span>
          )}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{solution.rate == null ? solution.reason : description}</p>
    </div>
  );
}

export function QuotePanel({ items, defaults }: { items: QuoteItemOption[]; defaults: QuoteDefaults }) {
  const initial = useMemo(() => defaultQuoteForm(defaults), [defaults]);
  const [form, setForm] = useState<QuoteFormInput>(initial);
  const [itemId, setItemId] = useState("");
  const [field, setField] = useState<SensitivityField>("billRate");

  const parsed = useMemo(() => parseQuoteForm(form), [form]);
  const result = useMemo(() => calcQuote(parsed.input, parsed.targetMargin), [parsed]);
  const sensitivity = useMemo(() => quoteSensitivity(parsed.input, parsed.targetMargin, field), [parsed, field]);

  const setValue = (key: QuoteNumericField, value: string) => setForm((s) => ({ ...s, [key]: value }));

  /** 案件内容を選ぶと受注単価・支払単価（と案件の目標利益率）を読み込む */
  const pickItem = (id: string) => {
    setItemId(id);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setForm((s) => ({
      ...s,
      bill_rate: String(item.billRate),
      pay_rate: String(item.payRate),
      target_margin: item.targetMargin != null ? String(Math.round(item.targetMargin * 1000) / 10) : s.target_margin,
    }));
  };

  const reset = () => {
    setForm(initial);
    setItemId("");
  };

  const unitLabel = items.find((i) => i.id === itemId)?.unit === "piece" ? "個数" : "稼働日数";
  const valueText = (value: number) => (field === "qty" ? qtyText(value) : yen(value));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>条件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="quote-item">案件内容から読み込む</Label>
              <Select id="quote-item" className="mt-1" value={itemId} onChange={(e) => pickItem(e.target.value)}>
                <option value="">選択しない（手で入力する）</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.projectName}／{i.itemName}（受注 {yen(i.billRate)}・支払 {yen(i.payRate)}）
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {items.length === 0 ? "登録済みの案件内容がありません。単価を直接入力してください。" : "選ぶと受注単価・支払単価（と案件の目標利益率）が入ります。"}
              </p>
            </div>
            <div>
              <Label htmlFor="quote-rounding">端数処理（ロイヤリティ）</Label>
              <Select
                id="quote-rounding"
                className="mt-1"
                value={form.rounding_mode}
                onChange={(e) => setForm((s) => ({ ...s, rounding_mode: e.target.value as RoundingMode }))}
              >
                {ROUNDING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUNDING_LABELS[m]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">既定は会社設定の値です。</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field field="bill_rate" label="受注単価" unit="円・税抜" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="pay_rate" label="支払単価" unit="円・税抜" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="qty" label={`月の数量（${unitLabel}）`} unit="1 人あたり" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="royalty_rate" label="ロイヤリティ率" unit="%" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="mgmt_fee" label="管理費" unit="円・月額" hint="ドライバー 1 人あたり" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="driver_count" label="必要なドライバー数" unit="人" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="vehicle_cost" label="車両の月額" unit="円" hint="リース・保険・燃料など。1 台あたり" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="other_cost" label="その他の月額" unit="円" hint="案件全体にかかる分" form={form} errors={parsed.errors} onChange={setValue} />
            <Field field="target_margin" label="目標利益率" unit="%" hint="営業利益 ÷ 売上" form={form} errors={parsed.errors} onChange={setValue} />
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={reset} className="w-full sm:w-auto">
              <RotateCcw className="h-4 w-4" />
              条件をクリア
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert variant={VERDICT_VARIANT[result.verdict.level]}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={VERDICT_BADGE[result.verdict.level]}>{result.verdict.label}</Badge>
          <span className="text-xs">目標 {pct(result.targetMargin)}</span>
        </div>
        <p className="mt-2 leading-relaxed">{result.verdict.message}</p>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>月の収支（税抜）</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label="会社売上" value={result.bill} />
            <Row label="ドライバー支払" value={result.pay} />
            <Row label="単価差" value={result.margin} />
            <Row label="ロイヤリティ" value={result.royalty} />
            <Row label="管理費" value={result.mgmtFeeTotal} />
            <Row label="会社利益" value={result.grossProfit} strong />
            <Row label="直課の費用" value={-result.directCost} note="車両 × 人数 ＋ その他" />
            <div className="mt-3 rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">営業利益（会社利益 − 直課の費用）</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-2">
                <Money value={result.operatingProfit} className="text-2xl font-bold" />
                <span className="text-sm text-muted-foreground">
                  利益率 <Pct value={result.operatingMargin} />
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                ドライバー 1 人あたり 売上 {yen(result.perDriver.bill)}／営業利益 {yen(result.perDriver.operatingProfit)}
                （{result.driverCount} 人で計算）
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>いくらなら受けられるか</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">営業利益 0 になる受注単価</p>
                <p className="mt-1 text-lg font-semibold">
                  {result.breakEvenBillRate == null ? <span className="text-muted-foreground">—</span> : <Money value={result.breakEvenBillRate} />}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {result.breakEvenBillRate == null ? "数量またはドライバー数が 0 のため計算できません。" : "これを下回ると赤字です。"}
                </p>
              </div>
              <SolutionRow
                label={`目標 ${pct(result.targetMargin)} を満たす最低の受注単価`}
                solution={result.targetBillRate}
                description="この単価以上で受ければ目標に届きます。"
              />
              <SolutionRow
                label="受注単価を動かせないときの支払単価の上限"
                solution={result.maxPayRate}
                description="ドライバーへの支払をここまでに収めれば目標に届きます。"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>感度（振れたときの営業利益）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="quote-sensitivity">振る項目</Label>
                <Select id="quote-sensitivity" className="mt-1" value={field} onChange={(e) => setField(e.target.value as SensitivityField)}>
                  {(Object.keys(SENSITIVITY_FIELD_LABELS) as SensitivityField[]).map((f) => (
                    <option key={f} value={f}>
                      {SENSITIVITY_FIELD_LABELS[f]}
                    </option>
                  ))}
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>振れ幅</TableHead>
                    <TableHead className="text-right">{SENSITIVITY_FIELD_LABELS[field]}</TableHead>
                    <TableHead className="text-right">営業利益</TableHead>
                    <TableHead className="text-right">利益率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sensitivity.map((row) => (
                    <TableRow key={row.ratio} className={cn(row.current && "bg-muted/60")}>
                      <TableCell className={cn("whitespace-nowrap", row.current && "font-semibold")}>
                        {row.current ? "現在" : `${row.ratio > 0 ? "+" : "−"}${pct(Math.abs(row.ratio))}`}
                      </TableCell>
                      <TableCell className="num text-right whitespace-nowrap">{valueText(row.value)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Money value={row.operatingProfit} className={cn(row.current && "font-semibold")} />
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Pct value={row.operatingMargin} className={cn(row.level === "loss" && "text-destructive", row.level === "good" && "text-success")} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">試算だけです。案件や単価は保存されません。</p>
        <p className="mt-1">
          金額はすべて税抜です。会社全体の固定費（事務所・システムなど）は案件に按分していません。実際の案件別の利益は「案件ごとの採算」（v_project_pl）で確認してください。
        </p>
        <p className="mt-1">単価・数量は小数 2 桁、率は 0〜100% に丸めて計算します（マイナスは 0）。管理費は数量が 1 以上のときだけ計上します。</p>
      </div>
    </div>
  );
}
