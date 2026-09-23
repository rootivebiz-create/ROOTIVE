import "server-only";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { purgeTenant } from "~/server/purge";
import { seedDemo } from "~/server/seed-demo";

/**
 * デモ（DEMO_MODE=1）：来た人ごとに、架空の会社を 1 つ作って渡す。
 * ほかの人の操作は見えない。作ってから 24 時間で消える（毎日もとに戻る）。
 */
export const DEMO_TTL_HOURS = 24;
const MAX_DEMO_TENANTS = 300;

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

/** 古いデモの会社を片付ける（数が多すぎるときは古い順に） */
export async function cleanupDemoTenants(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEMO_TTL_HOURS * 3600 * 1000);
  const isDemo = sql`(${s.tenants.settings} ->> 'demo') = 'true'`;
  const expired = await db.select({ id: s.tenants.id }).from(s.tenants).where(and(isDemo, lt(s.tenants.createdAt, cutoff)));
  const all = await db.select({ id: s.tenants.id }).from(s.tenants).where(isDemo).orderBy(asc(s.tenants.createdAt));
  const extra = all.length - expired.length - (MAX_DEMO_TENANTS - 1);
  const ids = new Set(expired.map((t) => t.id));
  if (extra > 0) for (const t of all.filter((t) => !ids.has(t.id)).slice(0, extra)) ids.add(t.id);
  for (const id of ids) await purgeTenant(db, id);
  return ids.size;
}

/** 新しいデモの会社を作り、オーナーの利用者を返す */
export async function startDemoTenant(db: Db): Promise<{ tenantId: string; userId: string }> {
  await cleanupDemoTenants(db);
  const { tenantId } = await seedDemo(db);
  await db
    .update(s.tenants)
    .set({ settings: sql`${s.tenants.settings} || '{"demo": true}'::jsonb` })
    .where(eq(s.tenants.id, tenantId));
  const [owner] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")))
    .limit(1);
  return { tenantId, userId: owner.id };
}
