"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Lock, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Money, Qty } from "@/components/ui/money";
import { Alert } from "@/components/ui/alert";
import { MonthLink } from "@/components/layout/month-link";
import type { Masters } from "@/lib/db/types";
import { calcEntry, parseNumberInput, sumMoney, QTY_LABELS, UNIT_LABELS } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { bulkSetEntriesAction } from "@/lib/actions/entries";
import type { BulkRowInput } from "@/lib/schemas/entries";
import { defaultsFor, isLossRow, itemOptions, oldestEntryFor, unitSuffix, type EntryRow } from "./helpers";
import { cn } from "@/lib/utils";

export interface BulkFormProps {
  month: string;
  /** 稼働中のドライバー・案件のみ */
  masters: Masters;
  /** 当月の稼働行（全件） */
  rows: EntryRow[];
  editable: boolean;
  closed: boolean;
  initialItemId?: string;
}

interface DriverLine {
  driverId: string;
  driverName: string;
  existing: EntryRow | null;
  duplicateCount: number;
  payRate: number;
  billRate: number;
  paySource: "snapshot" | "auto";
  initialQty: string;
}

export function BulkForm({ month, masters, rows, editable, closed, initialItemId = "" }: BulkFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = useMemo(() => itemOptions(masters), [masters]);
  const [itemId, setItemId] = useState(() => (options.some((o) => o.id === initialItemId) ? initialItemId : ""));
  const [edits, setEdits] = useState<Record<string, string>>({});

  // 選択中の案件内容を URL（?item=）へ反映
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (itemId) sp.set("item", itemId);
    else sp.delete("item");
    const qs = sp.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [itemId]);

  const option = options.find((o) => o.id === itemId) ?? null;
  const unit = option?.unit ?? "day";

  const lines = useMemo<DriverLine[]>(() => {
    if (!itemId) return [];
    return masters.drivers.map((d) => {
      const { entry, count } = oldestEntryFor(rows, d.id, itemId);
      const defaults = defaultsFor(masters, d.id, itemId);
      return {
        driverId: d.id,
        driverName: d.name,
        existing: entry,
        duplicateCount: count,
        payRate: entry ? entry.payRate : (defaults?.payRate ?? 0),
        billRate: entry ? entry.billRate : (defaults?.billRate ?? 0),
        paySource: entry ? "snapshot" : "auto",
        initialQty: entry ? String(entry.qty) : "",
      };
    });
  }, [masters, rows, itemId]);

  const valueOf = (line: DriverLine) => edits[line.driverId] ?? line.initialQty;
  const qtyOf = (line: DriverLine) => parseNumberInput(valueOf(line)) ?? 0;
  // 変更判定：数量が既存と異なる、または既存行（数量 0 の複製行を含む）を利用者が明示的に空欄／0 にした場合は「削除」として送る
  const isChanged = (line: DriverLine) => {
    const edited = edits[line.driverId] !== undefined;
    const q = qtyOf(line);
    return q !== (line.existing?.qty ?? 0) || (edited && line.existing != null && q === 0);
  };
  const invalid = (line: DriverLine) => {
    const v = valueOf(line).trim();
    if (v === "") return false;
    const n = parseNumberInput(v);
    return n == null || n < 0;
  };

  const changedLines = lines.filter(isChanged);
  const hasInvalid = lines.some(invalid);
  const totalQty = sumMoney(lines.map(qtyOf));
  const totalPay = sumMoney(lines.map((l) => calcEntry({ qty: qtyOf(l), billRate: l.billRate, payRate: l.payRate, royaltyRate: 0, roundingMode: "none" }).pay));

  const changeItem = (id: string) => {
    if (changedLines.length > 0 && !window.confirm("未保存の変更があります。案件を切り替えると破棄されます。よろしいですか？")) return;
    setItemId(id);
    setEdits({});
  };

  const save = () => {
    if (!itemId || changedLines.length === 0) {
      toast.info("変更はありません。");
      return;
    }
    if (hasInvalid) {
      toast.error("数量は 0 以上の数値で入力してください。");
      return;
    }
    const payload: BulkRowInput[] = changedLines.map((l) => ({ driver_id: l.driverId, qty: valueOf(l) }));
    startTransition(async () => {
      const res = await bulkSetEntriesAction(month, itemId, payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      setEdits({});
      router.refresh();
    });
  };

  const readOnly = !editable || pending;

  return (
    <div>
      <PageHeader
        title="一括入力"
        description={`${formatMonthJa(month)}：案件内容を 1 つ選び、稼働中ドライバー全員の数量をまとめて入力します`}
        actions={
          <>
            {closed && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> 締め済み
              </Badge>
            )}
            <MonthLink href="/entries" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft /> 稼働一覧へ
            </MonthLink>
          </>
        }
      />

      {!editable && !closed && <Alert className="mb-3">閲覧のみです。稼働の編集には管理者権限が必要です。</Alert>}

      <div className="mb-4 space-y-1.5">
        <Label htmlFor="bulk-item">案件（内容）</Label>
        <Select id="bulk-item" value={itemId} onChange={(e) => changeItem(e.target.value)} disabled={pending} className="md:max-w-md">
          <option value="">案件を選択</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        {option && (
          <p className="text-xs text-muted-foreground">
            {UNIT_LABELS[option.unit]}型 ／ 数量は{QTY_LABELS[option.unit]}。空欄または 0 にすると行を削除します。既存行の単価はそのまま維持されます。
          </p>
        )}
      </div>

      {!itemId ? (
        <Empty title="案件を選択してください" description="選んだ案件内容について、ドライバーごとの数量を入力できます。" />
      ) : lines.length === 0 ? (
        <Empty title="稼働中のドライバーがいません" description="設定 → ドライバー で稼働中のドライバーを登録してください。" />
      ) : (
        <Card>
          <ul className="divide-y">
            {lines.map((line) => {
              const value = valueOf(line);
              const changed = isChanged(line);
              const bad = invalid(line);
              const loss = isLossRow(line);
              const pay = calcEntry({ qty: qtyOf(line), billRate: line.billRate, payRate: line.payRate, royaltyRate: 0, roundingMode: "none" }).pay;
              return (
                <li key={line.driverId} className={cn("flex items-center gap-2 px-3 py-2", changed && "bg-accent/40")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{line.driverName}</p>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        支払単価 <Money value={line.payRate} className={cn(loss && "text-destructive")} />
                      </span>
                      {line.paySource === "auto" ? (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          自動
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          登録済み
                        </Badge>
                      )}
                      {loss && (
                        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                          赤字
                        </Badge>
                      )}
                      {line.duplicateCount > 1 && <span>（他 {line.duplicateCount - 1} 行あり）</span>}
                      {qtyOf(line) > 0 && (
                        <span>
                          ＝ <Money value={pay} />
                        </span>
                      )}
                    </p>
                  </div>
                  <NumberInput
                    value={value}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [line.driverId]: e.target.value }))}
                    placeholder="0"
                    disabled={readOnly}
                    aria-label={`${line.driverName}の${QTY_LABELS[unit]}`}
                    aria-invalid={bad}
                    className={cn("w-24 shrink-0", bad && "border-destructive")}
                  />
                  <span className="w-5 shrink-0 text-sm text-muted-foreground">{unitSuffix(unit)}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium">合計</span>
            <span className="flex items-center gap-3">
              <span>
                <Qty value={totalQty} />
                {unitSuffix(unit)}
              </span>
              <span>
                ドライバー売上 <Money value={totalPay} />
              </span>
            </span>
          </div>
        </Card>
      )}

      {editable && itemId && lines.length > 0 && (
        <div className="sticky bottom-20 mt-4 flex items-center justify-between gap-2 rounded-lg border bg-card/95 p-3 shadow-sm backdrop-blur md:bottom-4">
          <p className="text-sm text-muted-foreground">{changedLines.length > 0 ? `変更 ${changedLines.length} 件` : "変更はありません"}</p>
          <Button onClick={save} disabled={pending || changedLines.length === 0 || hasInvalid}>
            <Save /> {pending ? "保存中…" : "保存"}
          </Button>
        </div>
      )}
    </div>
  );
}
