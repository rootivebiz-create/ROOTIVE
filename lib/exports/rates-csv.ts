/**
 * 単価表 CSV：稼働中のドライバー × 稼働中の案件内容の全組み合わせについて、
 * 実効単価（ドライバー別単価 → 案件内容の標準、§2.5）とその出所を出す
 * 並び：ドライバーの並び順 → 案件の並び順 → 内容の並び順
 */
import type { Masters } from "@/lib/db/types";
import { fromS4, resolveEntryDefaults, toS4, UNIT_LABELS, type Unit } from "@/lib/calc";
import { rawNumber } from "@/lib/format";
import { toCsv, type CsvValue } from "./csv";
import { timestampJST } from "./download";

export const RATES_CSV_HEADERS = ["ドライバー", "案件", "内容", "区分", "受注単価", "支払単価", "差額", "受注単価の出所", "支払単価の出所", "個別受注単価", "個別支払単価"] as const;

export type RateSource = "override" | "item";

/** 単価の出所の表示（個別＝driver_pay_overrides、標準＝project_items） */
export const RATE_SOURCE_LABELS: Record<RateSource, string> = { override: "個別", item: "標準" };

/** 単価表の 1 行（ドライバー × 案件内容） */
export interface RateRow {
  driverId: string;
  driverName: string;
  projectId: string;
  projectName: string;
  itemId: string;
  itemName: string;
  unit: Unit;
  /** 実効の受注単価 */
  billRate: number;
  /** 実効の支払単価 */
  payRate: number;
  /** 受注単価 − 支払単価 */
  margin: number;
  billRateSource: RateSource;
  payRateSource: RateSource;
  /** 個別単価（上書きが無ければ null） */
  overrideBillRate: number | null;
  overridePayRate: number | null;
}

/** 並び順 → 名前 の順で比較する（loadMasters の order と同じ規則） */
function bySortOrder<T extends { sort_order: number; name: string }>(a: T, b: T): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

const overrideKey = (driverId: string, itemId: string) => `${driverId}:${itemId}`;

/** マスタ一式 → 単価表の行（停止中のドライバー・案件・内容は除外） */
export function rateRows(masters: Masters): RateRow[] {
  const drivers = masters.drivers.filter((d) => d.is_active).sort(bySortOrder);
  const projects = masters.projects.filter((p) => p.is_active).sort(bySortOrder);
  const overrides = new Map(masters.overrides.map((o) => [overrideKey(o.driver_id, o.project_item_id), o]));
  const company = { defaultRoyaltyRate: Number(masters.company.default_royalty_rate), roundingMode: masters.company.rounding_mode };

  const out: RateRow[] = [];
  for (const driver of drivers) {
    const driverSrc = { royaltyRate: driver.royalty_rate == null ? null : Number(driver.royalty_rate), roundingMode: driver.rounding_mode };
    for (const project of projects) {
      const items = project.items.filter((i) => i.is_active).sort(bySortOrder);
      for (const item of items) {
        const o = overrides.get(overrideKey(driver.id, item.id));
        const overrideBillRate = o && o.bill_rate != null ? Number(o.bill_rate) : null;
        const overridePayRate = o && o.pay_rate != null ? Number(o.pay_rate) : null;
        const d = resolveEntryDefaults({
          item: { billRate: Number(item.bill_rate), payRate: Number(item.pay_rate) },
          override: { billRate: overrideBillRate, payRate: overridePayRate },
          driver: driverSrc,
          company,
        });
        out.push({
          driverId: driver.id,
          driverName: driver.name,
          projectId: project.id,
          projectName: project.name,
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          billRate: d.billRate,
          payRate: d.payRate,
          margin: fromS4(toS4(d.billRate) - toS4(d.payRate)),
          billRateSource: d.billRateSource,
          payRateSource: d.payRateSource,
          overrideBillRate,
          overridePayRate,
        });
      }
    }
  }
  return out;
}

export function rateToCsvRow(r: RateRow): CsvValue[] {
  return [
    r.driverName,
    r.projectName,
    r.itemName,
    UNIT_LABELS[r.unit],
    rawNumber(r.billRate),
    rawNumber(r.payRate),
    rawNumber(r.margin),
    RATE_SOURCE_LABELS[r.billRateSource],
    RATE_SOURCE_LABELS[r.payRateSource],
    r.overrideBillRate == null ? "" : rawNumber(r.overrideBillRate),
    r.overridePayRate == null ? "" : rawNumber(r.overridePayRate),
  ];
}

/** 単価表 CSV の行（ヘッダー行を含む） */
export function ratesToCsvRows(masters: Masters): CsvValue[][] {
  return [[...RATES_CSV_HEADERS], ...rateRows(masters).map(rateToCsvRow)];
}

/** 単価表 CSV 文字列（UTF-8 BOM・CRLF） */
export function ratesToCsv(masters: Masters): string {
  return toCsv(ratesToCsvRows(masters));
}

/** ファイル名：単価表_YYYYMMDD.csv（日本時間） */
export function ratesCsvFilename(now: Date = new Date()): string {
  return `単価表_${timestampJST(now).slice(0, 8)}.csv`;
}
