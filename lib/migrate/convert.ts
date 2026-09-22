/**
 * 試作アプリ（Claude 上の「ROOTIVE 利益管理」）のバックアップ JSON → 本システムのバックアップ JSON への変換（§8.5）
 * ID は uuid v5（固定名前空間 ＋ 試作の ID）で決定的に生成するため、同じファイルを何度取り込んでも重複しない。
 */
import { v5 as uuidv5, validate as isUuid } from "uuid";
import { z } from "zod";
import { calcCompanyMonth, calcDriverMonth, sumMoney, type AdjustmentInput, type EntryInput, type RoundingMode } from "@/lib/calc";
import { isMonthKey, monthToDate, dateToMonth } from "@/lib/month";
import type {
  BackupAdjustment,
  BackupDriver,
  BackupDriverMonth,
  BackupJson,
  BackupMonthClosing,
  BackupPayOverride,
  BackupProject,
  BackupProjectItem,
  BackupWorkEntry,
  MigratePreview,
  MigratePreviewMonth,
  PassthroughBackupTable,
  SourceFormat,
} from "./types";
import { PASSTHROUGH_BACKUP_TABLES } from "./types";

/** 固定名前空間（変更しないこと。変えると既存の取り込み済み ID と一致しなくなる） */
export const MIGRATION_NAMESPACE = "6f1c2a3e-7b4d-5e8f-9a0b-1c2d3e4f5a6b";

export function deterministicId(kind: string, key: string): string {
  return uuidv5(`${kind}:${key}`, MIGRATION_NAMESPACE);
}

const ROUNDING = ["none", "floor", "round", "ceil"] as const;

const num = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite());
const optNum = num.optional().nullable();
const str = z.preprocess((v) => (v == null ? "" : String(v)), z.string());

