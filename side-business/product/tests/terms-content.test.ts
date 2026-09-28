import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { buildTermsContent, compareTermsContent, latestTermsByDriver } from "~/server/features/terms-content";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

describe("取引条件の中身（台帳から組み立てる・比べる）", () => {
  it("岡田さん（宅配だけ 155 円）：直近の案件・人ごとの単価・控除・具体的な支払期日", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const [okada] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D05")));
    const c = await buildTermsContent(db, tenantId, okada.id, { month: DEMO_MONTH, deemed: true });
    expect(c.services.map((x) => [x.name, x.payRate])).toEqual([
      ["企業配（日当）", 18000],
      ["宅配（個建て）", 155],
    ]);
    expect(c.deductions.map((d) => d.how)).toEqual(["委託料（税抜）の 10%（稼働した月だけ）", "毎月 15,000円（稼働した月だけ）"]);
    expect(c.payment.text).toMatch(/^毎月末日締め・翌月25日払い/);
    expect(c.payment.text).not.toMatch(/まで|以内/);
    expect(c.feeBearer).toBe("company");
    expect(c.deemedClause).toContain("7日以内");

    // 記録したあとで単価と控除が変わると、比べた結果に出る
    const changed = structuredClone(c);
    changed.services[1].payRate = 150;
    changed.deductions.push({ ruleId: "x", name: "制服代", kind: "fixed", rate: null, amount: 5000, onlyWhenWorked: true, how: "毎月 5,000円（稼働した月だけ）" });
    const diff = compareTermsContent(c, changed);
    expect(diff.map((d) => d.kind)).toEqual(["rate", "deduction_added"]);
    expect(compareTermsContent(c, c)).toEqual([]);

    // ほかの会社のドライバーは組み立てられない
    const other = await seedDemo(db);
    await expect(buildTermsContent(db, other.tenantId, okada.id)).rejects.toThrow();
    expect((await latestTermsByDriver(db, tenantId)).size).toBe(0);
    await client.close();
  });
});
