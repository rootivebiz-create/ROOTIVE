"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/input";
import { Money, Pct } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { parseNumberInput, parsePercentInput, simulateCompanyMonth, type RateChange, type SimDriver } from "@/lib/calc";
import { pct, yen } from "@/lib/format";
import { cn } from "@/lib/utils";

type Unit = "yen" | "pct";

interface FieldState {
  unit: Unit;
  value: string;
}

const EMPTY: FieldState = { unit: "yen", value: "" };

/** 入力欄の値を読む。空欄は null（現状のまま）、数値にならない文字は null ＋ エラー表示 */
function readField(f: FieldState): { value: number | null; invalid: boolean } {
  const raw = f.value.trim();
  if (raw === "") return { value: null, invalid: false };
  const n = f.unit === "pct" ? parsePercentInput(raw) : parseNumberInput(raw);
  return { value: n, invalid: n == null };
}

function readNumber(raw: string, percent = false): { value: number | null; invalid: boolean } {
  const s = raw.trim();
  if (s === "") return { value: null, invalid: false };
  const n = percent ? parsePercentInput(s) : parseNumberInput(s);
  return { value: n, invalid: n == null };
}

function InvalidHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="mt-1 text-xs text-destructive">数値で入力してください（全角・カンマも使えます）。</p>;
}

