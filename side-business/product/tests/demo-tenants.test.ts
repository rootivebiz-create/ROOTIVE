import { and, count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { cleanupDemoTenants, DemoBusyError, demoBusyReason, MAX_DEMO_STARTS_PER_10_MIN, MAX_DEMO_TENANTS, safeDemoNext, startDemoTenant } from "~/server/demo";
import { purgeTenant } from "~/server/purge";
import { DEMO_MONTH } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

describe("デモの会社（来た人ごと・24 時間で消える）", () => {
  it("来た人ごとに別の会社ができ、古い会社は締めた月・操作の記録ごと消える", async () => {
    const { db, client } = await createTestDb();
    const a = await startDemoTenant(db);
    const b = await startDemoTenant(db);
    expect(a.tenantId).not.toBe(b.tenantId);
    const [ta] = await db.select().from(s.tenants).where(eq(s.tenants.id, a.tenantId));
    expect(ta.settings.demo).toBe(true);

    // 締めた月と操作の記録があっても、片付けでは消せる
    await db.insert(s.auditLog).values({ tenantId: a.tenantId, action: "x", entity: "y" });
    await db.update(s.tenants).set({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) }).where(eq(s.tenants.id, a.tenantId));
    expect(await cleanupDemoTenants(db)).toBe(1);
    const left = await db.select({ id: s.tenants.id }).from(s.tenants);
    expect(left.map((t) => t.id)).toEqual([b.tenantId]);
    const [{ n }] = await db.select({ n: count() }).from(s.auditLog).where(eq(s.auditLog.tenantId, a.tenantId));
    expect(n).toBe(0);
    await client.close();
  });

  it("消す指定が無いときは、締めた月も操作の記録も今までどおり守られる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await startDemoTenant(db);
    await db.insert(s.auditLog).values({ tenantId, action: "x", entity: "y" });
    await expect(db.delete(s.tenants).where(eq(s.tenants.id, tenantId))).rejects.toThrow();
    // ほかの会社を消す指定では外れない
    const other = await startDemoTenant(db);
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('shimebi.purge_tenant', ${other.tenantId}, true)`);
        await tx.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, "2026-09-01")));
      }),
    ).rejects.toThrow();
    await purgeTenant(db, tenantId);
    const rows = await db.select({ id: s.workEntries.id }).from(s.workEntries).where(eq(s.workEntries.tenantId, tenantId));
    expect(rows).toHaveLength(0);
    const kept = await db.select({ id: s.workEntries.id }).from(s.workEntries).where(and(eq(s.workEntries.tenantId, other.tenantId), eq(s.workEntries.month, DEMO_MONTH)));
    expect(kept.length).toBeGreaterThan(0);
    await client.close();
  });

  it("期限の前のデモは、数が多くても消さない。多すぎる・短い間に作られすぎたときは「混み合っています」で作らない", async () => {
    const { db, client } = await createTestDb();
    const now = new Date("2026-10-01T10:00:00+09:00");
    const old = new Date(now.getTime() - 3 * 3600 * 1000);
    // 使っている途中（3 時間前）のデモの会社を上限まで並べる
    const rows = Array.from({ length: MAX_DEMO_TENANTS }, (_, i) => ({ name: `demo-${i}`, settings: { demo: true } as Record<string, unknown>, createdAt: old }));
    await db.insert(s.tenants).values(rows as never);
    expect(await cleanupDemoTenants(db, now)).toBe(0);
    expect(await demoBusyReason(db, now)).toMatch(/混み合っています/);
    await expect(startDemoTenant(db, now)).rejects.toBeInstanceOf(DemoBusyError);
    const [{ n }] = await db.select({ n: count() }).from(s.tenants);
    expect(n).toBe(MAX_DEMO_TENANTS);

    // 期限を過ぎたら片付き、また作れる
    const later = new Date(now.getTime() + 22 * 3600 * 1000);
    expect(await cleanupDemoTenants(db, later)).toBe(MAX_DEMO_TENANTS);
    expect(await demoBusyReason(db, later)).toBeNull();

    // 10 分の間に作られすぎたとき
    const recent = Array.from({ length: MAX_DEMO_STARTS_PER_10_MIN }, (_, i) => ({ name: `r-${i}`, settings: { demo: true } as Record<string, unknown>, createdAt: new Date(later.getTime() - 60_000) }));
    await db.insert(s.tenants).values(recent as never);
    expect(await demoBusyReason(db, later)).toMatch(/混み合っています/);
    expect(await demoBusyReason(db, new Date(later.getTime() + 11 * 60_000))).toBeNull();
    // DB が大きすぎるとき（上限を小さくして確かめる）
    expect(await demoBusyReason(db, new Date(later.getTime() + 11 * 60_000), 1)).toMatch(/混み合っています/);
    await client.close();
  });

  it("入ったあとに開く画面は、同じサイトの中のパスだけ", () => {
    expect(safeDemoNext("/import")).toBe("/import");
    expect(safeDemoNext("https://evil.example/")).toBe("/");
    expect(safeDemoNext("//evil.example/")).toBe("/");
    expect(safeDemoNext("/\\evil.example")).toBe("/");
    expect(safeDemoNext("/demo/start")).toBe("/");
    expect(safeDemoNext(undefined)).toBe("/");
  });
});
