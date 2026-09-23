import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";
import { pgErrorMessage } from "~/server/db-errors";
import * as s from "~/db/schema";
import type { Db } from "~/db/client";

/** Drizzle が包んだエラーの奥の、DB のメッセージで確かめる */
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  let msg = "";
  try {
    await p;
  } catch (e) {
    msg = pgErrorMessage(e);
  }
  expect(msg).toMatch(re);
}

let db: Db;
let client: PGlite;
let tenantId: string;
let driverId: string;
let projectId: string;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [t] = await db.insert(s.tenants).values({ name: "テスト運送" }).returning();
  tenantId = t.id;
  const [d] = await db.insert(s.drivers).values({ tenantId, name: "青木 翔太" }).returning();
  driverId = d.id;
  const [p] = await db.insert(s.projects).values({ tenantId, name: "宅配", billRate: 190, payRate: 150.5 }).returning();
  projectId = p.id;
});
afterAll(async () => client.close());

describe("DB の守り", () => {
  it("小数の単価・数量は number のまま出し入れできる", async () => {
    const [w] = await db.insert(s.workEntries).values({ tenantId, month: "2026-10-01", driverId, projectId, qty: 12.5 }).returning();
    expect(w.qty).toBe(12.5);
    const [p] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
    expect(p.payRate).toBe(150.5);
  });

  it("締めた月には稼働を足せず、変えられず、消せない", async () => {
    await db.insert(s.workEntries).values({ tenantId, month: "2026-09-01", driverId, projectId, qty: 3 });
    await db.insert(s.monthCloses).values({ tenantId, month: "2026-09-01", status: "closed", closedAt: new Date() });
    await rejectsWith(db.insert(s.workEntries).values({ tenantId, month: "2026-09-01", driverId, projectId, qty: 1 }), /MONTH_CLOSED/);
    await rejectsWith(db.update(s.workEntries).set({ qty: 9 }).where(eq(s.workEntries.month, "2026-09-01")), /MONTH_CLOSED/);
    await rejectsWith(db.delete(s.workEntries).where(eq(s.workEntries.month, "2026-09-01")), /MONTH_CLOSED/);
    await rejectsWith(db.insert(s.adjustments).values({ tenantId, month: "2026-09-01", driverId, label: "立替", amount: 100 }), /MONTH_CLOSED/);
  });

  it("開け直した月には書ける", async () => {
    await db.update(s.monthCloses).set({ status: "open", reopenedAt: new Date() }).where(eq(s.monthCloses.month, "2026-09-01"));
    await db.insert(s.workEntries).values({ tenantId, month: "2026-09-01", driverId, projectId, qty: 1 });
  });

  it("操作の記録は書き換え・削除ができない", async () => {
    const [a] = await db.insert(s.auditLog).values({ tenantId, action: "test", entity: "x" }).returning();
    await rejectsWith(db.update(s.auditLog).set({ action: "changed" }).where(eq(s.auditLog.id, a.id)), /AUDIT_APPEND_ONLY/);
    await rejectsWith(db.delete(s.auditLog).where(eq(s.auditLog.id, a.id)), /AUDIT_APPEND_ONLY/);
  });

  it("数量のマイナスと知らない役割は入らない", async () => {
    await expect(db.insert(s.workEntries).values({ tenantId, month: "2026-10-01", driverId, projectId, qty: -1 })).rejects.toThrow();
    await expect(db.insert(s.users).values({ tenantId, email: "a@example.com", name: "a", role: "admin" })).rejects.toThrow();
  });

  it("明細のリンク用の値は自動で入る", async () => {
    const [st] = await db
      .insert(s.statements)
      .values({ tenantId, month: "2026-10-01", driverId, snapshot: {}, subtotal: 0, tax: 0, deductions: 0, total: 0 })
      .returning();
    expect(st.linkNonce).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("締めたあとの明細", () => {
  it("送った・開いた・リンクの作り直しは記録できるが、金額は変えられない", async () => {
    const [st] = await db
      .insert(s.statements)
      .values({ tenantId, month: "2026-08-01", driverId, snapshot: { a: 1 }, subtotal: 100, tax: 10, deductions: 0, total: 110 })
      .returning();
    await db.insert(s.monthCloses).values({ tenantId, month: "2026-08-01", status: "closed", closedAt: new Date() });
    await db.update(s.statements).set({ sentAt: new Date(), viewedAt: new Date(), linkNonce: "renewed" }).where(eq(s.statements.id, st.id));
    await rejectsWith(db.update(s.statements).set({ total: 999 }).where(eq(s.statements.id, st.id)), /MONTH_CLOSED/);
    await rejectsWith(db.delete(s.statements).where(eq(s.statements.id, st.id)), /MONTH_CLOSED/);
  });
});
