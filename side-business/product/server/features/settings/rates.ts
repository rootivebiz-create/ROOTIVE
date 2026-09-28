import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { fieldError } from "./errors";
import type { OverrideInput } from "./schemas";

/**
 * ドライバー別の単価（標準の支払単価と違う人だけ）。ドライバー × 案件で 1 つ（重ねて登録すると上書き）。
 * 明細は「この人の単価 → 無ければ案件の標準」の順で使う（server/calc/statement.ts）。
 */

export type OverrideItem = {
  id: string;
  driverId: string;
  driverName: string;
  driverCode: string | null;
  driverActive: boolean;
  projectId: string;
  projectName: string;
  projectActive: boolean;
  clientName: string | null;
  unit: string;
  payRate: number;
  standardPayRate: number;
  billRate: number;
  agreedOn: string | null;
  updatedAt: Date;
};

export type OverrideFilter = { driverId?: string; projectId?: string };

export async function listOverrides(db: Db, tenantId: string, filter: OverrideFilter = {}): Promise<OverrideItem[]> {
  const [overrides, drivers, projects, clients] = await Promise.all([
    db.select().from(s.rateOverrides).where(eq(s.rateOverrides.tenantId, tenantId)),
    db.select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code, kana: s.drivers.kana, active: s.drivers.active }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(eq(s.clients.tenantId, tenantId)),
  ]);
  const driver = new Map(drivers.map((d) => [d.id, d]));
  const project = new Map(projects.map((p) => [p.id, p]));
  const client = new Map(clients.map((c) => [c.id, c.name]));
  return overrides
    .filter((o) => (!filter.driverId || o.driverId === filter.driverId) && (!filter.projectId || o.projectId === filter.projectId))
    .map((o) => {
      const d = driver.get(o.driverId);
      const p = project.get(o.projectId);
      return {
        id: o.id,
        driverId: o.driverId,
        driverName: d?.name ?? "（不明）",
        driverCode: d?.code ?? null,
        driverActive: d?.active ?? false,
        projectId: o.projectId,
        projectName: p?.name ?? "（不明）",
        projectActive: p?.active ?? false,
        clientName: p?.clientId ? (client.get(p.clientId) ?? null) : null,
        unit: p?.unit ?? "",
        payRate: o.payRate,
        standardPayRate: p?.payRate ?? 0,
        billRate: p?.billRate ?? 0,
        agreedOn: o.agreedOn,
        updatedAt: o.updatedAt,
      };
    })
    .sort(
      (a, b) =>
        Number(b.driverActive) - Number(a.driverActive) ||
        (a.driverCode ?? "").localeCompare(b.driverCode ?? "", "ja", { numeric: true }) ||
        a.driverName.localeCompare(b.driverName, "ja") ||
        a.projectName.localeCompare(b.projectName, "ja"),
    );
}

async function ownDriverAndProject(db: Db, tenantId: string, driverId: string, projectId: string) {
  const [[driver], [project]] = await Promise.all([
    db
      .select({ id: s.drivers.id, name: s.drivers.name })
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, driverId)))
      .limit(1),
    db
      .select({ id: s.projects.id, name: s.projects.name, payRate: s.projects.payRate })
      .from(s.projects)
      .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.id, projectId)))
      .limit(1),
  ]);
  if (!driver) throw fieldError("driverId", "そのドライバーは見つかりません。選び直してください");
  if (!project) throw fieldError("projectId", "その案件は見つかりません。選び直してください");
  return { driver, project };
}

/** 登録する（同じドライバー × 案件がすでにあれば上書き）。前の値も返す（操作の記録用） */
export async function upsertOverride(db: Db, tenantId: string, input: OverrideInput) {
  const { driver, project } = await ownDriverAndProject(db, tenantId, input.driverId, input.projectId);
  const [before] = await db
    .select()
    .from(s.rateOverrides)
    .where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, input.driverId), eq(s.rateOverrides.projectId, input.projectId)))
    .limit(1);
  const now = new Date();
  const [after] = await db
    .insert(s.rateOverrides)
    .values({ tenantId, driverId: input.driverId, projectId: input.projectId, payRate: input.payRate, agreedOn: input.agreedOn, updatedAt: now })
    .onConflictDoUpdate({
      target: [s.rateOverrides.tenantId, s.rateOverrides.driverId, s.rateOverrides.projectId],
      set: { payRate: input.payRate, agreedOn: input.agreedOn, updatedAt: now },
    })
    .returning();
  return { before: before ?? null, after, driver, project, created: !before };
}

export async function deleteOverride(db: Db, tenantId: string, id: string) {
  const [before] = await db
    .delete(s.rateOverrides)
    .where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.id, id)))
    .returning();
  if (!before) throw new UserError("その単価は見つかりません。画面を読み直してください");
  return before;
}
