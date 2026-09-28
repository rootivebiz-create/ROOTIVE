import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { monthPdfSources, statementPdfSource } from "~/server/features/statements";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** PDF の中の「ページ」の数（/Type /Page の数。/Pages は数えない） */
function pageCount(bytes: Uint8Array): number {
  return (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

describe("支払明細の PDF", () => {
  it("1 人分・1 か月分（1 人ずつ改ページ）を日本語フォントで作れる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    await generateStatements(db, tenantId, DEMO_MONTH);
    const sources = await monthPdfSources(db, tenantId, DEMO_MONTH);
    expect(sources).toHaveLength(8);

    const month = await renderStatementsPdf(sources, new Date("2026-11-01T09:00:00+09:00"));
    expect(Buffer.from(month.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pageCount(month)).toBeGreaterThanOrEqual(8);
    // 日本語フォントが埋め込まれている
    expect(Buffer.from(month).toString("latin1")).toMatch(/NotoSansJP/);

    const [row] = await db
      .select({ id: s.statements.id })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)))
      .limit(1);
    const one = await statementPdfSource(db, tenantId, row.id);
    expect(one).not.toBeNull();
    const single = await renderStatementsPdf([one!]);
    expect(pageCount(single)).toBeGreaterThanOrEqual(1);
    expect(pageCount(single)).toBeLessThan(pageCount(month));
    await client.close();
  });

  it("明細が無くても壊れない", async () => {
    const bytes = await renderStatementsPdf([]);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
