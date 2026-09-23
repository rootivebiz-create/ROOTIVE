import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { monthLabelJa } from "~/server/month";
import { isMonthClosed } from "~/server/repo";
import { byKana } from "./resolve";

/**
 * 稼働と調整（/work）の DB の処理。取り込みの行も手入力の行も同じ work_entries に入る。
 * 締めた月は、ここで止め（わかりやすい説明）、DB の引き金でも止まる。
 */

export type WorkInput = { driverId: string; projectId: string; qty: number; workDate: string | null; note: string | null };
export type AdjustmentInput = { driverId: string; label: string; amount: number; taxable: boolean; agreedInWriting: boolean; basis: string | null };

export type EntryRow = {
  id: string;
  driverId: string;
  projectId: string;
  qty: number;
  workDate: string | null;
  note: string | null;
  importBatchId: string | null;
  /** 取り込みのファイル名か「手入力」 */
  source: string;
};

export type WorkLine = {
  projectId: string;
  projectName: string;
  unit: string;
  qty: number;
  entries: EntryRow[];
  sources: { label: string; batchId: string | null }[];
};

export type DriverWork = { driverId: string; name: string; code: string | null; active: boolean; lines: WorkLine[]; entryCount: number };

export type AdjustmentRow = typeof s.adjustments.$inferSelect & { driverName: string };

export type WorkMonth = {
  month: string;
  closed: boolean;
  drivers: { id: string; name: string; kana: string | null; code: string | null; active: boolean }[];
  projects: { id: string; name: string; unit: string; active: boolean }[];
  groups: DriverWork[];
  entryCount: number;
  importedCount: number;
  manualCount: number;
  byProject: { projectId: string; name: string; unit: string; qty: number }[];
  adjustments: AdjustmentRow[];
};

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadWorkMonth(db: Db, tenantId: string, month: string): Promise<WorkMonth> {
  const [drivers, projects, entries, adjustments, closed] = await Promise.all([
    db
      .select({ id: s.drivers.id, name: s.drivers.name, kana: s.drivers.kana, code: s.drivers.code, active: s.drivers.active })
      .from(s.drivers)
      .where(eq(s.drivers.tenantId, tenantId))
      .orderBy(asc(s.drivers.kana), asc(s.drivers.name)),
    db
      .select({ id: s.projects.id, name: s.projects.name, unit: s.projects.unit, active: s.projects.active })
      .from(s.projects)
      .where(eq(s.projects.tenantId, tenantId))
      .orderBy(asc(s.projects.name)),
    db
      .select()
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)))
      .orderBy(asc(s.workEntries.workDate), asc(s.workEntries.createdAt)),
    db
      .select()
      .from(s.adjustments)
      .where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, month)))
      .orderBy(asc(s.adjustments.createdAt)),
    isMonthClosed(db, tenantId, month),
  ]);
  const batchIds = [...new Set(entries.map((e) => e.importBatchId).filter((x): x is string => !!x))];
  const batches = batchIds.length
    ? await db
        .select({ id: s.importBatches.id, fileName: s.importBatches.fileName })
        .from(s.importBatches)
        .where(and(eq(s.importBatches.tenantId, tenantId), inArray(s.importBatches.id, batchIds)))
    : [];
  const fileName = new Map(batches.map((b) => [b.id, b.fileName]));
  const dInfo = new Map(drivers.map((d) => [d.id, d]));
  const pInfo = new Map(projects.map((p) => [p.id, p]));

  const groups = new Map<string, DriverWork>();
  const byProject = new Map<string, { projectId: string; name: string; unit: string; qty: number }>();
  for (const e of entries) {
    const d = dInfo.get(e.driverId);
    const p = pInfo.get(e.projectId);
    const g = groups.get(e.driverId) ?? {
      driverId: e.driverId,
      name: d?.name ?? "（台帳に無い人）",
      code: d?.code ?? null,
      active: d?.active ?? false,
      lines: [],
      entryCount: 0,
    };
    let line = g.lines.find((l) => l.projectId === e.projectId);
    if (!line) {
      line = { projectId: e.projectId, projectName: p?.name ?? "（台帳に無い案件）", unit: p?.unit ?? "", qty: 0, entries: [], sources: [] };
      g.lines.push(line);
    }
    const source = e.importBatchId ? (fileName.get(e.importBatchId) ?? "取り込み") : "手入力";
    line.qty = round4(line.qty + e.qty);
    line.entries.push({
      id: e.id,
      driverId: e.driverId,
      projectId: e.projectId,
      qty: e.qty,
      workDate: e.workDate,
      note: e.note,
      importBatchId: e.importBatchId,
      source,
    });
    if (!line.sources.some((x) => x.batchId === e.importBatchId)) line.sources.push({ label: source, batchId: e.importBatchId });
    g.entryCount++;
    groups.set(e.driverId, g);
    const t = byProject.get(e.projectId) ?? { projectId: e.projectId, name: p?.name ?? "", unit: p?.unit ?? "", qty: 0 };
    t.qty = round4(t.qty + e.qty);
    byProject.set(e.projectId, t);
  }
  for (const g of groups.values()) g.lines.sort((a, b) => a.projectName.localeCompare(b.projectName, "ja"));

  return {
    month,
    closed,
    drivers,
    projects,
    groups: [...groups.values()].sort((a, b) =>
      byKana({ name: a.name, kana: dInfo.get(a.driverId)?.kana }, { name: b.name, kana: dInfo.get(b.driverId)?.kana }),
    ),
    entryCount: entries.length,
    importedCount: entries.filter((e) => e.importBatchId).length,
    manualCount: entries.filter((e) => !e.importBatchId).length,
    byProject: [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    adjustments: adjustments.map((a) => ({ ...a, driverName: dInfo.get(a.driverId)?.name ?? "（台帳に無い人）" })),
  };
}

