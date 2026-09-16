"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Money } from "@/components/ui/money";
import { calcDriverMonth, parseNumberInput, taxRateLabel, type EntryInput, type TaxInput } from "@/lib/calc";
import { yen } from "@/lib/format";
import { saveDriverMonthAction } from "@/lib/actions/payouts";

export interface DialogAdjustment {
  id: string;
  label: string;
  amount: number;
  countAsProfit: boolean;
  recurringId: string | null;
}

export interface RecurringOption {
  id: string;
  label: string;
  amount: number;
  countAsProfit: boolean;
}

export interface DriverMonthDialogProps {
  month: string;
  monthLabel: string;
  driverId: string;
  driverName: string;
  /** 現在の管理費（driver_months.mgmt_fee。無ければドライバー標準値） */
  mgmtFee: number;
  driverDefaultMgmtFee: number;
  memo: string;
  adjustments: DialogAdjustment[];
  /** プレビュー用の稼働行（スナップショット値） */
  entries: EntryInput[];
  /** 有効な固定控除 */
  recurring: RecurringOption[];
  /** 消費税の計算条件（明細データの taxMode / taxRate / taxRounding）。省略時は消費税を計算しない */
  tax?: TaxInput | null;
}

type Kind = "deduct" | "add";

interface AdjRow {
  key: string;
  id?: string;
  label: string;
  kind: Kind;
  amount: string;
  countAsProfit: boolean;
  recurringId: string | null;
}

function signedAmount(row: AdjRow): number {
  const n = parseNumberInput(row.amount);
  if (n == null) return 0;
  const abs = Math.abs(n);
  return row.kind === "deduct" ? -abs : abs;
}

function toRows(adjs: DialogAdjustment[]): AdjRow[] {
  return adjs.map((a) => ({
    key: `saved-${a.id}`,
    id: a.id,
    label: a.label,
    kind: a.amount < 0 ? "deduct" : "add",
    amount: String(Math.abs(a.amount)),
    countAsProfit: a.countAsProfit,
    recurringId: a.recurringId,
  }));
}