const prototypeSchema = z.object({
  version: z.unknown().optional(),
  exportedAt: z.string().optional(),
  data: z.object({
    settings: z
      .object({
        app: z
          .object({
            companyName: str.optional(),
            rounding: z.enum(ROUNDING).optional().nullable(),
            defRoyalty: optNum,
            defMgmt: optNum,
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    drivers: z.record(z.string(), z.object({
      id: z.string().optional(),
      name: str,
      active: z.boolean().optional(),
      royaltyRate: optNum,
      mgmtFee: optNum,
      rateOverrides: z.record(z.string(), num).optional().nullable(),
      memo: str.optional(),
      order: optNum,
    }).passthrough()).default({}),
    projects: z.record(z.string(), z.object({
      id: z.string().optional(),
      name: str,
      client: str.optional(),
      active: z.boolean().optional(),
      memo: str.optional(),
      order: optNum,
      items: z.array(z.object({
        id: z.string(),
        name: str.optional(),
        unit: z.enum(["day", "piece"]).optional(),
        billRate: optNum,
        payRate: optNum,
        active: z.boolean().optional(),
      }).passthrough()).default([]),
    }).passthrough()).default({}),
    entries: z.record(z.string(), z.object({
      id: z.string().optional(),
      month: z.string(),
      driverId: z.string(),
      driverName: str.optional(),
      projectId: z.string(),
      projectName: str.optional(),
      itemId: z.string(),
      itemName: str.optional(),
      unit: z.enum(["day", "piece"]).optional(),
      qty: optNum,
      billRate: optNum,
      payRate: optNum,
      royaltyRate: optNum,
      memo: str.optional(),
    }).passthrough()).default({}),
    driverMonths: z.record(z.string(), z.object({
      month: z.string(),
      driverId: z.string(),
      mgmtFee: optNum,
      memo: str.optional(),
      adjustments: z.array(z.object({
        label: str,
        amount: num,
        toProfit: z.boolean().optional(),
      }).passthrough()).optional().nullable(),
    }).passthrough()).default({}),
    months: z.record(z.string(), z.object({
      status: z.enum(["open", "closed"]).optional(),
      closedAt: z.string().optional().nullable(),
    }).passthrough()).default({}),
  }),
});

export type PrototypeJson = z.infer<typeof prototypeSchema>;

/** 形式判定 */
export function detectFormat(json: unknown): SourceFormat {
  if (!json || typeof json !== "object") return "unknown";
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.drivers) && Array.isArray(o.work_entries) && (o.app === "rootive-profit" || "project_items" in o)) return "backup";
  const data = o.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object" && ("drivers" in data || "entries" in data || "projects" in data)) return "prototype";
  return "unknown";
}

function uniqueName(name: string, used: Set<string>, warnings: string[], kind: string): string {
  let n = name.trim() || `（名称未設定）`;
  if (!used.has(n)) {
    used.add(n);
    return n;
  }
  let i = 2;
  while (used.has(`${n}（${i}）`)) i++;
  const renamed = `${n}（${i}）`;
  warnings.push(`${kind}名「${n}」が重複しているため「${renamed}」に変更しました`);
  used.add(renamed);
  n = renamed;
  return n;
}

/** 試作アプリ JSON → BackupJson */
export function convertPrototype(json: unknown, companyId: string): { backup: BackupJson; warnings: string[] } {
  const parsed = prototypeSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`試作アプリ JSON の形式が不正です（${issue?.path.join(".")}: ${issue?.message}）`);
  }
  const d = parsed.data.data;
  const warnings: string[] = [];
  const app = d.settings?.app ?? {};
  const companyRounding: RoundingMode = (app.rounding ?? "none") as RoundingMode;
  const now = new Date().toISOString();

  // ---- ドライバー ----
  const driverIdMap = new Map<string, string>(); // 試作 ID → uuid
  const driverProtoById = new Map<string, string>(); // uuid → 試作 ID（driver_months の決定的 ID 用）
  const usedDriverNames = new Set<string>();
  const drivers: BackupDriver[] = [];
  const driverEntries = Object.entries(d.drivers).sort((a, b) => Number(a[1].order ?? 0) - Number(b[1].order ?? 0));
  driverEntries.forEach(([key, dr], idx) => {
    const protoId = dr.id ?? key;
    const id = deterministicId("driver", protoId);
    driverIdMap.set(protoId, id);
    driverProtoById.set(id, protoId);
    if (dr.id && dr.id !== key) driverIdMap.set(key, id);
    drivers.push({
      id,
      company_id: companyId,
      name: uniqueName(dr.name, usedDriverNames, warnings, "ドライバー"),
      kana: "",
      is_active: dr.active ?? true,
      royalty_rate: dr.royaltyRate ?? null,
      // 試作側で未設定なら試作の標準管理費（defMgmt）を採用
      mgmt_fee: dr.mgmtFee ?? app.defMgmt ?? 0,
      rounding_mode: null,
      phone: "",
      email: "",
      bank_info: "",
      memo: dr.memo ?? "",
      sort_order: dr.order != null ? Number(dr.order) : idx + 1,
      tax_mode: "taxable",
      invoice_reg_no: "",
      payout_month_offset: null,
      payout_day: null,
      // 振込先口座は 0020 で driver_bank_accounts へ移った（試作データには無いので作らない）
      line_user_id: "",
      line_linked_at: null,
      weekly_off: [],
    });
  });

  // ---- 案件・内容 ----
  const projectIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>(); // `${projectProtoId}|${itemProtoId}` → uuid
  const usedProjectNames = new Set<string>();
  const projects: BackupProject[] = [];
  const projectItems: BackupProjectItem[] = [];
  const projectEntries = Object.entries(d.projects).sort((a, b) => Number(a[1].order ?? 0) - Number(b[1].order ?? 0));
  projectEntries.forEach(([key, p], idx) => {
    const protoId = p.id ?? key;
    const id = deterministicId("project", protoId);
    projectIdMap.set(protoId, id);
    if (p.id && p.id !== key) projectIdMap.set(key, id);
    projects.push({
      id,
      company_id: companyId,
      name: uniqueName(p.name, usedProjectNames, warnings, "案件"),
      client_name: p.client ?? "",
      client_id: null,
      target_margin: null,
      is_active: p.active ?? true,
      memo: p.memo ?? "",
      sort_order: p.order != null ? Number(p.order) : idx + 1,
    });
    const usedItemNames = new Set<string>();
    p.items.forEach((it, i) => {
      const itemId = deterministicId("item", `${protoId}|${it.id}`);
      itemIdMap.set(`${protoId}|${it.id}`, itemId);
      projectItems.push({
        id: itemId,
        company_id: companyId,
        project_id: id,
        name: uniqueName(it.name?.trim() || "標準", usedItemNames, warnings, "内容"),
        unit: it.unit ?? "day",
        bill_rate: it.billRate ?? 0,
        pay_rate: it.payRate ?? 0,
        is_active: it.active ?? true,
        sort_order: i + 1,
      });
    });
  });

  // ---- 個別単価 ----
  const overrides: BackupPayOverride[] = [];
  for (const [key, dr] of driverEntries) {
    const driverId = driverIdMap.get(dr.id ?? key)!;
    for (const [ref, rate] of Object.entries(dr.rateOverrides ?? {})) {
      const [projectProtoId, itemProtoId] = ref.split("|");
      const itemId = itemIdMap.get(`${projectProtoId}|${itemProtoId}`);
      if (!itemId) {
        warnings.push(`ドライバー「${dr.name}」の個別単価の参照先（${ref}）が見つからないため無視しました`);
        continue;
      }
      overrides.push({ company_id: companyId, driver_id: driverId, project_item_id: itemId, pay_rate: rate, bill_rate: null });
    }
  }

  // ---- 稼働行（参照切れは名前から補完） ----
  const ensureDriver = (protoId: string, name: string | undefined): string => {
    const existing = driverIdMap.get(protoId);
    if (existing) return existing;
    const id = deterministicId("driver", protoId);
    driverIdMap.set(protoId, id);
    driverProtoById.set(id, protoId);
    const nm = uniqueName(name?.trim() || `不明なドライバー ${protoId.slice(0, 6)}`, usedDriverNames, warnings, "ドライバー");
    drivers.push({ id, company_id: companyId, name: nm, kana: "", is_active: false, royalty_rate: null, mgmt_fee: 0, rounding_mode: null, phone: "", email: "", bank_info: "", memo: "試作データの参照切れから自動作成", sort_order: 999, tax_mode: "taxable", invoice_reg_no: "", payout_month_offset: null, payout_day: null, line_user_id: "", line_linked_at: null, weekly_off: [] });
    warnings.push(`稼働行が参照するドライバー（${protoId}）がマスタに無いため「${nm}」を停止中として作成しました`);
    return id;
  };
  const ensureItem = (projectProtoId: string, itemProtoId: string, projectName: string | undefined, itemName: string | undefined, unit: "day" | "piece" | undefined, billRate: number, payRate: number): string => {
    const k = `${projectProtoId}|${itemProtoId}`;
    const existing = itemIdMap.get(k);
    if (existing) return existing;
    let projectId = projectIdMap.get(projectProtoId);
    if (!projectId) {
      projectId = deterministicId("project", projectProtoId);
      projectIdMap.set(projectProtoId, projectId);
      const nm = uniqueName(projectName?.trim() || `不明な案件 ${projectProtoId.slice(0, 6)}`, usedProjectNames, warnings, "案件");
      projects.push({ id: projectId, company_id: companyId, name: nm, client_name: "", client_id: null, target_margin: null, is_active: false, memo: "試作データの参照切れから自動作成", sort_order: 999 });
      warnings.push(`稼働行が参照する案件（${projectProtoId}）がマスタに無いため「${nm}」を停止中として作成しました`);
    }
    const itemId = deterministicId("item", k);
    itemIdMap.set(k, itemId);
    const siblings = projectItems.filter((i) => i.project_id === projectId).map((i) => i.name);
    const used = new Set(siblings);
    const nm = uniqueName(itemName?.trim() || "標準", used, warnings, "内容");
    projectItems.push({ id: itemId, company_id: companyId, project_id: projectId, name: nm, unit: unit ?? "day", bill_rate: billRate, pay_rate: payRate, is_active: false, sort_order: siblings.length + 1 });
    warnings.push(`稼働行が参照する内容（${k}）がマスタに無いため「${nm}」を停止中として作成しました`);
    return itemId;
  };

  const workEntries: BackupWorkEntry[] = [];
  const driverMonthKeys = new Map<string, { month: string; driverId: string }>(); // `${YYYY-MM}_${driverUuid}`
  const entryList = Object.entries(d.entries);
  let skipped = 0;
  for (const [key, e] of entryList) {
    if (!isMonthKey(e.month)) {
      warnings.push(`稼働行（${key}）の稼動月「${e.month}」が不正なためスキップしました`);
      skipped++;
      continue;
    }
    const driverId = ensureDriver(e.driverId, e.driverName);
    const itemId = ensureItem(e.projectId, e.itemId, e.projectName, e.itemName, e.unit, e.billRate ?? 0, e.payRate ?? 0);
    const protoId = e.id ?? key;
    // 率のスナップショットが無い場合は §2.5 の優先順（ドライバー設定 → 会社既定）で補完
    const driverRate = drivers.find((x) => x.id === driverId)?.royalty_rate;
    const rate = e.royaltyRate ?? driverRate ?? app.defRoyalty ?? 0.1;
    workEntries.push({
      id: deterministicId("entry", protoId),
      company_id: companyId,
      month: monthToDate(e.month),
      driver_id: driverId,
      project_item_id: itemId,
      qty: e.qty ?? 0,
      bill_rate: e.billRate ?? 0,
      pay_rate: e.payRate ?? 0,
      royalty_rate: Math.min(1, Math.max(0, rate)),
      rounding_mode: companyRounding,
      memo: e.memo ?? "",
      qty_source: "manual",
    });
    driverMonthKeys.set(`${e.month}_${driverId}`, { month: e.month, driverId });
  }
  if (skipped) warnings.push(`${skipped} 件の稼働行をスキップしました`);

  // ---- ドライバー × 月 ＋ 調整 ----
  const driverMonths: BackupDriverMonth[] = [];
  const adjustments: BackupAdjustment[] = [];
  const dmSeen = new Set<string>();
  for (const [key, dm] of Object.entries(d.driverMonths)) {
    if (!isMonthKey(dm.month)) {
      warnings.push(`ドライバー月（${key}）の稼動月「${dm.month}」が不正なためスキップしました`);
      continue;
    }
    const driverId = ensureDriver(dm.driverId, undefined);
    const dmKey = `${dm.month}_${driverId}`;
    if (dmSeen.has(dmKey)) continue;
    dmSeen.add(dmKey);
    const id = deterministicId("driver_month", `${dm.month}_${dm.driverId}`);
    const dmDriver = drivers.find((x) => x.id === driverId);
    driverMonths.push({ id, company_id: companyId, month: monthToDate(dm.month), driver_id: driverId, mgmt_fee: dm.mgmtFee ?? dmDriver?.mgmt_fee ?? app.defMgmt ?? 0, memo: dm.memo ?? "", tax_rate: null, tax_rounding: null, tax_mode: null });
    (dm.adjustments ?? []).forEach((a, i) => {
      adjustments.push({
        id: deterministicId("adjustment", `${dm.month}_${dm.driverId}:${i}`),
        company_id: companyId,
        driver_month_id: id,
        label: a.label.trim() || "調整",
        amount: a.amount,
        count_as_profit: a.toProfit ?? true,
        recurring_id: null,
        sort_order: i + 1,
      });
    });
    driverMonthKeys.delete(dmKey);
  }
  // 稼働行だけがある（driverMonths が無い）組み合わせ → ドライバー標準の管理費で作成（DB トリガーと同じ挙動）
  for (const [dmKey, { month, driverId }] of driverMonthKeys) {
    if (dmSeen.has(dmKey)) continue;
    dmSeen.add(dmKey);
    const driver = drivers.find((x) => x.id === driverId);
    // driverMonths に項目がある場合と同じ鍵（月_試作ドライバーID）で ID を作り、後から driverMonths が増えても衝突しない
    const protoDriverId = driverProtoById.get(driverId) ?? driverId;
    driverMonths.push({
      id: deterministicId("driver_month", `${month}_${protoDriverId}`),
      company_id: companyId,
      month: monthToDate(month),
      driver_id: driverId,
      mgmt_fee: driver?.mgmt_fee ?? 0,
      memo: "",
      tax_rate: null,
      tax_rounding: null,
      tax_mode: null,
    });
  }

  // ---- 月締め ----
  const monthClosings: BackupMonthClosing[] = [];
  for (const [m, info] of Object.entries(d.months)) {
    if (!isMonthKey(m)) continue;
    monthClosings.push({
      company_id: companyId,
      month: monthToDate(m),
      status: info.status ?? "open",
      closed_at: info.status === "closed" ? (info.closedAt ?? now) : null,
      closed_by: null,
      reopened_at: null,
      reopened_by: null,
      backup_path: null,
      note: "",
    });
  }

  const backup: BackupJson = {
    version: 1,
    app: "rootive-profit",
    exported_at: now,
    company: {
      ...(app.companyName?.trim() ? { name: app.companyName.trim() } : {}),
      rounding_mode: companyRounding,
      ...(app.defRoyalty != null ? { default_royalty_rate: app.defRoyalty } : {}),
      ...(app.defMgmt != null ? { default_mgmt_fee: app.defMgmt } : {}),
    },
    drivers,
    projects,
    project_items: projectItems,
    driver_pay_overrides: overrides,
    driver_recurring_adjustments: [],
    work_entries: workEntries,
    driver_months: driverMonths,
    adjustments,
    month_closings: monthClosings,
  };
  return { backup, warnings };
}

