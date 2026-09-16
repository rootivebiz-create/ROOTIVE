"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Money } from "@/components/ui/money";
import type { Masters, ProjectItem, ProjectWithItems } from "@/lib/db/types";
import { calcEntry, parseNumberInput, parsePercentInput, rateToPercent, QTY_LABELS, ROUNDING_LABELS, ROUNDING_MODES, UNIT_LABELS, type EntryDefaults, type RoundingMode } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { entryInputSchema, type EntryInput } from "@/lib/schemas/entries";
import { createEntryAction, updateEntryAction } from "@/lib/actions/entries";
import { defaultsFor, findItem, isLossRow, type EntryRow } from "./helpers";
import { cn } from "@/lib/utils";

export interface EntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** 表示中の稼動月（新規時の既定値） */
  month: string;
  /** 稼働中のドライバー・案件のみ（選択肢） */
  masters: Masters;
  /** 全件（編集時に停止中のドライバー・案件を表示するため） */
  allMasters: Masters;
  /** 編集対象（mode = "edit"） */
  entry?: EntryRow | null;
  onSaved?: () => void;
}

interface FormState {
  driverId: string;
  month: string;
  projectId: string;
  itemId: string;
  qty: string;
  billRate: string;
  payRate: string;
  royaltyPercent: string;
  roundingMode: RoundingMode;
  memo: string;
}

type FieldErrors = Record<string, string[]>;

function numEq(text: string, n: number): boolean {
  const v = parseNumberInput(text);
  return v != null && v === n;
}
function pctEq(text: string, rate: number): boolean {
  const v = parsePercentInput(text);
  return v != null && v === rate;
}

/**
 * マスタ既定値を適用する。force でなければ「自動」状態（前の既定値と同じ or 空）の項目だけ更新し、手入力した値は残す
 */
function withDefaults(form: FormState, prev: EntryDefaults | null, next: EntryDefaults | null, force = false): FormState {
  if (!next) return form;
  const auto = (isAuto: boolean, empty: boolean) => force || prev == null || empty || isAuto;
  return {
    ...form,
    billRate: auto(prev != null && numEq(form.billRate, prev.billRate), form.billRate === "") ? String(next.billRate) : form.billRate,
    payRate: auto(prev != null && numEq(form.payRate, prev.payRate), form.payRate === "") ? String(next.payRate) : form.payRate,
    royaltyPercent: auto(prev != null && pctEq(form.royaltyPercent, prev.royaltyRate), form.royaltyPercent === "") ? String(rateToPercent(next.royaltyRate)) : form.royaltyPercent,
    roundingMode: auto(prev != null && form.roundingMode === prev.roundingMode, false) ? next.roundingMode : form.roundingMode,
  };
}

function initialForm(mode: "create" | "edit", month: string, entry: EntryRow | null | undefined): FormState {
  if (mode === "edit" && entry) {
    return {
      driverId: entry.driverId,
      month: entry.month || month,
      projectId: entry.projectId,
      itemId: entry.projectItemId,
      qty: String(entry.qty),
      billRate: String(entry.billRate),
      payRate: String(entry.payRate),
      royaltyPercent: String(rateToPercent(entry.royaltyRate)),
      roundingMode: entry.roundingMode,
      memo: entry.memo,
    };
  }
  return { driverId: "", month, projectId: "", itemId: "", qty: "", billRate: "", payRate: "", royaltyPercent: "", roundingMode: "none", memo: "" };
}

function SourceBadge({ auto }: { auto: boolean }) {
  return auto ? (
    <Badge variant="secondary" title="マスタの値です">
      自動
    </Badge>
  ) : (
    <Badge variant="warning" title="マスタと異なる値です">
      手入力
    </Badge>
  );
}

