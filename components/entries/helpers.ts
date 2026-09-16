/**
 * 稼働入力画面の純関数ヘルパー（React に依存しない。テストからも使う）
 */
import type { Masters, WorkEntryCalc, ProjectWithItems, ProjectItem, Driver } from "@/lib/db/types";
import { resolveEntryDefaults, type EntryDefaults, type RoundingMode, type Unit } from "@/lib/calc";
import { dateToMonth } from "@/lib/month";

/** 画面で扱う稼働行（ビューの null を正規化したもの） */
export interface EntryRow {
  id: string;
  month: string; // YYYY-MM
  driverId: string;
  driverName: string;
  driverIsActive: boolean;
  projectId: string;
  projectItemId: string;
  projectName: string;
  itemName: string;
  unit: Unit;
  qty: number;
  billRate: number;
  payRate: number;
  royaltyRate: number;
  roundingMode: RoundingMode;
  memo: string;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  entryProfit: number;
  createdAt: string;
}

export function toEntryRow(e: WorkEntryCalc): EntryRow {
  return {
    id: e.id ?? "",
    month: e.month ? dateToMonth(e.month) : "",
    driverId: e.driver_id ?? "",
    driverName: e.driver_name ?? "",
    driverIsActive: e.driver_is_active ?? true,
    projectId: e.project_id ?? "",
    projectItemId: e.project_item_id ?? "",
    projectName: e.project_name ?? "",
    itemName: e.item_name ?? "",
    unit: (e.unit ?? "day") as Unit,
    qty: Number(e.qty ?? 0),
    billRate: Number(e.bill_rate ?? 0),
    payRate: Number(e.pay_rate ?? 0),
    royaltyRate: Number(e.royalty_rate ?? 0),
    roundingMode: (e.rounding_mode ?? "none") as RoundingMode,
    memo: e.memo ?? "",
    bill: Number(e.bill ?? 0),
    pay: Number(e.pay ?? 0),
    margin: Number(e.margin ?? 0),
    royalty: Number(e.royalty ?? 0),
    entryProfit: Number(e.entry_profit ?? 0),
    createdAt: e.created_at ?? "",
  };
}

/** 案件の表示名：内容が「標準」以外なら「案件（内容）」 */
export function projectDisplayName(projectName: string, itemName: string): string {
  const item = itemName.trim();
  return item && item !== "標準" ? `${projectName}（${item}）` : projectName;
}

/** 数量の単位（日／個） */
export function unitSuffix(unit: Unit): string {
  return unit === "day" ? "日" : "個";
}

/** 行の警告：数量 0（未入力） */
export function isQtyEmpty(row: { qty: number }): boolean {
  return row.qty === 0;
}

/** 行の警告：支払単価 > 受注単価（赤字）。川島幹太のように支払 0 は正常 */
export function isLossRow(row: { billRate: number; payRate: number }): boolean {
  return row.payRate > row.billRate;
}

/** 稼働中のドライバー・案件（内容）だけに絞る（loadMasters の activeOnly と同じ規則） */
export function filterActiveMasters(m: Masters): Masters {
  return {
    company: m.company,
    drivers: m.drivers.filter((d) => d.is_active),
    projects: m.projects
      .filter((p) => p.is_active)
      .map((p) => ({ ...p, items: p.items.filter((i) => i.is_active) }))
      .filter((p) => p.items.length > 0),
    overrides: m.overrides,
  };
}

export function findDriver(m: Masters, driverId: string): Driver | undefined {
  return m.drivers.find((d) => d.id === driverId);
}

export function findProjectByItem(m: Masters, itemId: string): ProjectWithItems | undefined {
  return m.projects.find((p) => p.items.some((i) => i.id === itemId));
}

export function findItem(m: Masters, itemId: string): ProjectItem | undefined {
  for (const p of m.projects) {
    const item = p.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return undefined;
}

/** マスタからの自動入力（§2.5）。ドライバー・案件内容が見つからなければ null */
export function defaultsFor(m: Masters, driverId: string, itemId: string): EntryDefaults | null {
  const driver = findDriver(m, driverId);
  const item = findItem(m, itemId);
  if (!driver || !item) return null;
  const override = m.overrides.find((o) => o.driver_id === driverId && o.project_item_id === itemId);
  return resolveEntryDefaults({
    item: { billRate: Number(item.bill_rate), payRate: Number(item.pay_rate) },
    override: override ? { payRate: Number(override.pay_rate) } : null,
    driver: { royaltyRate: driver.royalty_rate == null ? null : Number(driver.royalty_rate), roundingMode: driver.rounding_mode },
    company: { defaultRoyaltyRate: Number(m.company.default_royalty_rate), roundingMode: m.company.rounding_mode },
  });
}

/** 案件内容の選択肢（案件順 → 内容順） */
export interface ItemOption {
  id: string;
  projectId: string;
  projectName: string;
  itemName: string;
  unit: Unit;
  label: string;
}

export function itemOptions(m: Masters): ItemOption[] {
  const out: ItemOption[] = [];
  for (const p of m.projects) {
    for (const i of p.items) {
      out.push({ id: i.id, projectId: p.id, projectName: p.name, itemName: i.name, unit: i.unit, label: projectDisplayName(p.name, i.name) });
    }
  }
  return out;
}

/** 検索（案件名・内容・備考・ドライバー名の部分一致、大文字小文字を区別しない） */
export function matchesQuery(row: EntryRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.driverName, row.projectName, row.itemName, projectDisplayName(row.projectName, row.itemName), row.memo].some((s) => s.toLowerCase().includes(q));
}

export function filterRows(rows: EntryRow[], driverId: string, query: string): EntryRow[] {
  return rows.filter((r) => (!driverId || r.driverId === driverId) && matchesQuery(r, query));
}

/** 一括入力：ドライバー × 案件内容の既存行（同一組み合わせが複数ある場合は created_at が最も古い行） */
export function oldestEntryFor(rows: EntryRow[], driverId: string, itemId: string): { entry: EntryRow | null; count: number } {
  const matched = rows.filter((r) => r.driverId === driverId && r.projectItemId === itemId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return { entry: matched[0] ?? null, count: matched.length };
}