/** 金額の比較（今 → 変更後 → 差額）。差額は利益が増える向きを緑で示す */
function CompareCard({
  label,
  before,
  after,
  diff,
  note,
  kind = "money",
  upIsGood = true,
}: {
  label: string;
  before: number;
  after: number;
  diff: number;
  note?: string;
  kind?: "money" | "rate";
  upIsGood?: boolean;
}) {
  const tone = diff === 0 ? "text-muted-foreground" : diff > 0 === upIsGood ? "text-success" : "text-destructive";
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
  const diffText = kind === "rate" ? `${sign}${pct(Math.abs(diff))}` : `${sign}${yen(Math.abs(diff))}`;
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">今</p>
          <p className="truncate text-sm">{kind === "rate" ? <Pct value={before} /> : <Money value={before} />}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">変更後</p>
          <p className="truncate text-sm font-semibold">{kind === "rate" ? <Pct value={after} /> : <Money value={after} />}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground" title={kind === "rate" ? "差はパーセントポイント" : undefined}>
            差額
          </p>
          <p className={cn("num truncate text-sm font-semibold", tone)}>{diffText}</p>
        </div>
      </div>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export interface SimulationPanelProps {
  /** 当月の対象（一覧に出しているドライバーと同じ） */
  drivers: SimDriver[];
  selectedDriverId: string;
  selectedDriverName: string;
}

/** 単価改定シミュレーション（試算のみ。保存はしない） */
export function SimulationPanel({ drivers, selectedDriverId, selectedDriverName }: SimulationPanelProps) {
  const [scope, setScope] = useState<"driver" | "all">("driver");
  const [bill, setBill] = useState<FieldState>(EMPTY);
  const [pay, setPay] = useState<FieldState>(EMPTY);
  const [royalty, setRoyalty] = useState("");
  const [mgmtFee, setMgmtFee] = useState("");

  const billField = readField(bill);
  const payField = readField(pay);
  const royaltyField = readNumber(royalty, true);
  const mgmtFeeField = readNumber(mgmtFee);

  const hasDriver = drivers.some((d) => d.driverId === selectedDriverId);
  const effectiveScope = hasDriver ? scope : "all";

  const change: RateChange = useMemo(
    () => ({
      billRateDelta: bill.unit === "yen" ? billField.value : null,
      billRateRatio: bill.unit === "pct" ? billField.value : null,
      payRateDelta: pay.unit === "yen" ? payField.value : null,
      payRateRatio: pay.unit === "pct" ? payField.value : null,
      royaltyRate: royaltyField.value,
      mgmtFee: mgmtFeeField.value,
    }),
    [bill.unit, billField.value, pay.unit, payField.value, royaltyField.value, mgmtFeeField.value],
  );

  const targets = useMemo(
    () => (effectiveScope === "all" ? drivers : drivers.filter((d) => d.driverId === selectedDriverId)),
    [drivers, effectiveScope, selectedDriverId],
  );

  const result = useMemo(() => simulateCompanyMonth(targets, change), [targets, change]);

  const reset = () => {
    setBill(EMPTY);
    setPay(EMPTY);
    setRoyalty("");
    setMgmtFee("");
  };

  const conditions: string[] = [];
  if (billField.value) conditions.push(`受注単価 ${billField.value > 0 ? "+" : "−"}${bill.unit === "pct" ? pct(Math.abs(billField.value)) : yen(Math.abs(billField.value))}`);
  if (payField.value) conditions.push(`支払単価 ${payField.value > 0 ? "+" : "−"}${pay.unit === "pct" ? pct(Math.abs(payField.value)) : yen(Math.abs(payField.value))}`);
  if (royaltyField.value != null) conditions.push(`ロイヤリティ率 ${pct(royaltyField.value)}`);
  if (mgmtFeeField.value != null) conditions.push(`管理費 ${yen(mgmtFeeField.value)}`);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="sim-scope">対象</Label>
          <Select
            id="sim-scope"
            className="mt-1"
            value={effectiveScope}
            onChange={(e) => setScope(e.target.value === "all" ? "all" : "driver")}
            disabled={!hasDriver}
          >
            <option value="driver">{selectedDriverName || "選択中のドライバー"}（1 名）</option>
            <option value="all">全員（{drivers.length} 名）</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="sim-bill">受注単価の増減</Label>
          <div className="mt-1 flex gap-2">
            <NumberInput
              id="sim-bill"
              className="flex-1"
              placeholder="0"
              value={bill.value}
              onChange={(e) => setBill((s) => ({ ...s, value: e.target.value }))}
              aria-label="受注単価の増減"
            />
            <Select className="w-20 shrink-0" value={bill.unit} onChange={(e) => setBill((s) => ({ ...s, unit: e.target.value as Unit }))} aria-label="受注単価の単位">
              <option value="yen">円</option>
              <option value="pct">%</option>
            </Select>
          </div>
          <InvalidHint show={billField.invalid} />
        </div>

        <div>
          <Label htmlFor="sim-pay">支払単価の増減</Label>
          <div className="mt-1 flex gap-2">
            <NumberInput
              id="sim-pay"
              className="flex-1"
              placeholder="0"
              value={pay.value}
              onChange={(e) => setPay((s) => ({ ...s, value: e.target.value }))}
              aria-label="支払単価の増減"
            />
            <Select className="w-20 shrink-0" value={pay.unit} onChange={(e) => setPay((s) => ({ ...s, unit: e.target.value as Unit }))} aria-label="支払単価の単位">
              <option value="yen">円</option>
              <option value="pct">%</option>
            </Select>
          </div>
          <InvalidHint show={payField.invalid} />
        </div>

        <div>
          <Label htmlFor="sim-royalty">ロイヤリティ率（%）</Label>
          <NumberInput
            id="sim-royalty"
            className="mt-1"
            placeholder="現状のまま"
            value={royalty}
            onChange={(e) => setRoyalty(e.target.value)}
            aria-label="ロイヤリティ率"
          />
          <InvalidHint show={royaltyField.invalid} />
        </div>

        <div>
          <Label htmlFor="sim-mgmt">管理費（円）</Label>
          <NumberInput id="sim-mgmt" className="mt-1" placeholder="現状のまま" value={mgmtFee} onChange={(e) => setMgmtFee(e.target.value)} aria-label="管理費" />
          <InvalidHint show={mgmtFeeField.invalid} />
        </div>

        <div className="flex items-end">
          <Button variant="outline" onClick={reset} className="w-full sm:w-auto">
            <RotateCcw className="h-4 w-4" />
            条件をクリア
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {conditions.length > 0 ? `条件：${conditions.join(" ／ ")}` : "条件を入力すると「変更後」が変わります（プラス・マイナスどちらも入力できます）。"}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CompareCard label="会社売上（税抜）" before={result.before.bill} after={result.after.bill} diff={result.diff.bill} />
        <CompareCard label="ドライバー支払（税抜）" before={result.before.payout} after={result.after.payout} diff={result.diff.payout} upIsGood={false} note="支払が増えると会社利益は減ります" />
        <CompareCard label="会社利益" before={result.before.profit} after={result.after.profit} diff={result.diff.profit} />
        <CompareCard label="利益率" before={result.before.profitRate} after={result.after.profitRate} diff={result.diff.profitRate} kind="rate" />
        <CompareCard
          label="ドライバーの手取り（税込支払額）"
          before={result.before.payoutIncl}
          after={result.after.payoutIncl}
          diff={result.diff.payoutIncl}
          upIsGood={false}
          note="消費税を含む実際の振込額"
        />
        <CompareCard label="ロイヤリティ" before={result.before.royalty} after={result.after.royalty} diff={result.diff.royalty} />
      </div>

      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">試算だけです。単価は保存されません。</p>
        <p className="mt-1">
          実際に単価を変えるときは、設定 → ドライバー別単価（`/settings/rates`）や 設定 → 案件・単価 で保存し、未締め月の稼働行には「単価をマスタに合わせる」で反映してください。
        </p>
        <p className="mt-1">単価は小数 2 桁・ロイヤリティ率は 0〜100%・管理費は 0 円以上に丸めて計算します（マイナスになる場合は 0）。</p>
      </div>
    </div>
  );
}