/** マスタの単価がドライバー別単価（driver_pay_overrides）から来ていることを示す */
function OverrideNote() {
  return (
    <span className="whitespace-nowrap text-xs text-muted-foreground" title="このドライバーにはドライバー別単価が設定されています">
      ドライバー別
    </span>
  );
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function EntryDialog(props: EntryDialogProps) {
  const { open, onOpenChange, mode } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "稼働を編集" : "稼働を追加"}</DialogTitle>
          <DialogDescription>{mode === "edit" ? "単価・率・端数処理は入力時点の値（スナップショット）です。" : "単価・率・端数処理はマスタから自動入力されます。必要なら手で書き換えできます。"}</DialogDescription>
        </DialogHeader>
        {/* 閉じると中身がアンマウントされるため、開くたびにフォーム状態が初期化される */}
        {open && <EntryForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ onOpenChange, mode, month, masters, allMasters, entry, onSaved }: EntryDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(mode, month, entry));
  const [errors, setErrors] = useState<FieldErrors>({});
  const qtyRef = useRef<HTMLInputElement>(null);

  // ---- 選択肢（稼働中のみ。編集対象が停止中ならその行だけ追加） ----
  const driverOptions = useMemo(() => {
    const list = [...masters.drivers];
    if (entry && !list.some((d) => d.id === entry.driverId)) {
      const d = allMasters.drivers.find((x) => x.id === entry.driverId);
      if (d) list.push(d);
    }
    return list;
  }, [masters.drivers, allMasters.drivers, entry]);

  const projectOptions = useMemo<ProjectWithItems[]>(() => {
    const list = [...masters.projects];
    if (entry && !list.some((p) => p.id === entry.projectId)) {
      const p = allMasters.projects.find((x) => x.id === entry.projectId);
      if (p) list.push(p);
    }
    return list;
  }, [masters.projects, allMasters.projects, entry]);

  const itemsOf = (projectId: string): ProjectItem[] => {
    const p = projectOptions.find((x) => x.id === projectId);
    const items = p ? [...p.items] : [];
    if (entry && entry.projectId === projectId && !items.some((i) => i.id === entry.projectItemId)) {
      const i = findItem(allMasters, entry.projectItemId);
      if (i) items.push(i);
    }
    return items;
  };
  const items = itemsOf(form.projectId);
  const item = form.itemId ? findItem(allMasters, form.itemId) : undefined;
  const unit = item?.unit ?? "day";

  // ---- マスタ既定値と自動／手入力の判定 ----
  const defaults = useMemo(() => (form.driverId && form.itemId ? defaultsFor(allMasters, form.driverId, form.itemId) : null), [allMasters, form.driverId, form.itemId]);
  const autoFlags = {
    billRate: defaults != null && numEq(form.billRate, defaults.billRate),
    payRate: defaults != null && numEq(form.payRate, defaults.payRate),
    royalty: defaults != null && pctEq(form.royaltyPercent, defaults.royaltyRate),
    rounding: defaults != null && form.roundingMode === defaults.roundingMode,
  };
  const allAuto = autoFlags.billRate && autoFlags.payRate && autoFlags.royalty && autoFlags.rounding;

  const changeDriver = (driverId: string) => {
    setForm((f) => withDefaults({ ...f, driverId }, defaultsFor(allMasters, f.driverId, f.itemId), defaultsFor(allMasters, driverId, f.itemId)));
  };
  const changeProject = (projectId: string) => {
    const list = itemsOf(projectId);
    const itemId = list[0]?.id ?? "";
    setForm((f) => withDefaults({ ...f, projectId, itemId }, defaultsFor(allMasters, f.driverId, f.itemId), defaultsFor(allMasters, f.driverId, itemId)));
  };
  const changeItem = (itemId: string) => {
    setForm((f) => withDefaults({ ...f, itemId }, defaultsFor(allMasters, f.driverId, f.itemId), defaultsFor(allMasters, f.driverId, itemId)));
  };
  const resetToMaster = () => {
    if (!defaults) return;
    setForm((f) => withDefaults(f, null, defaults, true));
  };

  // ---- プレビュー（lib/calc） ----
  const qtyNum = parseNumberInput(form.qty);
  const billRateNum = parseNumberInput(form.billRate) ?? 0;
  const payRateNum = parseNumberInput(form.payRate) ?? 0;
  const calc = calcEntry({
    qty: qtyNum ?? 0,
    billRate: billRateNum,
    payRate: payRateNum,
    royaltyRate: parsePercentInput(form.royaltyPercent) ?? 0,
    roundingMode: form.roundingMode,
  });
  const loss = isLossRow({ billRate: billRateNum, payRate: payRateNum });
  const qtyZero = qtyNum === 0;

  // ---- 保存 ----
  const submit = (continueAdding: boolean) => {
    const input: EntryInput = {
      month: form.month,
      driver_id: form.driverId,
      project_item_id: form.itemId,
      qty: form.qty,
      bill_rate: form.billRate,
      pay_rate: form.payRate,
      royalty_percent: form.royaltyPercent,
      rounding_mode: form.roundingMode,
      memo: form.memo,
    };
    const parsed = entryInputSchema.safeParse(input);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fe[key] ??= []).push(issue.message);
      }
      if (!form.driverId) fe.driver_id = ["ドライバーを選択してください"];
      if (!form.itemId) fe.project_item_id = ["案件を選択してください"];
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = mode === "edit" && entry ? await updateEntryAction(entry.id, input) : await createEntryAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onSaved?.();
      if (continueAdding) {
        // ドライバー・案件を保持したまま数量・備考をクリア
        setForm((f) => ({ ...f, qty: "", memo: "" }));
        qtyRef.current?.focus();
      } else {
        onOpenChange(false);
      }
    });
  };

  const inactiveSuffix = (active: boolean) => (active ? "" : "（停止中）");

  return (
    <div className="flex flex-col gap-4">
      {/* ① ドライバー・稼動月 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="entry-driver">ドライバー</Label>
          <Select id="entry-driver" value={form.driverId} onChange={(e) => changeDriver(e.target.value)} disabled={pending} aria-invalid={!!errors.driver_id}>
            <option value="">ドライバーを選択</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {inactiveSuffix(d.is_active)}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="driver_id" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entry-month">稼動月</Label>
          <Input id="entry-month" type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))} disabled={pending} aria-invalid={!!errors.month} />
          <FieldError errors={errors} name="month" />
        </div>
      </div>

      {/* ② 案件 → 内容 */}
      <div className={cn("grid grid-cols-1 gap-3", items.length > 1 && "sm:grid-cols-2")}>
        <div className="space-y-1.5">
          <Label htmlFor="entry-project">案件</Label>
          <Select id="entry-project" value={form.projectId} onChange={(e) => changeProject(e.target.value)} disabled={pending} aria-invalid={!!errors.project_item_id}>
            <option value="">案件を選択</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {inactiveSuffix(p.is_active)}
              </option>
            ))}
          </Select>
          {items.length <= 1 && <FieldError errors={errors} name="project_item_id" />}
        </div>
        {items.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="entry-item">内容</Label>
            <Select id="entry-item" value={form.itemId} onChange={(e) => changeItem(e.target.value)} disabled={pending}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}（{UNIT_LABELS[i.unit]}）{inactiveSuffix(i.is_active)}
                </option>
              ))}
            </Select>
            <FieldError errors={errors} name="project_item_id" />
          </div>
        )}
      </div>

      {/* ③ 数量 */}
      <div className="space-y-1.5">
        <Label htmlFor="entry-qty">
          {QTY_LABELS[unit]}
          {item && <span className="ml-2 text-xs font-normal text-muted-foreground">（{UNIT_LABELS[unit]}型）</span>}
        </Label>
        <div className="flex items-center gap-2">
          <NumberInput
            id="entry-qty"
            ref={qtyRef}
            value={form.qty}
            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.qty}
            className="text-lg"
          />
          <span className="w-6 shrink-0 text-sm text-muted-foreground">{unit === "day" ? "日" : "個"}</span>
        </div>
        <FieldError errors={errors} name="qty" />
      </div>

      {/* ④ 単価・率・端数処理 */}
      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">単価・ロイヤリティ・端数処理</p>
          <Button type="button" variant="ghost" size="sm" onClick={resetToMaster} disabled={pending || !defaults || allAuto}>
            <RotateCcw /> マスタの値に戻す
          </Button>
        </div>
        {!defaults && <p className="mb-2 text-xs text-muted-foreground">ドライバーと案件を選ぶとマスタから自動入力されます。</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <Label htmlFor="entry-bill">受注単価</Label>
              {defaults && (
                <span className="flex items-center gap-1">
                  {defaults.billRateSource === "override" && <OverrideNote />}
                  <SourceBadge auto={autoFlags.billRate} />
                </span>
              )}
            </div>
            <NumberInput id="entry-bill" value={form.billRate} onChange={(e) => setForm((f) => ({ ...f, billRate: e.target.value }))} disabled={pending} aria-invalid={!!errors.bill_rate} />
            <FieldError errors={errors} name="bill_rate" />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <Label htmlFor="entry-pay">支払単価</Label>
              {defaults && (
                <span className="flex items-center gap-1">
                  {defaults.payRateSource === "override" && <OverrideNote />}
                  <SourceBadge auto={autoFlags.payRate} />
                </span>
              )}
            </div>
            <NumberInput id="entry-pay" value={form.payRate} onChange={(e) => setForm((f) => ({ ...f, payRate: e.target.value }))} disabled={pending} aria-invalid={!!errors.pay_rate} className={cn(loss && "text-destructive")} />
            <FieldError errors={errors} name="pay_rate" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <Label htmlFor="entry-royalty">ロイヤリティ率（%）</Label>
              {defaults && <SourceBadge auto={autoFlags.royalty} />}
            </div>
            <div className="flex items-center gap-1">
              <NumberInput id="entry-royalty" value={form.royaltyPercent} onChange={(e) => setForm((f) => ({ ...f, royaltyPercent: e.target.value }))} disabled={pending} aria-invalid={!!errors.royalty_percent} />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <FieldError errors={errors} name="royalty_percent" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <Label htmlFor="entry-rounding">端数処理</Label>
              {defaults && <SourceBadge auto={autoFlags.rounding} />}
            </div>
            <Select id="entry-rounding" value={form.roundingMode} onChange={(e) => setForm((f) => ({ ...f, roundingMode: e.target.value as RoundingMode }))} disabled={pending}>
              {ROUNDING_MODES.map((m) => (
                <option key={m} value={m}>
                  {ROUNDING_LABELS[m]}
                </option>
              ))}
            </Select>
            <FieldError errors={errors} name="rounding_mode" />
          </div>
        </div>
      </div>

      {/* 備考 */}
      <div className="space-y-1.5">
        <Label htmlFor="entry-memo">備考</Label>
        <Textarea id="entry-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      {/* 警告 */}
      {loss && <Alert variant="destructive">支払単価が受注単価を上回っています（赤字）。保存はできますが内容を確認してください。</Alert>}
      {qtyZero && <Alert variant="warning">数量が 0 です。未入力の行として保存されます（管理費は計上されません）。</Alert>}

      {/* ⑤ プレビュー */}
      <div className="rounded-lg bg-muted p-3">
        <p className="mb-2 text-xs text-muted-foreground">
          プレビュー（{formatMonthJa(/^\d{4}-\d{2}$/.test(form.month) ? form.month : month)}）
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">会社売上</dt>
          <dd className="text-right">
            <Money value={calc.bill} />
          </dd>
          <dt className="text-muted-foreground">ドライバー売上</dt>
          <dd className="text-right">
            <Money value={calc.pay} />
          </dd>
          <dt className="text-muted-foreground">単価差額利益</dt>
          <dd className="text-right">
            <Money value={calc.margin} className={cn(loss && "neg")} />
          </dd>
          <dt className="text-muted-foreground">ロイヤリティ</dt>
          <dd className="text-right">
            <Money value={calc.royalty} />
          </dd>
          <dt className="font-semibold">行の利益</dt>
          <dd className="text-right font-semibold">
            <Money value={calc.entryProfit} />
          </dd>
        </dl>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        {mode === "create" && (
          <Button type="button" variant="secondary" onClick={() => submit(true)} disabled={pending}>
            {pending ? "保存中…" : "保存して続けて追加"}
          </Button>
        )}
        <Button type="button" onClick={() => submit(false)} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
