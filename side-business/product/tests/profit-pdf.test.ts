import { describe, expect, it } from "vitest";
import { loadCeoSheet } from "~/server/features/profit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { renderCeoPdf } from "~/server/pdf/ceo-pdf";
import { createTestDb } from "./helpers/db";

describe("社長の 1 枚（PDF）", () => {
  it("デモの 10 月を A4 の 1 ページにできる（赤字の案件や長い見張り番の指摘があっても 1 ページ）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const sheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, {
      runWatch: async () =>
        Array.from({ length: 6 }, (_, i) => ({
          code: `c${i}`,
          severity: i % 2 === 0 ? ("red" as const) : ("yellow" as const),
          title: "取引条件を明示した記録が見つかりません。明示した日と方法を記録してください（とても長い見出しの例）",
          detail: "",
          subjectId: `s${i}`,
          subjectLabel: "遠藤 大輔",
          acked: false,
          blocksClose: i % 2 === 0,
        })),
    });
    // 赤字の案件（下位の一覧に出る）も入れておく
    sheet.bottomProjects = [{ ...sheet.bottomProjects[0], profit: -12_345, rate: -0.05 }, ...sheet.bottomProjects.slice(1)];
    const bytes = await renderCeoPdf(sheet, new Date("2026-11-02T09:00:00+09:00"));
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.slice(0, 5)).toBe("%PDF-");
    const counts = [...text.matchAll(/\/Type \/Pages[^>]*?\/Count (\d+)/g)].map((x) => Number(x[1]));
    const alt = [...text.matchAll(/\/Count (\d+)/g)].map((x) => Number(x[1]));
    expect(counts.length > 0 ? counts : alt).toContain(1);
    expect(Math.max(...alt)).toBe(1);
    await client.close();
  });
});
