import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, stableStringify, statementsStatus } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

describe("明細の写しを作る", () => {
  it("作る → 同じなら版は上がらない → 変えたら版が上がる → 締めた月は作れない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    expect((await statementsStatus(db, tenantId, DEMO_MONTH)).missing).toHaveLength(8);
    const first = await generateStatements(db, tenantId, DEMO_MONTH);
    expect((await statementsStatus(db, tenantId, DEMO_MONTH)).upToDate).toBe(true);
    expect(first.created).toBe(8);
    const again = await generateStatements(db, tenantId, DEMO_MONTH);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 8 });

    const [aoki] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: aoki.id, label: "高速代の立替", amount: 1200 });
    expect((await statementsStatus(db, tenantId, DEMO_MONTH)).stale).toEqual([aoki.id]);
    const third = await generateStatements(db, tenantId, DEMO_MONTH);
    expect(third).toMatchObject({ updated: 1, unchanged: 7 });
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.driverId, aoki.id)));
    expect(st.version).toBe(2);
    expect(st.total).toBe(357555 + 1200);
    expect(st.hash).toMatch(/^[0-9a-f]{64}$/);

    await expect(generateStatements(db, tenantId, DEMO_PREV_MONTH)).rejects.toThrow("締め済み");
    await client.close();
  });

  it("キーの順が違っても同じ文字になる", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});