// ---------------------------------------------------------------- 確かめ

async function ensureOpen(db: Db, tenantId: string, month: string): Promise<void> {
  if (await isMonthClosed(db, tenantId, month)) {
    throw new UserError(`${monthLabelJa(month)}は締め済みです。直すときは、オーナーが「締め」の画面で締めを外してください`);
  }
}

async function ensureDriver(db: Db, tenantId: string, id: string): Promise<{ id: string; name: string }> {
  if (!UUID.test(id)) throw new UserError("ドライバーを選んでください");
  const rows = await db
    .select({ id: s.drivers.id, name: s.drivers.name })
    .from(s.drivers)
    .where(and(eq(s.drivers.id, id), eq(s.drivers.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new UserError("選んだドライバーが見つかりません。画面を読み直してください");
  return rows[0];
}

async function ensureProject(db: Db, tenantId: string, id: string): Promise<{ id: string; name: string }> {
  if (!UUID.test(id)) throw new UserError("案件を選んでください");
  const rows = await db
    .select({ id: s.projects.id, name: s.projects.name })
    .from(s.projects)
    .where(and(eq(s.projects.id, id), eq(s.projects.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new UserError("選んだ案件が見つかりません。画面を読み直してください");
  return rows[0];
}

async function getEntry(db: Db, tenantId: string, id: string) {
  if (!UUID.test(id)) throw new UserError("その稼働は見つかりません。画面を読み直してください");
  const rows = await db
    .select()
    .from(s.workEntries)
    .where(and(eq(s.workEntries.id, id), eq(s.workEntries.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new UserError("その稼働は見つかりません（もう消えたかもしれません）。画面を読み直してください");
  return rows[0];
}

async function getAdjustment(db: Db, tenantId: string, id: string) {
  if (!UUID.test(id)) throw new UserError("その調整は見つかりません。画面を読み直してください");
  const rows = await db
    .select()
    .from(s.adjustments)
    .where(and(eq(s.adjustments.id, id), eq(s.adjustments.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new UserError("その調整は見つかりません（もう消えたかもしれません）。画面を読み直してください");
  return rows[0];
}

// ---------------------------------------------------------------- 稼働

export async function addWorkEntry(db: Db, tenantId: string, month: string, input: WorkInput) {
  await ensureOpen(db, tenantId, month);
  const driver = await ensureDriver(db, tenantId, input.driverId);
  const project = await ensureProject(db, tenantId, input.projectId);
  const [row] = await db
    .insert(s.workEntries)
    .values({ tenantId, month, driverId: driver.id, projectId: project.id, qty: input.qty, workDate: input.workDate, note: input.note })
    .returning();
  return { row, driver, project };
}

export async function updateWorkEntry(db: Db, tenantId: string, id: string, input: WorkInput) {
  const before = await getEntry(db, tenantId, id);
  await ensureOpen(db, tenantId, before.month);
  const driver = await ensureDriver(db, tenantId, input.driverId);
  const project = await ensureProject(db, tenantId, input.projectId);
  const [after] = await db
    .update(s.workEntries)
    .set({ driverId: driver.id, projectId: project.id, qty: input.qty, workDate: input.workDate, note: input.note })
    .where(and(eq(s.workEntries.id, id), eq(s.workEntries.tenantId, tenantId)))
    .returning();
  return { before, after, driver, project };
}

export async function deleteWorkEntry(db: Db, tenantId: string, id: string) {
  const before = await getEntry(db, tenantId, id);
  await ensureOpen(db, tenantId, before.month);
  await db.delete(s.workEntries).where(and(eq(s.workEntries.id, id), eq(s.workEntries.tenantId, tenantId)));
  return before;
}

// ---------------------------------------------------------------- 調整（その月だけの足し引き）

export async function addAdjustment(db: Db, tenantId: string, month: string, input: AdjustmentInput) {
  await ensureOpen(db, tenantId, month);
  const driver = await ensureDriver(db, tenantId, input.driverId);
  const [row] = await db
    .insert(s.adjustments)
    .values({
      tenantId,
      month,
      driverId: driver.id,
      label: input.label,
      amount: input.amount,
      taxable: input.taxable,
      agreedInWriting: input.agreedInWriting,
      basis: input.basis,
    })
    .returning();
  return { row, driver };
}

export async function updateAdjustment(db: Db, tenantId: string, id: string, input: AdjustmentInput) {
  const before = await getAdjustment(db, tenantId, id);
  await ensureOpen(db, tenantId, before.month);
  const driver = await ensureDriver(db, tenantId, input.driverId);
  const [after] = await db
    .update(s.adjustments)
    .set({ driverId: driver.id, label: input.label, amount: input.amount, taxable: input.taxable, agreedInWriting: input.agreedInWriting, basis: input.basis })
    .where(and(eq(s.adjustments.id, id), eq(s.adjustments.tenantId, tenantId)))
    .returning();
  return { before, after, driver };
}

export async function deleteAdjustment(db: Db, tenantId: string, id: string) {
  const before = await getAdjustment(db, tenantId, id);
  await ensureOpen(db, tenantId, before.month);
  await db.delete(s.adjustments).where(and(eq(s.adjustments.id, id), eq(s.adjustments.tenantId, tenantId)));
  return before;
}
