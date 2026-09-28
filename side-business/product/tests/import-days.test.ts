import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { applyBatch, createDraftFromFile, loadDraftView, selectSheet } from "~/server/features/import/service";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/** 日付が横に並ぶ Excel（2 段の見出し・合計行・メモのシートつき）を作る */
async function dayWorkbook(drivers: { name: string; course: string; perDay: number }[], days = 31): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const memo = wb.addWorksheet("メモ");
  memo.addRow(["このブックの使い方"]);
  memo.addRow(["毎日の個数を入れる"]);
  const ws = wb.addWorksheet("10月");
  ws.addRow(["2026年10月 日別稼働表"]);
  ws.addRow(["氏名", "コース", "10月", ...Array(days - 1).fill(""), "計"]);
  ws.addRow(["", "", ...Array.from({ length: days }, (_, i) => i + 1), ""]);
  for (const d of drivers) {
    const values = Array.from({ length: days }, (_, i) => ((i + 1) % 7 === 0 ? 0 : d.perDay));
    ws.addRow([d.name, d.course, ...values, values.reduce((a, b) => a + b, 0)]);
  }
  const totals = Array.from({ length: days }, (_, i) => drivers.reduce((a, d) => a + ((i + 1) % 7 === 0 ? 0 : d.perDay), 0));
  ws.addRow(["合計", "", ...totals, totals.reduce((a, b) => a + b, 0)]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("取り込み：日付が横に並ぶ Excel", () => {
  it("データの多いシートを選び、2 段の見出しから日付ごとに取り込む（行・列の合計とも照合）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const bytes = await dayWorkbook([
      { name: "青木翔太", course: "宅配", perDay: 90 },
      { name: "上田 健", course: "宅配", perDay: 70 },
    ]);
    const { id, month } = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "日別_10月.xlsx", bytes, pageMonth: "2026-11-01" });
    expect(month).toBe(DEMO_MONTH); // 表題の「2026年10月」
    const view = (await loadDraftView(db, tenantId, id))!;
    expect(view.summary.sheets.map((x) => x.name)).toEqual(["メモ", "10月"]);
    expect(view.summary.sheetIndex).toBe(1);
    expect(view.summary.mapping.headerDepth).toBe(2);
    expect(view.blockers).toEqual([]);
    // 7 の倍数の日は 0（取り込まない）。27 日 × 90 = 2,430、27 日 × 70 = 1,890
    expect(view.stats).toMatchObject({ records: 54, totalQty: 4320, drivers: 2, projects: 1 });
    expect(view.computed.parse.checks.map((c) => c.ok)).toEqual([true, true]);
    expect(view.computed.parse.emptyCells).toBe(8);

    // メモのシートに切り替えると、読めない理由が出る
    await selectSheet(db, tenantId, id, 0);
    expect((await loadDraftView(db, tenantId, id))!.blockers.length).toBeGreaterThan(0);
    await selectSheet(db, tenantId, id, 1);

    await applyBatch(db, tenantId, { id: null }, id, { mode: "add", confirmDuplicates: true });
    const rows = await db
      .select()
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.importBatchId, id)));
    expect(rows).toHaveLength(54);
    expect(rows.every((r) => r.workDate?.startsWith("2026-10-"))).toBe(true);
    expect(
      rows
        .filter((r) => r.workDate === "2026-10-01")
        .map((r) => r.qty)
        .sort(),
    ).toEqual([70, 90]);
    await client.close();
  });

  it("50 人 × 31 日の表を、すばやく読んで反映できる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const drivers = Array.from({ length: 50 }, (_, i) => ({ name: `応援 ${i + 1}号`, course: "宅配", perDay: 50 + i }));
    // 台帳に 50 人を先に入れておく
    await db.insert(s.drivers).values(drivers.map((d) => ({ tenantId, name: d.name })));
    const bytes = await dayWorkbook(drivers);
    const started = Date.now();
    const { id } = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "50人.xlsx", bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, id))!;
    expect(view.blockers).toEqual([]);
    expect(view.stats.records).toBe(50 * 27);
    await applyBatch(db, tenantId, { id: null }, id, { mode: "add", confirmDuplicates: true });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(15000);
    await client.close();
  });
});