const backupSchema = z.object({
  version: z.number().optional(),
  app: z.string().optional(),
  exported_at: z.string().optional(),
  company: z.record(z.string(), z.unknown()).nullable().optional(),
  drivers: z.array(z.record(z.string(), z.unknown())).default([]),
  projects: z.array(z.record(z.string(), z.unknown())).default([]),
  project_items: z.array(z.record(z.string(), z.unknown())).default([]),
  driver_pay_overrides: z.array(z.record(z.string(), z.unknown())).default([]),
  driver_recurring_adjustments: z.array(z.record(z.string(), z.unknown())).default([]),
  work_entries: z.array(z.record(z.string(), z.unknown())).default([]),
  driver_months: z.array(z.record(z.string(), z.unknown())).default([]),
  adjustments: z.array(z.record(z.string(), z.unknown())).default([]),
  month_closings: z.array(z.record(z.string(), z.unknown())).default([]),
  // 0009 で追加（古いバックアップには無い）
  clients: z.array(z.record(z.string(), z.unknown())).default([]),
  expense_categories: z.array(z.record(z.string(), z.unknown())).default([]),
  recurring_expenses: z.array(z.record(z.string(), z.unknown())).default([]),
  expenses: z.array(z.record(z.string(), z.unknown())).default([]),
  invoices: z.array(z.record(z.string(), z.unknown())).default([]),
  invoice_items: z.array(z.record(z.string(), z.unknown())).default([]),
  month_targets: z.array(z.record(z.string(), z.unknown())).default([]),
  // 0010 以降に増えたテーブル（アプリは中身を読まず、そのまま DB の import_backup に渡す）
  ...Object.fromEntries(PASSTHROUGH_BACKUP_TABLES.map((t) => [t, z.array(z.record(z.string(), z.unknown())).optional()])),
});