/** 「管理費・調整を編集」ダイアログ（admin+・未締め月のみ表示すること） */
export function DriverMonthDialog(props: DriverMonthDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mgmtFee, setMgmtFee] = useState(String(props.mgmtFee));
  const [memo, setMemo] = useState(props.memo);
  const [rows, setRows] = useState<AdjRow[]>(() => toRows(props.adjustments));
  const seq = useRef(0);
  const nextKey = () => `new-${++seq.current}`;
  const tax = props.tax ?? null;
  const taxable = tax?.mode === "taxable";
  const payoutLabel = taxable ? "お支払額（税込）" : "お支払額";

  const reset = () => {
    setMgmtFee(String(props.mgmtFee));
    setMemo(props.memo);
    setRows(toRows(props.adjustments));
  };

  const handleOpenChange = (v: boolean) => {
    if (v) reset();
    setOpen(v);
  };

  const preview = useMemo(() => {
    const fee = parseNumberInput(mgmtFee) ?? 0;
    return calcDriverMonth({
      entries: props.entries,
      mgmtFee: fee < 0 ? 0 : fee,
      adjustments: rows.map((r) => ({ amount: signedAmount(r), countAsProfit: r.countAsProfit })),
      tax,
    });
  }, [props.entries, mgmtFee, rows, tax]);

  const feeNum = parseNumberInput(mgmtFee);
  const feeDiffers = feeNum != null && feeNum !== props.driverDefaultMgmtFee;

  const updateRow = (key: string, patch: Partial<AdjRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));
  const addRow = () => setRows((prev) => [...prev, { key: nextKey(), label: "", kind: "deduct", amount: "", countAsProfit: true, recurringId: null }]);
  const addRecurring = (r: RecurringOption) => {
    if (rows.some((x) => x.recurringId === r.id)) return;
    setRows((prev) => [
      ...prev,
      { key: nextKey(), label: r.label, kind: r.amount < 0 ? "deduct" : "add", amount: String(Math.abs(r.amount)), countAsProfit: r.countAsProfit, recurringId: r.id },
    ]);
  };

  const save = () => {
    if (feeNum == null || feeNum < 0) {
      toast.error("管理費は 0 以上の数値で入力してください。");
      return;
    }
    for (const r of rows) {
      if (!r.label.trim()) {
        toast.error("調整の項目名を入力してください。");
        return;
      }
      if (parseNumberInput(r.amount) == null) {
        toast.error(`「${r.label.trim()}」の金額を入力してください。`);
        return;
      }
    }
    startTransition(async () => {
      const res = await saveDriverMonthAction({
        month: props.month,
        driverId: props.driverId,
        mgmtFee,
        memo,
        adjustments: rows.map((r) => ({
          id: r.id,
          label: r.label.trim(),
          amount: signedAmount(r),
          countAsProfit: r.countAsProfit,
          recurringId: r.recurringId,
        })),
      });
      if (res.ok) {
        toast.success(res.message ?? "保存しました");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => handleOpenChange(true)}>
        <Pencil />
        管理費・調整を編集
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="md:max-w-xl">
          <DialogHeader>
            <DialogTitle>管理費・調整を編集</DialogTitle>
            <DialogDescription>
              {props.driverName} 様 ／ {props.monthLabel}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* 管理費 */}
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="dm-mgmt-fee">管理費（月額・税抜）</Label>
                <span className="text-xs text-muted-foreground">ドライバー標準：{yen(props.driverDefaultMgmtFee)}</span>
              </div>
              <div className="flex gap-2">
                <NumberInput id="dm-mgmt-fee" value={mgmtFee} onChange={(e) => setMgmtFee(e.target.value)} placeholder="0" aria-label="管理費" />
                <Button type="button" variant="outline" onClick={() => setMgmtFee(String(props.driverDefaultMgmtFee))} disabled={!feeDiffers} className="shrink-0">
                  <RotateCcw />
                  標準に戻す
                </Button>
              </div>
              {feeDiffers && <p className="text-xs text-warning">ドライバー標準（{yen(props.driverDefaultMgmtFee)}）と異なります。</p>}
              {preview.activeEntryCount === 0 && <p className="text-xs text-muted-foreground">数量 &gt; 0 の稼働行が無いため、この月の管理費は計上されません。</p>}
            </section>

            {/* メモ */}
            <section className="space-y-1.5">
              <Label htmlFor="dm-memo">メモ（社内用）</Label>
              <Textarea id="dm-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={2000} placeholder="例：リース代の精算について" />
            </section>

            {/* 調整 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>調整（控除・加算、税込）</Label>
                <span className="text-xs text-muted-foreground">控除は支払額から差し引き</span>
              </div>
              {rows.length === 0 && <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">調整はありません。</p>}
              <ul className="space-y-2">
                {rows.map((r, i) => (
                  <li key={r.key} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={r.label}
                        onChange={(e) => updateRow(r.key, { label: e.target.value })}
                        placeholder="項目名（例：リース代、ペナルティ、立替精算）"
                        maxLength={100}
                        aria-label={`調整 ${i + 1} の項目名`}
                      />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(r.key)} aria-label="この調整を削除" className="shrink-0 text-destructive">
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={r.kind} onChange={(e) => updateRow(r.key, { kind: e.target.value as Kind })} className="w-28 shrink-0" aria-label="控除か加算か">
                        <option value="deduct">控除（−）</option>
                        <option value="add">加算（＋）</option>
                      </Select>
                      <NumberInput value={r.amount} onChange={(e) => updateRow(r.key, { amount: e.target.value })} placeholder="金額" aria-label={`調整 ${i + 1} の金額`} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={r.countAsProfit} onCheckedChange={(v) => updateRow(r.key, { countAsProfit: v === true })} />
                        会社利益に計上する
                      </label>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {r.recurringId && <span>固定控除</span>}
                        <Money value={signedAmount(r)} className="text-sm" />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  <Plus />
                  調整を追加
                </Button>
                {props.recurring.map((r) => {
                  const added = rows.some((x) => x.recurringId === r.id);
                  return (
                    <Button key={r.id} type="button" variant="secondary" size="sm" onClick={() => addRecurring(r)} disabled={added} title={added ? "追加済み" : "固定控除を追加"}>
                      <Plus />
                      {r.label}（{yen(r.amount)}）
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                調整は税込の金額として扱い、消費税の対象には含めません。「会社利益に計上」を外した調整（立替精算など）は支払額だけに反映され、会社利益には影響しません。
              </p>
            </section>

            {/* プレビュー（lib/calc の calcDriverMonth。集計ビューと同じ計算） */}
            <section className="rounded-md bg-muted/60 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">支払額プレビュー</p>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt>ドライバー売上</dt>
                  <dd>
                    <Money value={preview.pay} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>ロイヤリティ</dt>
                  <dd>
                    <Money value={-preview.royalty} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>管理費{preview.activeEntryCount === 0 && preview.mgmtFeeSetting !== 0 ? "（未計上）" : ""}</dt>
                  <dd>
                    <Money value={-preview.mgmtFee} />
                  </dd>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium">
                  <dt>小計（税抜）</dt>
                  <dd>
                    <Money value={preview.taxBase} />
                  </dd>
                </div>
                {taxable && (
                  <div className="flex justify-between">
                    <dt>消費税（{taxRateLabel(tax.rate)}）</dt>
                    <dd>
                      <Money value={preview.tax} />
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>調整（税込）</dt>
                  <dd>
                    <Money value={preview.adjPay} showZeroAsDash />
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
                  <dt>{payoutLabel}</dt>
                  <dd>
                    <Money value={preview.payoutIncl} className="text-lg" />
                  </dd>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <dt>会社利益（参考・税抜）</dt>
                  <dd>
                    <Money value={preview.driverProfit} />
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
