/**
 * 監査ログの差分・要約（純関数。Server Component からも使える）
 * - UPDATE: before/after で異なるキーのみ「キー: 旧 → 新」
 * - INSERT: after の主要項目、DELETE: before の主要項目
 * - RPC（close_month / import_backup / reset_company_data）: 集計・件数
 */
import type { Json } from "@/lib/db/database.types";
import type { AuditLog } from "@/lib/db/types";
import { formatDateTimeJa, pct, qty, yen } from "@/lib/format";
import { formatMonthJa, isMonthKey } from "@/lib/month";
import { HIDDEN_KEYS, MAIN_KEYS, MONEY_KEYS, QTY_KEYS, RATE_KEYS, ROLE_LABELS, ROUNDING_LABELS, STATUS_LABELS, UNIT_LABELS, USER_KEYS, keyLabel, tableLabel } from "./labels";

export interface AuditNameMaps {
  /** driver_id → 名前 */
  drivers: Map<string, string>;
  /** project_id → 案件名 */
  projects: Map<string, string>;
  /** project_item_id → 「案件 / 内容」 */
  items: Map<string, string>;
  /** profiles.id → 表示名またはメール */
  profiles: Map<string, string>;
}

export function emptyNameMaps(): AuditNameMaps {
  return { drivers: new Map(), projects: new Map(), items: new Map(), profiles: new Map() };
}

export interface ChangeLine {
  key: string;
  label: string;
  before?: string;
  after?: string;
}

type JsonObject = { [key: string]: Json | undefined };

export function asObject(v: Json | null | undefined): JsonObject | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null;
}

export function shortId(v: unknown): string {
  const s = String(v ?? "");
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

function monthText(v: string): string {
  const m = v.slice(0, 7);
  return isMonthKey(m) ? formatMonthJa(m) : v;
}

/** 値を日本語表示に整形する（列名から金額・率・数量・日時・参照名を判断） */
export function formatAuditValue(key: string, value: Json | undefined, names: AuditNameMaps): string {
  if (value === null || value === undefined || value === "") return "（なし）";
  if (key === "is_active") return value ? "有効" : "停止中";
  if (key === "count_as_profit") return value ? "利益に計上" : "計上しない";
  if (key === "driver_portal_show_royalty") return value ? "表示" : "非表示";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (key === "month" && typeof value === "string") return monthText(value);
  if (key.endsWith("_at") && typeof value === "string") return formatDateTimeJa(value);
  if (MONEY_KEYS.has(key) && (typeof value === "number" || typeof value === "string")) return yen(Number(value));
  if (RATE_KEYS.has(key) && (typeof value === "number" || typeof value === "string")) return pct(Number(value));
  if (QTY_KEYS.has(key) && (typeof value === "number" || typeof value === "string")) return qty(Number(value));
  if (key === "driver_id") return names.drivers.get(String(value)) ?? shortId(value);
  if (key === "project_id") return names.projects.get(String(value)) ?? shortId(value);
  if (key === "project_item_id") return names.items.get(String(value)) ?? shortId(value);
  if (USER_KEYS.has(key)) return names.profiles.get(String(value)) ?? shortId(value);
  if (key === "driver_month_id" || key === "recurring_id") return shortId(value);
  if (key === "rounding_mode") return typeof value === "string" ? (ROUNDING_LABELS[value] ?? value) : String(value);
  if (key === "unit") return typeof value === "string" ? (UNIT_LABELS[value] ?? value) : String(value);
  if (key === "status") return typeof value === "string" ? (STATUS_LABELS[value] ?? value) : String(value);
  if (key === "role") return typeof value === "string" ? (ROLE_LABELS[value as keyof typeof ROLE_LABELS] ?? value) : String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** INSERT／DELETE の要約：主要項目（テーブル別）。無ければ先頭の数項目 */
function summaryLines(table: string, obj: JsonObject, side: "before" | "after", names: AuditNameMaps): ChangeLine[] {
  const main = (MAIN_KEYS[table] ?? []).filter((k) => k in obj);
  const keys = main.length > 0 ? main : Object.keys(obj).filter((k) => !HIDDEN_KEYS.has(k)).slice(0, 6);
  return keys.map((k) => ({ key: k, label: keyLabel(k), [side]: formatAuditValue(k, obj[k], names) }));
}

/** RPC の件数（{ drivers: 10, ... }）→ 「ドライバー: 10 件」 */
function countLines(obj: JsonObject, side: "before" | "after"): ChangeLine[] {
  return Object.entries(obj)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => ({ key: k, label: tableLabel(k), [side]: `${v} 件` }));
}

const CLOSE_SUMMARY_KEYS = ["entry_count", "driver_count", "bill", "profit", "payout"];

/** 1 行の監査ログを「キー: 旧 → 新」の並びに要約する */
export function describeChanges(row: Pick<AuditLog, "action" | "table_name" | "before" | "after">, names: AuditNameMaps): ChangeLine[] {
  const before = asObject(row.before);
  const after = asObject(row.after);
  switch (row.action) {
    case "UPDATE": {
      if (!before || !after) return [];
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN_KEYS.has(k));
      return keys
        .filter((k) => !sameJson(before[k], after[k]))
        .map((k) => ({ key: k, label: keyLabel(k), before: formatAuditValue(k, before[k], names), after: formatAuditValue(k, after[k], names) }));
    }
    case "INSERT":
      return after ? summaryLines(row.table_name, after, "after", names) : [];
    case "DELETE":
      return before ? summaryLines(row.table_name, before, "before", names) : [];
    case "close_month": {
      const summary = asObject(after?.summary ?? null);
      const lines: ChangeLine[] = summary
        ? CLOSE_SUMMARY_KEYS.filter((k) => k in summary).map((k) => ({ key: k, label: keyLabel(k), after: formatAuditValue(k, summary[k], names) }))
        : [];
      const note = after?.note;
      if (typeof note === "string" && note.trim()) lines.push({ key: "note", label: keyLabel("note"), after: note });
      return lines;
    }
    case "import_backup":
      return after ? countLines(after, "after") : [];
    case "reset_company_data":
      return before ? countLines(before, "before") : [];
    default:
      if (after) return summaryLines(row.table_name, after, "after", names);
      if (before) return summaryLines(row.table_name, before, "before", names);
      return [];
  }
}