/** 本システムのバックアップ JSON を検証して正規化する */
export function normalizeBackup(json: unknown): BackupJson {
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`バックアップ JSON の形式が不正です（${issue?.path.join(".")}: ${issue?.message}）`);
  }
  const b = parsed.data;
  const requireId = (rows: Record<string, unknown>[], table: string) => {
    for (const r of rows) {
      if (typeof r.id !== "string" || !isUuid(r.id)) throw new Error(`${table} に不正な ID があります`);
    }
  };
  requireId(b.drivers, "drivers");
  requireId(b.projects, "projects");
  requireId(b.project_items, "project_items");
  requireId(b.work_entries, "work_entries");
  requireId(b.driver_months, "driver_months");
  requireId(b.adjustments, "adjustments");
  requireId(b.clients, "clients");
  requireId(b.expense_categories, "expense_categories");
  requireId(b.recurring_expenses, "recurring_expenses");
  requireId(b.expenses, "expenses");
  requireId(b.invoices, "invoices");
  requireId(b.invoice_items, "invoice_items");
  return {
    version: typeof b.version === "number" && b.version >= 1 ? b.version : 1,
    app: b.app ?? "rootive-profit",
    exported_at: b.exported_at ?? new Date().toISOString(),
    company: (b.company ?? null) as BackupJson["company"],
    drivers: b.drivers as unknown as BackupDriver[],
    projects: b.projects as unknown as BackupProject[],
    project_items: b.project_items as unknown as BackupProjectItem[],
    driver_pay_overrides: b.driver_pay_overrides as unknown as BackupPayOverride[],
    driver_recurring_adjustments: b.driver_recurring_adjustments as unknown as BackupJson["driver_recurring_adjustments"],
    work_entries: b.work_entries as unknown as BackupWorkEntry[],
    driver_months: b.driver_months as unknown as BackupDriverMonth[],
    adjustments: b.adjustments as unknown as BackupAdjustment[],
    month_closings: b.month_closings as unknown as BackupMonthClosing[],
    clients: b.clients as unknown as BackupJson["clients"],
    expense_categories: b.expense_categories as unknown as BackupJson["expense_categories"],
    recurring_expenses: b.recurring_expenses as unknown as BackupJson["recurring_expenses"],
    expenses: b.expenses as unknown as BackupJson["expenses"],
    invoices: b.invoices as unknown as BackupJson["invoices"],
    invoice_items: b.invoice_items as unknown as BackupJson["invoice_items"],
    month_targets: b.month_targets as unknown as BackupJson["month_targets"],
    // 0010 以降のテーブルはそのまま持ち越す（ここで落とすと復元で消える）
    ...passthroughTables(b as Record<string, unknown>),
  };
}

