/**
 * ドライバー別単価（設定 → ドライバー別単価）の純関数ヘルパー（React に依存しない。テストからも使う）
 */
import type { Masters, RateDiff } from "@/lib/db/types";
import { ROUNDING_LABELS, type Unit } from "@/lib/calc/types";
import { parseNumberInput } from "@/lib/calc/parse";
import { subMoney } from "@/lib/calc/money";
import { pct, yen } from "@/lib/format";
import { projectDisplayName } from "@/components/entries/helpers";
import type { RateOverrideRowInput } from "@/lib/schemas/rates";

export type RateView = "driver" | "item";

/** 画面で使うマスタ（クライアントへ渡す最小限の形。数値は number に正規化済み） */
export interface RateMasters {
  drivers: { id: string; name: string; isActive: boolean }[];
  projects: {
    id: string;
    name: string;
    clientName: string;
    isActive: boolean;
    items: { id: string; name: string; unit: Unit; billRate: number; payRate: number; isActive: boolean }[];
  }[];
  overrides: { driverId: string; itemId: string; billRate: number | null; payRate: number | null }[];
}

export function toRateMasters(m: Masters): RateMasters {
  return {
    drivers: m.drivers.map((d) => ({ id: d.id, name: d.name, isActive: d.is_active })),
    projects: m.projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.client_name ?? "",
      isActive: p.is_active,
      items: p.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, billRate: Number(i.bill_rate ?? 0), payRate: Number(i.pay_rate ?? 0), isActive: i.is_active })),
    })),
    overrides: m.overrides.map((o) => ({
      driverId: o.driver_id,
      itemId: o.project_item_id,
      billRate: o.bill_rate == null ? null : Number(o.bill_rate),
      payRate: o.pay_rate == null ? null : Number(o.pay_rate),
    })),
  };
}

/** 選択肢（稼働中 → 停止中「（停止中）」付き の順） */
export interface RateOption {
  id: string;
  label: string;
  isActive: boolean;
}

const INACTIVE_SUFFIX = "（停止中）";

export function driverOptions(m: RateMasters): RateOption[] {
  const active = m.drivers.filter((d) => d.isActive).map((d) => ({ id: d.id, label: d.name, isActive: true }));
  const inactive = m.drivers.filter((d) => !d.isActive).map((d) => ({ id: d.id, label: `${d.name}${INACTIVE_SUFFIX}`, isActive: false }));
  return [...active, ...inactive];
}

export function itemOptions(m: RateMasters): RateOption[] {
  const all: RateOption[] = [];
  for (const p of m.projects) {
    for (const i of p.items) {
      const isActive = p.isActive && i.isActive;
      all.push({ id: i.id, label: `${projectDisplayName(p.name, i.name)}${isActive ? "" : INACTIVE_SUFFIX}`, isActive });
    }
  }
  return [...all.filter((o) => o.isActive), ...all.filter((o) => !o.isActive)];
}

/** 一覧の 1 行（ドライバー × 案件内容） */
export interface RateRow {
  key: string;
  driverId: string;
  itemId: string;
  /** 表示名（ドライバーごと表示なら「案件（内容）」、案件ごと表示ならドライバー名） */
  label: string;
  unit: Unit;
  /** ドライバー・案件・内容がすべて稼働中か */
  isActive: boolean;
  /** 案件内容の標準単価 */
  stdBill: number;
  stdPay: number;
  /** 保存済みの個別単価（null＝標準） */
  overrideBill: number | null;
  overridePay: number | null;
}

/** ドライバーごと表示の案件グループ */
export interface RateGroup {
  id: string;
  name: string;
  clientName: string;
  isActive: boolean;
  rows: RateRow[];
}

export function rowKey(driverId: string, itemId: string): string {
  return `${driverId}:${itemId}`;
}

function findOverride(m: RateMasters, driverId: string, itemId: string) {
  return m.overrides.find((o) => o.driverId === driverId && o.itemId === itemId) ?? null;
}

function makeRow(m: RateMasters, driver: RateMasters["drivers"][number], project: RateMasters["projects"][number], item: RateMasters["projects"][number]["items"][number], label: string): RateRow {
  const o = findOverride(m, driver.id, item.id);
  return {
    key: rowKey(driver.id, item.id),
    driverId: driver.id,
    itemId: item.id,
    label,
    unit: item.unit,
    isActive: driver.isActive && project.isActive && item.isActive,
    stdBill: item.billRate,
    stdPay: item.payRate,
    overrideBill: o?.billRate ?? null,
    overridePay: o?.payRate ?? null,
  };
}

/**
 * ドライバーごと表示：稼働中の案件内容（＋停止中でも個別単価がある内容）を案件ごとにグループ化
 * ドライバーが見つからなければ空配列
 */
export function buildDriverRows(m: RateMasters, driverId: string): RateGroup[] {
  const driver = m.drivers.find((d) => d.id === driverId);
  if (!driver) return [];
  const groups: RateGroup[] = [];
  for (const p of m.projects) {
    const rows = p.items
      .filter((i) => (p.isActive && i.isActive) || findOverride(m, driverId, i.id) != null)
      .map((i) => makeRow(m, driver, p, i, projectDisplayName(p.name, i.name)));
    if (rows.length > 0) groups.push({ id: p.id, name: p.name, clientName: p.clientName, isActive: p.isActive, rows });
  }
  return groups;
}

/**
 * 案件ごと表示：稼働中のドライバー（＋停止中でも個別単価があるドライバー）
 * 案件内容が見つからなければ空配列
 */
