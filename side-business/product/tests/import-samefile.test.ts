import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import {
  applyBatch,
  createDraftFromFile,
  listBatches,
  loadDraftView,
  readSampleFile,
  sameFileMessage,
  selectSheet,
  setBatchMonth,
  undoBatch,
} from "~/server/features/import/service";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 同じファイルの二重の取り込み（SPEC P0-2.6）：ファイルのハッシュで見つけて止める。
 * 「取り消して入れ直す」だけを出し、押すと前の取り込みと入れ替える（数量は倍にならない。取り消すと前の取り込みに戻る）。
 */

async function staffUser(db: Db, tenantId: string) {
  const [u] = await db
    .select()
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  return { id: u.id, name: u.name };
}

async function monthWork(db: Db, tenantId: string, month = DEMO_MONTH) {
  return db
    .select()
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)));
}

async function totals(db: Db, tenantId: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
  return Object.fromEntries(drafts.map((d) => [d.driver.code, d.total]));
}

const dayJa = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" });

describe("同じファイルを 2 回置く", () => {
  it("ハッシュを import_batches.file_hash に残し、同じファイルは「同じファイルがすでに反映されています（◯月◯日・◯◯さん）。二重に数えると ¥2,410,600 多く払うおそれがあります」で止める", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const staff = await staffUser(db, tenantId);
    const before = await totals(db, tenantId);
    const { fileName, bytes } = await readSampleFile("long");

    const first = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    const [row] = await db.select().from(s.importBatches).where(eq(s.importBatches.id, first.id));
    expect(row.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.fileHash).toBe((row.summary as { file: { hash: string } }).file.hash);
    expect((await loadDraftView(db, tenantId, first.id))!.sameFile).toBeNull();
    await applyBatch(db, tenantId, staff, first.id, { mode: "replaceAll", confirmDuplicates: false });

    // もう一度置く：同じファイル
    const second = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, second.id))!;
    const info = view.sameFile!;
    expect(info).toMatchObject({ batchId: first.id, fileName, appliedByName: staff.name, entries: 11, yen: 2410600 });
    const today = dayJa.format(new Date());
    expect(sameFileMessage(info)).toBe(`同じファイルがすでに反映されています（${today}・${staff.name}さん）。二重に数えると ¥2,410,600 多く払うおそれがあります`);
    // 入れ直したときの見込み：前の取り込みの 11 件を消して入れる。明細は変わらない
    expect(view.preview!.reapply).toMatchObject({ removeEntries: 11, removeManual: 0, duplicates: [] });
    expect(view.preview!.reapply!.removeBatches.map((b) => b.id)).toEqual([first.id]);
    expect(view.preview!.statements).toEqual([]);

    // どの入れ替え方でも止まる（何も書かない）
    for (const mode of ["add", "replace", "replaceAll"] as const) {
      await expect(applyBatch(db, tenantId, staff, second.id, { mode, confirmDuplicates: true })).rejects.toThrow(
        `同じファイルがすでに反映されています（${today}・${staff.name}さん）。二重に数えると ¥2,410,600 多く払うおそれがあります`,
      );
    }
    expect(await monthWork(db, tenantId)).toHaveLength(11);

    // 取り消して入れ直す：倍にならず、明細の金額も同じ
    const res = await applyBatch(db, tenantId, staff, second.id, { mode: "add", confirmDuplicates: false, reapply: true });
    expect(res).toMatchObject({ entries: 11, removedEntries: 11, replacedBatches: 1, reappliedFrom: [first.id] });
    const work = await monthWork(db, tenantId);
    expect(work).toHaveLength(11);
    expect(work.every((w) => w.importBatchId === second.id)).toBe(true);
    expect(await totals(db, tenantId)).toEqual(before);
    const history = await listBatches(db, tenantId, DEMO_MONTH);
    expect(history.map((h) => [h.id, h.status, h.discardedReason])).toEqual([
      [second.id, "applied", null],
      [first.id, "discarded", "replaced"],
    ]);
    const applied = (await loadDraftView(db, tenantId, second.id))!.summary.applied!;
    expect(applied).toMatchObject({ mode: "replace", reappliedFrom: [first.id] });

    // 入れ直しを取り消すと、前の取り込みに戻る。前の取り込みを取り消すと、手入力の分に戻る
    expect(await undoBatch(db, tenantId, staff, second.id)).toMatchObject({ deleted: 11, restored: 11 });
    expect((await monthWork(db, tenantId)).every((w) => w.importBatchId === first.id)).toBe(true);
    expect(await undoBatch(db, tenantId, staff, first.id)).toMatchObject({ deleted: 11, restored: 11 });
    expect((await monthWork(db, tenantId)).every((w) => w.importBatchId === null)).toBe(true);
    expect(await totals(db, tenantId)).toEqual(before);

    // 前の取り込みを取り消したあとなら、同じファイルでも止まらない
    const third = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    expect((await loadDraftView(db, tenantId, third.id))!.sameFile).toBeNull();
    await client.close();
  });

  it("中身が 1 か所でも違うファイルは「同じファイル」ではない。同じファイルがほかの月に反映されていれば、月の選び間違いとして知らせる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const enc = (t: string) => new TextEncoder().encode(t);
    const a = "ドライバー,コース,個数\n青木 翔太,宅配,100\n";
    const d1 = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "応援_2026年11月.csv", bytes: enc(a), pageMonth: DEMO_MONTH });
    await applyBatch(db, tenantId, { id: null }, d1.id, { mode: "add", confirmDuplicates: false });
    // 1 文字違い（数量 100 → 101）
    const d2 = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "応援_2026年11月.csv", bytes: enc(a.replace("100", "101")), pageMonth: DEMO_MONTH });
    expect((await loadDraftView(db, tenantId, d2.id))!.sameFile).toBeNull();
    // 同じファイルを 12 月分として置く → 11 月に反映済みと出る（止めはしない）
    const d3 = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "応援_2026年11月.csv", bytes: enc(a), pageMonth: DEMO_MONTH });
    await setBatchMonth(db, tenantId, d3.id, "2026-12-01");
    const v3 = (await loadDraftView(db, tenantId, d3.id))!;
    expect(v3.sameFile).toBeNull();
    expect(v3.sameFileOtherMonths).toEqual([{ batchId: d1.id, month: "2026-11-01", fileName: "応援_2026年11月.csv" }]);
    // 記録の人がいない取り込み（テストの { id: null }）は、名前を出さない
    const d4 = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "応援_2026年11月.csv", bytes: enc(a), pageMonth: DEMO_MONTH });
    const info = (await loadDraftView(db, tenantId, d4.id))!.sameFile!;
    expect(info.appliedByName).toBeNull();
    // 宅配 100 × 150 円
    expect(info.yen).toBe(15000);
    expect(sameFileMessage(info)).toMatch(/^同じファイルがすでに反映されています（\d+月\d+日）。二重に数えると ¥15,000 多く払うおそれがあります$/);
    await client.close();
  });

  it("元請ごとにシートを分けたブックは、シートを替えて取り込めば二重ではない（同じシートをもう一度なら止める）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const staff = await staffUser(db, tenantId);
    // 同じ形のシートが 2 枚：A物流（宅配）と B商事（企業配）。どちらも 10 月分
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("A物流");
    a.addRows([["ドライバー", "コース", "個数"], ["青木 翔太", "宅配", 100], ["上田 健", "宅配", 50]]);
    const b = wb.addWorksheet("B商事");
    b.addRows([["ドライバー", "コース", "個数"], ["井上 美咲", "企業配", 3], ["佐藤 亮", "企業配", 2], ["岡田 拓也", "企業配", 1]]);
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const fileName = "元請別_2026年10月.xlsx";
    const before = (await monthWork(db, tenantId)).length;

    const first = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    await selectSheet(db, tenantId, first.id, 0);
    await applyBatch(db, tenantId, staff, first.id, { mode: "add", confirmDuplicates: true });

    // 同じブックの B商事 のシート：同じファイルではない。A物流 の取り込みは消さない
    const second = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    await selectSheet(db, tenantId, second.id, 1);
    const v2 = (await loadDraftView(db, tenantId, second.id))!;
    expect(v2.sameFile).toBeNull();
    expect(v2.preview!.modes.replace.removeEntries).toBe(0);
    expect(v2.preview!.modes.add.sameFileApplied).toBe(false);
    const res = await applyBatch(db, tenantId, staff, second.id, { mode: "replace", confirmDuplicates: true });
    expect(res).toMatchObject({ entries: 3, removedEntries: 0, replacedBatches: 0 });
    const work = await monthWork(db, tenantId);
    expect(work).toHaveLength(before + 5);
    expect(work.filter((w) => w.importBatchId === first.id)).toHaveLength(2);
    expect(work.filter((w) => w.importBatchId === second.id)).toHaveLength(3);

    // A物流 のシートをもう一度：同じファイル（同じシート）なので止める。数量は倍にならない
    const third = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    await selectSheet(db, tenantId, third.id, 0);
    const v3 = (await loadDraftView(db, tenantId, third.id))!;
    // 青木 宅配 100 × 150 円 ＋ 上田 宅配 50 × 150 円 = 22,500 円
    expect(v3.sameFile).toMatchObject({ batchId: first.id, entries: 2, yen: 22500 });
    await expect(applyBatch(db, tenantId, staff, third.id, { mode: "add", confirmDuplicates: true })).rejects.toThrow("同じファイルがすでに反映されています");
    expect(await monthWork(db, tenantId)).toHaveLength(before + 5);
    await client.close();
  });

  it("前の取り込みの稼働を「稼働と調整」でみな消してあれば、同じファイルでも止めない（入れても二重にならない）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const staff = await staffUser(db, tenantId);
    const { fileName, bytes } = await readSampleFile("long");
    const first = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    await applyBatch(db, tenantId, staff, first.id, { mode: "replaceAll", confirmDuplicates: false });
    await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.importBatchId, first.id)));
    expect(await monthWork(db, tenantId)).toHaveLength(0);
    const second = await createDraftFromFile(db, tenantId, staff, { fileName, bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, second.id))!;
    expect(view.sameFile).toBeNull();
    expect(view.preview!.modes.add.sameFileApplied).toBe(false);
    const res = await applyBatch(db, tenantId, staff, second.id, { mode: "add", confirmDuplicates: false });
    expect(res).toMatchObject({ entries: 11, removedEntries: 0 });
    expect(await monthWork(db, tenantId)).toHaveLength(11);
    await client.close();
  });

  it("別の会社の取り込みは「同じファイル」に数えない（別の会社からは入れ直しもできない）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId: t1 } = await seedDemo(db);
    const { tenantId: t2 } = await seedDemo(db);
    const { fileName, bytes } = await readSampleFile("long");
    const d1 = await createDraftFromFile(db, t1, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await applyBatch(db, t1, { id: null }, d1.id, { mode: "replaceAll", confirmDuplicates: false });
    const d2 = await createDraftFromFile(db, t2, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    const v2 = (await loadDraftView(db, t2, d2.id))!;
    expect(v2.sameFile).toBeNull();
    expect(v2.sameFileOtherMonths).toEqual([]);
    // 会社 1 の 2 回目を、会社 2 から入れ直そうとしても見つからない
    const again = await createDraftFromFile(db, t1, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await expect(applyBatch(db, t2, { id: null }, again.id, { mode: "replace", confirmDuplicates: false, reapply: true })).rejects.toThrow("見つかりません");
    expect((await monthWork(db, t1)).every((w) => w.importBatchId === d1.id)).toBe(true);
    await client.close();
  });
});
