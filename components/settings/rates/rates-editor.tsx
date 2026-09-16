"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyMasterRatesAction, saveRateOverridesAction } from "@/lib/actions/rates";
import { UNIT_LABELS } from "@/lib/calc/types";
import type { RateDiff } from "@/lib/db/types";
import { yen, yenPlain } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import {
  buildAllRows,
  buildDriverRows,
  buildItemRows,
  changedRows,
  driverOptions,
  effectiveRates,
  filterDiffs,
  hasOverrideValue,
  initialValue,
  itemOptions,
  rowErrorsFromFieldErrors,
  summarizeDiffs,
  toSaveRow,
  type RateMasters,
  type RateRow,
  type RateValue,
  type RateView,
  type RowErrors,
} from "./helpers";

export interface RatesEditorProps {
  masters: RateMasters;
  /** 稼動月 YYYY-MM（当月反映の対象） */
  month: string;
  /** 稼動月が締め済みか */
  closed: boolean;
  /** false（viewer）なら閲覧のみ */
  canEdit: boolean;
  /** 稼動月の稼働行とマスタの差分（締め済みなら空） */
  diffs: RateDiff[];
  initialView: RateView;
  initialDriverId: string | null;
  initialItemId: string | null;
}

function RateRowItem({
  row,
  value,
  error,
  showUnit,
  disabled,
  onChange,
}: {
  row: RateRow;
  value: RateValue;
  error?: { bill?: string; pay?: string };
  showUnit: boolean;
  disabled: boolean;
  onChange: (next: RateValue) => void;
}) {
  const eff = effectiveRates(row, value);
  const hasOverride = hasOverrideValue(value);
  return (
    <li className={cn("flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:gap-3", !row.isActive && "bg-muted/40")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{row.label}</span>
          {showUnit && <Badge variant="outline">{UNIT_LABELS[row.unit]}</Badge>}
          {!row.isActive && <Badge variant="secondary">停止中</Badge>}
          {hasOverride && <Badge variant="warning">個別</Badge>}
          {eff.isLoss && <Badge variant="destructive">赤字</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          標準 受注 {yen(row.stdBill)}／支払 {yen(row.stdPay)}
          <span className="ml-2">
            差額 <Money value={eff.diff} />
          </span>
        </p>
        {error?.bill && <p className="text-xs text-destructive">受注単価: {error.bill}</p>}
        {error?.pay && <p className="text-xs text-destructive">支払単価: {error.pay}</p>}
      </div>
      <div className="flex shrink-0 items-end gap-2">
        <div className="space-y-0.5">
          <span className="block text-[11px] text-muted-foreground" aria-hidden="true">
            受注
          </span>
          <NumberInput
            aria-label={`${row.label} の受注単価`}
            value={value.bill}
            onChange={(e) => onChange({ ...value, bill: e.target.value })}
            placeholder={yenPlain(row.stdBill)}
            disabled={disabled}
            className={cn("w-24 md:w-32", error?.bill && "border-destructive")}
          />
        </div>
        <div className="space-y-0.5">
          <span className="block text-[11px] text-muted-foreground" aria-hidden="true">
            支払
          </span>
          <NumberInput
            aria-label={`${row.label} の支払単価`}
            value={value.pay}
            onChange={(e) => onChange({ ...value, pay: e.target.value })}
            placeholder={yenPlain(row.stdPay)}
            disabled={disabled}
            className={cn("w-24 md:w-32", error?.pay && "border-destructive")}
          />
        </div>
      </div>
    </li>
  );
}

export function RatesEditor({ masters, month, closed, canEdit, diffs, initialView, initialDriverId, initialItemId }: RatesEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const monthLabel = formatMonthJa(month);

  const drivers = useMemo(() => driverOptions(masters), [masters]);
  const items = useMemo(() => itemOptions(masters), [masters]);

  const [view, setView] = useState<RateView>(initialView);
  const [driverId, setDriverId] = useState<string>(() => (initialDriverId && drivers.some((d) => d.id === initialDriverId) ? initialDriverId : (drivers[0]?.id ?? "")));
  const [itemId, setItemId] = useState<string>(() => (initialItemId && items.some((i) => i.id === initialItemId) ? initialItemId : (items[0]?.id ?? "")));
  /** 編集した行だけ（無い行は保存済みの値を表示） */
  const [values, setValues] = useState<Record<string, RateValue | undefined>>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [applyOpen, setApplyOpen] = useState(false);

  const driverGroups = useMemo(() => buildDriverRows(masters, driverId), [masters, driverId]);
  const itemRows = useMemo(() => buildItemRows(masters, itemId), [masters, itemId]);
  const allRows = useMemo(() => buildAllRows(masters), [masters]);
  const changed = useMemo(() => changedRows(allRows, values), [allRows, values]);

  const selectedId = view === "driver" ? driverId : itemId;
  const selectedDiffs = useMemo(() => filterDiffs(diffs, view, selectedId), [diffs, view, selectedId]);
  const summary = useMemo(() => summarizeDiffs(selectedDiffs), [selectedDiffs]);

  const disabled = !canEdit || pending;
  const valueOf = (row: RateRow) => values[row.key] ?? initialValue(row);
  const setValue = (row: RateRow, next: RateValue) => setValues((v) => ({ ...v, [row.key]: next }));

  const submit = () => {
    if (!canEdit || changed.length === 0) return;
    const targets = changed;
    const payload = targets.map(({ row, value }) => toSaveRow(row, value));
    startTransition(async () => {
      const res = await saveRateOverridesAction(payload);
      if (res.ok) {
        setRowErrors({});
        toast.success(res.message ?? "単価を保存しました");
        router.refresh();
      } else {
        setRowErrors(rowErrorsFromFieldErrors(res.fieldErrors, targets.map((t) => t.row.key)));
        toast.error(res.error);
      }
    });
  };

  const apply = () => {
    if (!canEdit || closed || !selectedId) return;
    startTransition(async () => {
      const res = await applyMasterRatesAction(view === "driver" ? { month, driver_id: selectedId } : { month, project_item_id: selectedId });
      setApplyOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "更新しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const renderRow = (row: RateRow, showUnit: boolean) => (
    <RateRowItem key={row.key} row={row} value={valueOf(row)} error={rowErrors[row.key]} showUnit={showUnit} disabled={disabled} onChange={(next) => setValue(row, next)} />
  );

  const applyBanner =
    canEdit && !closed && selectedDiffs.length > 0 ? (
      <Alert variant="warning" className="space-y-2">
        <p className="font-semibold">
          {monthLabel} の稼働 {selectedDiffs.length} 行が現在の単価・率と異なります
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {summary.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          {summary.rest > 0 && <li>ほか {summary.rest} 行</li>}
        </ul>
        <Button size="sm" variant="outline" onClick={() => setApplyOpen(true)} disabled={pending}>
          {monthLabel} の稼働に反映
        </Button>
      </Alert>
    ) : canEdit && closed ? (
      <p className="text-sm text-muted-foreground">{monthLabel} は締め済みのため反映できません。</p>
    ) : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!canEdit && <Alert>閲覧のみです（編集権限がありません）。</Alert>}

      <Tabs value={view} onValueChange={(v) => setView(v as RateView)}>
        <TabsList aria-label="表示の切り替え">
          <TabsTrigger value="driver">ドライバーごと</TabsTrigger>
          <TabsTrigger value="item">案件ごと</TabsTrigger>
        </TabsList>

        {/* ドライバーごと */}
        <TabsContent value="driver" className="space-y-4">
          {drivers.length === 0 ? (
            <Empty title="ドライバーが登録されていません" description="先に「ドライバー」で登録してください。" />
          ) : (
            <>
              <div className="space-y-1.5 sm:max-w-md">
                <Label htmlFor="rates-driver">ドライバー</Label>
                <Select id="rates-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={pending}>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>
              {applyBanner}
              {driverGroups.length === 0 ? (
                <Empty title="有効な案件内容がありません" description="先に「案件・単価」で登録してください。" />
              ) : (
                driverGroups.map((g) => (
                  <section key={g.id} className="space-y-2" aria-label={g.name}>
                    <p className="text-sm font-semibold">
                      {g.name}
                      {g.clientName && <span className="ml-2 text-xs font-normal text-muted-foreground">{g.clientName}</span>}
                      {!g.isActive && (
                        <Badge variant="secondary" className="ml-2">
                          停止中
                        </Badge>
                      )}
                    </p>
                    <ul className="divide-y rounded-md border">{g.rows.map((row) => renderRow(row, true))}</ul>
                  </section>
                ))
              )}
            </>
          )}
        </TabsContent>

        {/* 案件ごと */}
        <TabsContent value="item" className="space-y-4">
          {items.length === 0 ? (
            <Empty title="案件内容が登録されていません" description="先に「案件・単価」で登録してください。" />
          ) : (
            <>
              <div className="space-y-1.5 sm:max-w-md">
                <Label htmlFor="rates-item">案件内容</Label>
                <Select id="rates-item" value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={pending}>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </Select>
              </div>
              {applyBanner}
              {itemRows.length === 0 ? (
                <Empty title="稼働中のドライバーがいません" description="先に「ドライバー」で登録してください。" />
              ) : (
                <ul className="divide-y rounded-md border">{itemRows.map((row) => renderRow(row, false))}</ul>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {canEdit && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <span className="text-sm text-muted-foreground">{changed.length > 0 ? `変更 ${changed.length} 行` : "変更はありません"}</span>
          <Button type="submit" size="lg" disabled={pending || changed.length === 0}>
            {pending ? "保存中…" : "保存する"}
          </Button>
        </div>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>受注・支払の両方を空欄にして保存すると、その組み合わせは標準（案件内容の単価）に戻ります。</p>
        <p>
          単価を変えても、入力済みの稼働行の単価は自動では変わりません（入力時点の値を保持します）。当月の稼働に反映するには上の「稼働に反映」を使います。締め済みの月は変わりません。
        </p>
      </div>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{monthLabel} の稼働に反映しますか？</DialogTitle>
            <DialogDescription>{selectedDiffs.length} 行の単価・率を現在のマスタの値に更新します。締め済みの月は更新できません。</DialogDescription>
          </DialogHeader>
          {changed.length > 0 && <Alert variant="warning">未保存の変更（{changed.length} 行）は反映されません。先に「保存する」を押してください。</Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={apply} disabled={pending}>
              {pending ? "反映中…" : "反映する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