/** 対象（record_id）を人が読める形にする */
export function describeTarget(row: Pick<AuditLog, "table_name" | "record_id" | "before" | "after">, names: AuditNameMaps): string {
  const obj = asObject(row.after) ?? asObject(row.before);
  const rid = row.record_id ?? "";
  switch (row.table_name) {
    case "month_closings":
      return rid ? monthText(rid) : "—";
    case "company":
    case "companies":
      return typeof obj?.name === "string" ? obj.name : "会社全体";
    case "driver_pay_overrides": {
      const [driverId, itemId] = rid.split(":");
      const d = names.drivers.get(driverId ?? "") ?? shortId(driverId);
      const i = names.items.get(itemId ?? "") ?? shortId(itemId);
      return `${d} / ${i}`;
    }
    case "drivers":
      return names.drivers.get(rid) ?? (typeof obj?.name === "string" ? obj.name : shortId(rid));
    case "projects":
      return names.projects.get(rid) ?? (typeof obj?.name === "string" ? obj.name : shortId(rid));
    case "project_items":
      return names.items.get(rid) ?? (typeof obj?.name === "string" ? obj.name : shortId(rid));
    case "profiles":
    case "invitations":
      return typeof obj?.email === "string" ? obj.email : shortId(rid);
    case "work_entries":
    case "driver_months": {
      if (!obj) return shortId(rid);
      const parts = [
        typeof obj.month === "string" ? monthText(obj.month) : null,
        typeof obj.driver_id === "string" ? (names.drivers.get(obj.driver_id) ?? shortId(obj.driver_id)) : null,
        typeof obj.project_item_id === "string" ? (names.items.get(obj.project_item_id) ?? shortId(obj.project_item_id)) : null,
      ].filter((p): p is string => Boolean(p));
      return parts.length > 0 ? parts.join(" / ") : shortId(rid);
    }
    case "adjustments":
    case "driver_recurring_adjustments": {
      if (!obj) return shortId(rid);
      const label = typeof obj.label === "string" ? obj.label : null;
      const driver = typeof obj.driver_id === "string" ? (names.drivers.get(obj.driver_id) ?? null) : null;
      return [driver, label].filter((p): p is string => Boolean(p)).join(" / ") || shortId(rid);
    }
    default:
      return typeof obj?.name === "string" ? obj.name : rid ? shortId(rid) : "—";
  }
}

/** 全 JSON の折りたたみ表示用 */
export function prettyJson(v: Json | null | undefined): string {
  if (v === null || v === undefined) return "（なし）";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
