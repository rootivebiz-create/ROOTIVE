import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { loadCeoSheet } from "~/server/features/profit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { renderCeoPdf } from "~/server/pdf/ceo-pdf";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

it("render", async () => {
  const { db, client } = await createTestDb();
  const { tenantId } = await seedDemo(db);
  await generateStatements(db, tenantId, DEMO_MONTH);
  const sheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, { runWatch: async () => [
    { code: "a", severity: "red", title: "取引条件を明示した記録が見つかりません", detail: "", subjectId: "x", subjectLabel: "遠藤 大輔", acked: false, blocksClose: true },
    { code: "b", severity: "yellow", title: "合意の記録が無い控除があります", detail: "", subjectId: "y", subjectLabel: "木村 誠", acked: false, blocksClose: false },
  ] });
  writeFileSync(process.env.OUT!, await renderCeoPdf(sheet));
  await client.close();
});
