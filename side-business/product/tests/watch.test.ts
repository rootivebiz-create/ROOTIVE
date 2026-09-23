import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import { runWatch } from "~/server/features/watch";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

describe("debug", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(db));
  });
  afterAll(async () => client.close());
  it("prints", async () => {
    const issues = await runWatch(db, tenantId, DEMO_MONTH, { today: "2026-10-31" });
    for (const i of issues) console.log(i.severity, i.code, i.subjectLabel, "|", i.title, "|", i.detail);
    const sep = await runWatch(db, tenantId, "2026-09-01", { today: "2026-10-31" });
    for (const i of sep) console.log("SEP", i.severity, i.code, i.subjectLabel, "|", i.title, "|", i.detail);
    expect(issues.length).toBeGreaterThan(0);
  });
});