export function buildItemRows(m: RateMasters, itemId: string): RateRow[] {
  for (const p of m.projects) {
    const item = p.items.find((i) => i.id === itemId);
    if (!item) continue;
    return m.drivers.filter((d) => d.isActive || findOverride(m, d.id, itemId) != null).map((d) => makeRow(m, d, p, item, d.name));
  }
  return [];
}

/** すべての行（変更検出・保存用。表示名はドライバーごと表示のもの） */
export function buildAllRows(m: RateMasters): RateRow[] {
  return m.drivers.flatMap((d) => buildDriverRows(m, d.id).flatMap((g) => g.rows));
}

/** 入力欄の値（文字列のまま扱い、保存時にサーバーで正規化する） */
export interface RateValue {
  bill: string;
  pay: string;
}

export function initialValue(row: RateRow): RateValue {
  return { bill: row.overrideBill == null ? "" : String(row.overrideBill), pay: row.overridePay == null ? "" : String(row.overridePay) };
}

/** 受注・支払のどちらかに入力があれば「個別」 */
export function hasOverrideValue(value: RateValue): boolean {
  return value.bill.trim() !== "" || value.pay.trim() !== "";
}

/** 空欄は null、数値でない入力は "invalid"（変更ありとして送り、サーバーのエラーを表示させる） */
function parsedOrInvalid(s: string): number | null | "invalid" {
  if (s.trim() === "") return null;
  const n = parseNumberInput(s);
  return n == null ? "invalid" : n;
}

/** 保存済みの個別単価と入力値が異なるか（全角・カンマは同じ値として扱う） */
export function isRowChanged(row: RateRow, value: RateValue): boolean {
  const b = parsedOrInvalid(value.bill);
  const p = parsedOrInvalid(value.pay);
  if (b === "invalid" || p === "invalid") return true;
  return b !== row.overrideBill || p !== row.overridePay;
}

/** 変更のある行だけ（values に無い行は未編集） */
export function changedRows(rows: RateRow[], values: Record<string, RateValue | undefined>): { row: RateRow; value: RateValue }[] {
  const out: { row: RateRow; value: RateValue }[] = [];
  for (const row of rows) {
    const value = values[row.key];
    if (value && isRowChanged(row, value)) out.push({ row, value });
  }
  return out;
}

export function toSaveRow(row: RateRow, value: RateValue): RateOverrideRowInput {
  return { driver_id: row.driverId, project_item_id: row.itemId, bill_rate: value.bill, pay_rate: value.pay };
}

/** 実効値（個別値があればそれ、無ければ標準）と差額・赤字判定。支払 0 は正常 */
export function effectiveRates(row: RateRow, value: RateValue): { bill: number; pay: number; diff: number; isLoss: boolean } {
  const bill = parseNumberInput(value.bill) ?? row.stdBill;
  const pay = parseNumberInput(value.pay) ?? row.stdPay;
  return { bill, pay, diff: subMoney(bill, pay), isLoss: pay > bill };
}

/** Server Action の fieldErrors（rows.<index>.bill_rate）を行キーごとのエラーへ */
export type RowErrors = Record<string, { bill?: string; pay?: string }>;

export function rowErrorsFromFieldErrors(fieldErrors: Record<string, string[]> | undefined, keys: string[]): RowErrors {
  const out: RowErrors = {};
  if (!fieldErrors) return out;
  for (const [path, messages] of Object.entries(fieldErrors)) {
    const m = /^rows\.(\d+)\.(bill_rate|pay_rate)$/.exec(path);
    if (!m) continue;
    const key = keys[Number(m[1])];
    if (!key || messages.length === 0) continue;
    const field = m[2] === "bill_rate" ? "bill" : "pay";
    out[key] = { ...out[key], [field]: messages[0] };
  }
  return out;
}

/** 選択中のドライバー（または案件内容）に該当する差分 */
export function filterDiffs(diffs: RateDiff[], view: RateView, id: string): RateDiff[] {
  if (!id) return [];
  return diffs.filter((d) => (view === "driver" ? d.driver_id === id : d.project_item_id === id));
}

/** 差分 1 行の要約：「相曽慧／三郷Amazon：受注 ¥23,025 → ¥23,500、支払 …」 */
export function summarizeDiff(d: RateDiff): string {
  const n = (v: number | string | null | undefined) => Number(v ?? 0);
  const parts: string[] = [];
  if (n(d.bill_rate) !== n(d.master_bill_rate)) parts.push(`受注 ${yen(n(d.bill_rate))} → ${yen(n(d.master_bill_rate))}`);
  if (n(d.pay_rate) !== n(d.master_pay_rate)) parts.push(`支払 ${yen(n(d.pay_rate))} → ${yen(n(d.master_pay_rate))}`);
  if (n(d.royalty_rate) !== n(d.master_royalty_rate)) parts.push(`率 ${pct(n(d.royalty_rate))} → ${pct(n(d.master_royalty_rate))}`);
  if (d.rounding_mode !== d.master_rounding_mode) parts.push(`端数処理 ${ROUNDING_LABELS[d.rounding_mode]} → ${ROUNDING_LABELS[d.master_rounding_mode]}`);
  return `${d.driver_name}／${projectDisplayName(d.project_name, d.item_name)}：${parts.join("、")}`;
}

/** バナー用の要約（最大 max 行＋残り件数） */
export function summarizeDiffs(diffs: RateDiff[], max = 5): { lines: string[]; rest: number } {
  return { lines: diffs.slice(0, max).map(summarizeDiff), rest: Math.max(0, diffs.length - max) };
}
