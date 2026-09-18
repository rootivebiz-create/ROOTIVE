"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveInvoiceItemsAction } from "@/lib/actions/invoices";
import { applyRounding, mulMoney, sumMoney } from "@/lib/calc/money";
import { parseNumberInput } from "@/lib/calc/parse";
import { UNIT_LABELS, type RoundingMode, type Unit } from "@/lib/calc/types";
import { itemUnitLabel, type InvoiceData } from "@/lib/invoice";
import { qty as qtyText } from "@/lib/format";
import type { InvoiceItemFormInput } from "@/lib/schemas/invoices";

interface ItemRow {
  key: string;
  id: string | null;
  name: string;
  unit: Unit | "";
  qty: string;
  unit_price: string;
}

let rowSeq = 0;
const nextKey = () => `new-${++rowSeq}`;
const UNITS: Unit[] = ["day", "piece"];

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

/** 入力中の行の金額（プレビュー。保存後は DB が 数量 × 単価 で計算する） */
function rowAmount(r: ItemRow): number {
  const q = parseNumberInput(r.qty);
  const p = parseNumberInput(r.unit_price);
  if (q == null || p == null) return 0;
  return mulMoney(q, p);
}

export interface InvoiceItemsEditorProps {
  invoice: InvoiceData;
  /** 編集できるか（admin 以上かつ下書き） */
  canEdit: boolean;
}

/** 請求明細の編集（下書きのみ）。金額は入力させず、数量 × 単価で自動計算する */
export function InvoiceItemsEditor({ invoice, canEdit }: InvoiceItemsEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<ItemRow[]>(() =>
    invoice.items.map((it) => ({
      key: it.id,
      id: it.id,
      name: it.name,
      unit: (it.unit ?? "") as Unit | "",
      qty: String(it.qty),
      unit_price: String(it.unitPrice),
    })),
  );

  const updateRow = (key: string, patch: Partial<ItemRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const addRow = () => setRows((rs) => [...rs, { key: nextKey(), id: null, name: "", unit: rs[rs.length - 1]?.unit ?? "day", qty: "", unit_price: "" }]);

  const subtotal = sumMoney(rows.map(rowAmount));
  const tax = applyRounding(subtotal * invoice.taxRate, invoice.taxRounding as RoundingMode);
  const total = sumMoney([subtotal, tax]);

  const save = () => {
    const items: InvoiceItemFormInput[] = rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, qty: r.qty, unit_price: r.unit_price }));
    startTransition(async () => {
      const res = await saveInvoiceItemsAction(invoice.id, items);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };

  // 閲覧のみ（発行済み・入金済み・viewer）
  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>請求明細</CardTitle>
          <CardDescription>{invoice.status === "draft" ? "閲覧のみです（編集権限がありません）。" : "発行済みの請求書は明細を変更できません。下書きに戻すと編集できます。"}</CardDescription>
        </CardHeader>
        <CardContent>
          {invoice.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">明細はありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>内容</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">単価</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{it.unit ? UNIT_LABELS[it.unit] : "—"}</TableCell>
                    <TableCell className="num">
                      {qtyText(it.qty)} {itemUnitLabel(it.unit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={it.unitPrice} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={it.amount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>請求明細</CardTitle>
        <CardDescription>金額は 数量 × 単価 で自動計算されます。稼働から作り直すと、手で追加した行は消えます。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {errors._ && <Alert variant="destructive">{errors._[0]}</Alert>}
        <FieldError messages={errors.items} />

        {rows.length === 0 && <p className="text-sm text-muted-foreground">明細がありません。「行を追加」または「稼働から作り直す」で作成してください。</p>}

        {rows.map((r, i) => (
          <div key={r.key} className="space-y-2 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor={`item-name-${r.key}`}>内容</Label>
              <Input
                id={`item-name-${r.key}`}
                value={r.name}
                onChange={(e) => updateRow(r.key, { name: e.target.value })}
                disabled={pending}
                maxLength={200}
                autoComplete="off"
                placeholder="例: 三郷Amazon（軽貨物）"
              />
              <FieldError messages={errors[`items.${i}.name`]} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`item-unit-${r.key}`}>区分</Label>
                <Select id={`item-unit-${r.key}`} value={r.unit} onChange={(e) => updateRow(r.key, { unit: e.target.value as Unit | "" })} disabled={pending}>
                  <option value="">—</option>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors[`items.${i}.unit`]} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`item-qty-${r.key}`}>数量</Label>
                <NumberInput id={`item-qty-${r.key}`} value={r.qty} onChange={(e) => updateRow(r.key, { qty: e.target.value })} disabled={pending} placeholder="0" />
                <FieldError messages={errors[`items.${i}.qty`]} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`item-price-${r.key}`}>単価</Label>
                <NumberInput id={`item-price-${r.key}`} value={r.unit_price} onChange={(e) => updateRow(r.key, { unit_price: e.target.value })} disabled={pending} placeholder="0" />
                <FieldError messages={errors[`items.${i}.unit_price`]} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                金額 <Money value={rowAmount(r)} />
              </span>
              <Button variant="ghost" size="sm" onClick={() => removeRow(r.key)} disabled={pending} aria-label={`${r.name || `${i + 1} 行目`} を削除`}>
                <Trash2 /> 削除
              </Button>
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={addRow} disabled={pending}>
          <Plus /> 行を追加
        </Button>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">小計（税抜）</dt>
            <dd>
              <Money value={subtotal} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">消費税（{invoice.taxRateLabel}）</dt>
            <dd>
              <Money value={tax} />
            </dd>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>合計（税込）</dt>
            <dd>
              <Money value={total} />
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">※ 保存するまでは入力中の金額（プレビュー）です。保存すると DB が計算し直します。</p>

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending} size="lg">
            {pending ? "保存中…" : "明細を保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
