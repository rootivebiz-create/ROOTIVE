import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { loadBuildInput } from "~/server/repo";
import { buildStatementDrafts } from "~/server/calc/statement";
import type { Db } from "~/db/client";

let db: Db;
let client: PGlite;
let tenantId: string;
beforeAll(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
});
afterAll(async () => client.close());

describe("デモのデータ", () => {
  it("10 月分の明細が 8 人ぶんでき、青木さんは 357,555 円", async () => {
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    expect(drafts).toHaveLength(8);
    expect(drafts.find((d) => d.driver.name === "青木 翔太")!.total).toBe(357555);
    // 遠藤さんは車両リースも引かれる
    const endo = drafts.find((d) => d.driver.name === "遠藤 大輔")!;
    expect(endo.deductions.map((x) => x.name)).toContain("車両リース");
  });
});