/** 0010 以降のテーブルを、配列のときだけ持ち越す */
function passthroughTables(raw: Record<string, unknown>): Partial<Record<PassthroughBackupTable, Record<string, unknown>[]>> {
  const out: Partial<Record<PassthroughBackupTable, Record<string, unknown>[]>> = {};
  for (const table of PASSTHROUGH_BACKUP_TABLES) {
    const rows = raw[table];
    if (Array.isArray(rows)) out[table] = rows as Record<string, unknown>[];
  }
  return out;
}

/** 件数と月別集計（lib/calc で計算。DB のビューと同じ結果になる） */
export function previewBackup(backup: BackupJson, format: "prototype" | "backup" = "backup", warnings: string[] = []): MigratePreview {
  const dmById = new Map(backup.driver_months.map((dm) => [dm.id, dm]));
  const adjByDm = new Map<string, AdjustmentInput[]>();
  for (const a of backup.adjustments) {
    const list = adjByDm.get(a.driver_month_id) ?? [];
    list.push({ amount: Number(a.amount), countAsProfit: Boolean(a.count_as_profit) });
    adjByDm.set(a.driver_month_id, list);
  }
  // (month, driver) → entries
  const groups = new Map<string, { month: string; driverId: string; entries: EntryInput[] }>();
  for (const e of backup.work_entries) {
    const month = dateToMonth(String(e.month));
    const k = `${month}_${e.driver_id}`;
    const g = groups.get(k) ?? { month, driverId: e.driver_id, entries: [] };
    g.entries.push({
      qty: Number(e.qty ?? 0),
      billRate: Number(e.bill_rate ?? 0),
      payRate: Number(e.pay_rate ?? 0),
      royaltyRate: Number(e.royalty_rate ?? 0),
      roundingMode: (e.rounding_mode ?? "none") as RoundingMode,
    });
    groups.set(k, g);
  }
  for (const dm of backup.driver_months) {
    const month = dateToMonth(String(dm.month));
    const k = `${month}_${dm.driver_id}`;
    if (!groups.has(k)) groups.set(k, { month, driverId: dm.driver_id, entries: [] });
  }
  const dmByKey = new Map<string, BackupDriverMonth>();
  for (const dm of backup.driver_months) dmByKey.set(`${dateToMonth(String(dm.month))}_${dm.driver_id}`, dm);

  const byMonth = new Map<string, ReturnType<typeof calcDriverMonth>[]>();
  for (const [k, g] of groups) {
    const dm = dmByKey.get(k);
    const calc = calcDriverMonth({
      entries: g.entries,
      mgmtFee: dm ? Number(dm.mgmt_fee ?? 0) : 0,
      adjustments: dm ? (adjByDm.get(dm.id) ?? []) : [],
    });
    const list = byMonth.get(g.month) ?? [];
    list.push(calc);
    byMonth.set(g.month, list);
  }
  void dmById;
  const closedMonths = new Map(backup.month_closings.map((m) => [dateToMonth(String(m.month)), m.status]));
  const months: MigratePreviewMonth[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, list]) => {
      const c = calcCompanyMonth(list);
      return {
        month,
        entryCount: c.entryCount,
        driverCount: list.filter((x) => x.entryCount > 0).length,
        bill: c.bill,
        profit: c.profit,
        payout: c.payout,
        status: closedMonths.get(month) === "closed" ? "closed" : "open",
      };
    });
  for (const [m, status] of closedMonths) {
    if (!byMonth.has(m)) months.push({ month: m, entryCount: 0, driverCount: 0, bill: 0, profit: 0, payout: 0, status: status === "closed" ? "closed" : "open" });
  }
  months.sort((a, b) => (a.month < b.month ? -1 : 1));
  return {
    format,
    counts: {
      drivers: backup.drivers.length,
      projects: backup.projects.length,
      project_items: backup.project_items.length,
      driver_pay_overrides: backup.driver_pay_overrides.length,
      driver_recurring_adjustments: backup.driver_recurring_adjustments.length,
      work_entries: backup.work_entries.length,
      driver_months: backup.driver_months.length,
      adjustments: backup.adjustments.length,
      month_closings: backup.month_closings.length,
      clients: backup.clients?.length ?? 0,
      expense_categories: backup.expense_categories?.length ?? 0,
      recurring_expenses: backup.recurring_expenses?.length ?? 0,
      expenses: backup.expenses?.length ?? 0,
      invoices: backup.invoices?.length ?? 0,
      invoice_items: backup.invoice_items?.length ?? 0,
      month_targets: backup.month_targets?.length ?? 0,
      ...Object.fromEntries(PASSTHROUGH_BACKUP_TABLES.map((t) => [t, backup[t]?.length ?? 0])),
    },
    months,
    totals: {
      bill: sumMoney(months.map((m) => m.bill)),
      profit: sumMoney(months.map((m) => m.profit)),
      payout: sumMoney(months.map((m) => m.payout)),
    },
    warnings,
    companyName: (backup.company?.name as string | undefined) ?? null,
  };
}

/** 判定 → 変換 → プレビュー をまとめて行う */
export function buildPreview(json: unknown, companyId: string): { backup: BackupJson; preview: MigratePreview } {
  const format = detectFormat(json);
  if (format === "prototype") {
    const { backup, warnings } = convertPrototype(json, companyId);
    return { backup, preview: previewBackup(backup, "prototype", warnings) };
  }
  if (format === "backup") {
    const backup = normalizeBackup(json);
    const warnings: string[] = [];
    const srcCompany = backup.drivers[0]?.company_id;
    if (srcCompany && srcCompany !== companyId) warnings.push("別の会社 ID で出力されたバックアップです。取り込み時は現在の会社に紐づけ直されます");
    return { backup, preview: previewBackup(backup, "backup", warnings) };
  }
  throw new Error("JSON の形式を判定できません（試作アプリのバックアップ、または本システムのバックアップ JSON を指定してください）");
}
