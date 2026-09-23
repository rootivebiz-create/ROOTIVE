import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { chooseSheet, guessMapping, monthNoYear, suggestMonth } from "~/server/features/import/detect";
import { parseRowDate } from "~/server/features/import/parse";
import { resolveRecords, type Known } from "~/server/features/import/resolve";
import { monthInputSchema, quickProjectSchema } from "~/server/features/import/schemas";
import {
  applyBatch,
  createDraftFromFile,
  listBatches,
  listOpenDrafts,
  loadDraftView,
  readSampleFile,
  registerAllDrivers,
  resolveName,
  selectSheet,
  undoBatch,
} from "~/server/features/import/service";
import { addWorkEntry, updateWorkEntry } from "~/server/features/import/work";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 見直しで直したところ：同時に押したときの二重反映・二重の取り消し、名前の一部だけの当たり、
 * 番号と名前の食い違い、同じ人・案件の二重登録、2 万行を超えるシート、年の無い日付、月の入力のゆれ。
 */

const user = { id: null };

function csv(text: string) {
  return new TextEncoder().encode(text);
}

async function monthWork(db: Db, tenantId: string, month = DEMO_MONTH) {
  return db
    .select()
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)));
}

async function driverByCode(db: Db, tenantId: string, code: string) {
  const [d] = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d;
}

describe("同時に押しても、二重にならない", () => {
  it("同じ下書きを 2 回同時に反映しても、稼働は 1 回分だけ。取り消しを 2 回同時に押しても、戻すのは 1 回分だけ", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { fileName, bytes } = await readSampleFile("long");
    const { id } = await createDraftFromFile(db, tenantId, user, { fileName, bytes, pageMonth: DEMO_MONTH });

    const results = await Promise.allSettled([
      applyBatch(db, tenantId, user, id, { mode: "replaceAll", confirmDuplicates: false }),
      applyBatch(db, tenantId, user, id, { mode: "replaceAll", confirmDuplicates: false }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/反映/);
    const after = await monthWork(db, tenantId);
    expect(after).toHaveLength(11);
    expect(after.reduce((a, w) => a + w.qty, 0)).toBe(5205);

    const undo = await Promise.allSettled([undoBatch(db, tenantId, user, id), undoBatch(db, tenantId, user, id)]);
    expect(undo.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // 入れ替えで消した手入力の 11 行が、1 回分だけ戻る
    const back = await monthWork(db, tenantId);
    expect(back).toHaveLength(11);
    expect(back.every((w) => w.importBatchId === null)).toBe(true);
    expect(back.reduce((a, w) => a + w.qty, 0)).toBe(5205);
    await client.close();
  });
});

describe("重なりの金額の目安（明細と同じ単価）", () => {
  it("見本の縦持ちを今ある 10 月分に足すと、二重の目安は 2,410,600 円。青木さんの委託料は 374,500 円 → 749,000 円と出る", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { fileName, bytes } = await readSampleFile("long");
    const { id } = await createDraftFromFile(db, tenantId, user, { fileName, bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, id, { mode: "add" }))!;
    // 宅配 2310×150 + スポット 4×7000 + 企業配 (21+18+22)×18000 + 宅配 1840×150 + ルート 168×2000 + スポット 2×7000
    // + 宅配 420×155（岡田さんだけの単価）+ 夜間 20×9500 + 宅配 380×150
    expect(view.preview!.modes.add.duplicateYen).toBe(2410600);
    const aoki = view.preview!.statements.find((r) => r.name === "青木 翔太")!;
    expect(aoki).toMatchObject({ beforeSubtotal: 374500, afterSubtotal: 749000, beforeTotal: 357555 });
    // 確かめのチェックが無いと反映しない
    await expect(applyBatch(db, tenantId, user, id, { mode: "add", confirmDuplicates: false })).rejects.toThrow("2,410,600円");
    await client.close();
  });
});

describe("名前の当たり方", () => {
  const known: Known = {
    drivers: [
      { id: "d1", code: "D01", name: "青木 翔太", active: true },
      { id: "d2", code: "D02", name: "井上 美咲", active: true },
    ],
    projects: [{ id: "p1", name: "宅配（個建て）", aliases: ["宅配"], unit: "個", active: true }],
  };
  const rec = (driver: string, code = "") => ({ rowNo: 2, cell: "C2", driver, code, project: "宅配", qty: 10, date: null, note: null });

  it("名前の一部だけで当たった人（青木 翔太郎 → 青木 翔太）は、確かめるまで反映しない", () => {
    const res = resolveRecords([rec("青木 翔太郎")], known, null, { drivers: [], projects: [] });
    expect(res.unresolvedRecords).toBe(1);
    expect(res.resolved).toEqual([]);
    expect(res.drivers[0]).toMatchObject({ needsCheck: true, match: { id: "d1", how: "partial" } });
  });

  it("番号と名前が別の人を指す行は、番号で当てたうえで知らせる", () => {
    const res = resolveRecords([rec("井上 美咲", "D01"), rec("青木 翔太", "D01")], known, null, { drivers: [], projects: [] });
    expect(res.resolved.map((r) => r.driverId)).toEqual(["d1", "d1"]);
    expect(res.codeConflicts).toEqual([{ code: "D01", codeName: "青木 翔太", fileName: "井上 美咲", nameMatch: "井上 美咲", rows: 1 }]);
  });

  it("DB でも：一部だけの当たりは止まり、「合っている」を押すと覚えて反映できる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const d = await createDraftFromFile(db, tenantId, user, {
      fileName: "応援_2026年11月.csv",
      bytes: csv("ドライバー,コース,個数\n青木 翔太郎,宅配,10\n"),
      pageMonth: DEMO_MONTH,
    });
    const v = (await loadDraftView(db, tenantId, d.id))!;
    expect(v.blockers.join()).toContain("名前が決まっていない行");
    await expect(applyBatch(db, tenantId, user, d.id, { mode: "add", confirmDuplicates: true })).rejects.toThrow("名前が決まっていない");
    const g = v.computed.resolution.drivers[0];
    const aoki = await driverByCode(db, tenantId, "D01");
    expect(g.match?.id).toBe(aoki.id);
    await resolveName(db, tenantId, d.id, { kind: "driver", key: g.key, action: "match", targetId: aoki.id });
    const v2 = (await loadDraftView(db, tenantId, d.id))!;
    expect(v2.blockers).toEqual([]);
    expect(v2.computed.resolution.drivers[0].match?.how).toBe("alias");
    await client.close();
  });
});

describe("新しく登録するときの二重登録を止める", () => {
  it("同じ名前の人（番号なし）・使っている番号・同じ名前の案件は登録しない。別の会社の同じ名前は関係ない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: other } = await seedDemo(db);
    const d = await createDraftFromFile(db, tenantId, user, {
      fileName: "x_2026年11月.csv",
      bytes: csv("ドライバー,コース,個数\n応援 太郎,待機,3\n"),
      pageMonth: DEMO_MONTH,
    });
    const v = (await loadDraftView(db, tenantId, d.id))!;
    const dKey = v.computed.resolution.drivers[0].key;
    const pKey = v.computed.resolution.projects[0].key;
    const before = (await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))).length;

    await expect(resolveName(db, tenantId, d.id, { kind: "driver", key: dKey, action: "create", name: "青木　翔太", kana: null, code: null })).rejects.toThrow(
      "もう台帳にいます",
    );
    await expect(resolveName(db, tenantId, d.id, { kind: "driver", key: dKey, action: "create", name: "応援 太郎", kana: null, code: "d01" })).rejects.toThrow(
      "青木 翔太",
    );
    await expect(
      resolveName(db, tenantId, d.id, { kind: "project", key: pKey, action: "create", name: "夜間便", unit: "便", billRate: 0, payRate: 1, clientId: null }),
    ).rejects.toThrow("もう台帳にあります");
    expect((await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))).length).toBe(before);

    // 同じ名前でも番号が違えば登録できる（同姓同名の別の方）
    await resolveName(db, tenantId, d.id, { kind: "driver", key: dKey, action: "create", name: "青木 翔太", kana: null, code: "D90" });
    expect((await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))).length).toBe(before + 1);
    // 別の会社の台帳は増えていない
    expect((await db.select().from(s.drivers).where(eq(s.drivers.tenantId, other))).length).toBe(before);
    await client.close();
  });

  it("案件を新しく登録するときは、支払単価を空にできない（0 円の明細にしない）", () => {
    expect(quickProjectSchema.safeParse({ name: "待機料", unit: "時間", billRate: "2000", payRate: "" }).success).toBe(false);
    expect(quickProjectSchema.parse({ name: "待機料", unit: "時間", billRate: "", payRate: "１，５００" })).toMatchObject({ billRate: 0, payRate: 1500 });
    expect(quickProjectSchema.parse({ name: "無償の手伝い", unit: "回", payRate: "0" }).payRate).toBe(0);
  });
});

describe("大きなシート・日付・月の入力", () => {
  it("2 万行を超えるシートは、先を読めていないおそれがあるので反映しない（黙って少なく取り込まない）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const lines = ["ドライバー,コース,個数", ...Array.from({ length: 20500 }, () => "青木 翔太,宅配,1")];
    const d = await createDraftFromFile(db, tenantId, user, { fileName: "大きい_2026年11月.csv", bytes: csv(lines.join("\n")), pageMonth: DEMO_MONTH });
    const v = (await loadDraftView(db, tenantId, d.id))!;
    expect(v.summary.sheets[0].truncated).toBe(true);
    expect(v.blockers.join()).toContain("20,000 行を超えて");
    await expect(applyBatch(db, tenantId, user, d.id, { mode: "add", confirmDuplicates: true })).rejects.toThrow("20,000 行");
    expect(await monthWork(db, tenantId, "2026-11-01")).toEqual([]);
    await client.close();
  }, 30000);

  it("年の無い日付（12/28）は、取り込む月にいちばん近い年にする", () => {
    expect(parseRowDate("12/28", "2027-01-01")).toBe("2026-12-28");
    expect(parseRowDate("1/3", "2026-12-01")).toBe("2027-01-03");
    expect(parseRowDate("10/31", "2026-10-01")).toBe("2026-10-31");
    expect(parseRowDate("2027/12/28", "2027-01-01")).toBe("2027-12-28");
  });

  it("月は「2026-10」「2026/10」「2026年10月」「２０２６－１０」のどれでも読む", () => {
    for (const v of ["2026-10", "2026-10-01", "2026/10", "2026年10月", "２０２６－１０", " 2026.10 "]) expect(monthInputSchema.parse(v)).toBe("2026-10-01");
    expect(monthInputSchema.safeParse("2026-13").success).toBe(false);
    expect(monthInputSchema.safeParse("10月").success).toBe(false);
  });

  it("手で入れる稼働の日付は、前後 1 か月まで（年の打ち間違いを止める）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const aoki = await driverByCode(db, tenantId, "D01");
    const [spot] = await db
      .select()
      .from(s.projects)
      .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "スポット便")));
    const base = { driverId: aoki.id, projectId: spot.id, qty: 1, note: null };
    await expect(addWorkEntry(db, tenantId, DEMO_MONTH, { ...base, workDate: "2025-10-15" })).rejects.toThrow("離れています");
    // 20 日締めの会社なら、前の月の 21 日からが 10 月分
    const { row } = await addWorkEntry(db, tenantId, DEMO_MONTH, { ...base, workDate: "2026-09-21" });
    await expect(updateWorkEntry(db, tenantId, row.id, { ...base, workDate: "2026-12-01" })).rejects.toThrow("離れています");
    await client.close();
  });
});

describe("ほかの機能が作った取り込みの行", () => {
  it("この画面で開けない形の行は、履歴・確認中の一覧に出さない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    await db.insert(s.importBatches).values({ tenantId, month: DEMO_MONTH, fileName: "古い形.xlsx", status: "draft" });
    expect(await listBatches(db, tenantId, DEMO_MONTH)).toEqual([]);
    expect(await listOpenDrafts(db, tenantId)).toEqual([]);
    await client.close();
  });
});

describe("月ごとにシートを足していくブック", () => {
  /** 「9月」（行が多い）と「10月」のシート。表題は無く、月はシート名だけ */
  async function monthlyBook(): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    const sep = wb.addWorksheet("9月");
    sep.addRow(["ドライバー", "コース", "個数"]);
    for (const [n, c, q] of [
      ["青木 翔太", "宅配", 2250],
      ["上田 健", "宅配", 1905],
      ["木村 誠", "宅配", 1300],
      ["加藤 由美", "夜間", 18],
    ] as const)
      sep.addRow([n, c, q]);
    const oct = wb.addWorksheet("10月");
    oct.addRow(["ドライバー", "コース", "個数"]);
    oct.addRow(["青木 翔太", "宅配", 2310]);
    oct.addRow(["木村 誠", "宅配", 380]);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it("開いていた月（10 月）のシートを先に選び、月もシート名から読む。9 月のシートに替えると 9 月（締め済み）になり止まる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { id, month } = await createDraftFromFile(db, tenantId, user, { fileName: "稼働表.xlsx", bytes: await monthlyBook(), pageMonth: DEMO_MONTH });
    expect(month).toBe(DEMO_MONTH);
    const v = (await loadDraftView(db, tenantId, id))!;
    expect(v.summary.sheets[v.summary.sheetIndex].name).toBe("10月");
    expect(v.summary).toMatchObject({ sheetFrom: "month", monthFrom: "sheet" });
    expect(v.totals.byProject).toEqual([expect.objectContaining({ name: "宅配（個建て）", qty: 2690 })]);

    await selectSheet(db, tenantId, id, 0);
    const v2 = (await loadDraftView(db, tenantId, id))!;
    expect(v2.batch.month).toBe(DEMO_PREV_MONTH);
    expect(v2.closed).toBe(true);
    expect(v2.blockers.join()).toContain("締め済み");
    await client.close();
  });

  it("シートの月の読み方（年の無い「10月」は、開いていた月にいちばん近い年）", () => {
    expect(monthNoYear("10月", "2026-10-01")).toBe("2026-10-01");
    expect(monthNoYear("12月分", "2027-01-01")).toBe("2026-12-01");
    expect(monthNoYear("1月", "2026-12-01")).toBe("2027-01-01");
    expect(monthNoYear("Sheet1", "2026-10-01")).toBeNull();
    const sheets = [
      { name: "9月", rows: null, dataRows: 40 },
      { name: "10月", rows: null, dataRows: 12 },
      { name: "メモ", rows: null, dataRows: 0 },
    ];
    expect(chooseSheet(sheets)).toBe(0);
    expect(chooseSheet(sheets, "2026-10-01")).toBe(1);
    expect(chooseSheet(sheets, "2026-11-01")).toBe(0);
  });
});

describe("台帳に無い人をまとめて登録する", () => {
  it("当たらない名前だけを登録し（番号の列があれば番号も）、一部だけ当たった人は登録しない。別の会社からは触れない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: other } = await seedDemo(db);
    const file = [
      "番号,ドライバー,コース,個数",
      "D11,山田 花子,宅配,100",
      "D12,鈴木 一郎（応援）,宅配,50",
      ",田中 次郎,夜間,3",
      "D01,青木 翔太,宅配,10",
      ",青木 翔太郎,宅配,5",
    ].join("\n");
    const d = await createDraftFromFile(db, tenantId, user, { fileName: "新しい人_2026年11月.csv", bytes: csv(file), pageMonth: DEMO_MONTH });
    const v = (await loadDraftView(db, tenantId, d.id))!;
    expect(v.computed.resolution.unresolvedRecords).toBe(4);

    await expect(registerAllDrivers(db, other, d.id)).rejects.toThrow("見つかりません");
    const out = await registerAllDrivers(db, tenantId, d.id);
    expect(out.created.map((x) => x.name).sort()).toEqual(["山田 花子", "田中 次郎", "鈴木 一郎"].sort());
    const mine = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
    expect(mine.find((x) => x.name === "山田 花子")).toMatchObject({ code: "D11" });
    expect(mine.find((x) => x.name === "鈴木 一郎")).toMatchObject({ code: "D12", aliases: ["鈴木 一郎（応援）"] });
    expect(mine.find((x) => x.name === "田中 次郎")?.code).toBeNull();
    expect(mine.some((x) => x.name.startsWith("青木 翔太郎"))).toBe(false);
    expect((await db.select().from(s.drivers).where(eq(s.drivers.tenantId, other))).length).toBe(8);

    const v2 = (await loadDraftView(db, tenantId, d.id))!;
    // 残りは「青木 翔太郎」（青木 翔太さんの書き間違いか、別の人か）だけ
    expect(v2.computed.resolution.unresolvedRecords).toBe(1);
    expect(v2.summary.learned.filter((l) => l.how === "new")).toHaveLength(3);
    await expect(registerAllDrivers(db, tenantId, d.id)).rejects.toThrow("まとめて登録できる名前はありません");
    await client.close();
  });
});

describe("何月分か（締め日が月末でない表）", () => {
  const known: Known = { drivers: [{ id: "d1", name: "青木 翔太", active: true }], projects: [{ id: "p1", name: "宅配", unit: "個", active: true }] };
  const table = (title: string, dates: string[]) => [[title], ["日付", "ドライバー", "コース", "個数"], ...dates.map((d) => [d, "青木 翔太", "宅配", "10"])];
  const days = (m: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${m}/${from + i}`);

  it("10 日締めの「2027年1月分」（12/11〜1/10）は、日付の多い 12 月ではなく、書いてある 1 月にする。年の無い 12/11 は 2026 年として読む", () => {
    const rows = table("2027年1月分 稼働表", [...days(12, 11, 31), ...days(1, 1, 10)]);
    const g = guessMapping(rows, known);
    expect(suggestMonth(rows, g.mapping, "稼働.xlsx")).toEqual({ month: "2027-01-01", from: "title" });
  });

  it("表題を写し忘れた表（表題は 10 月、日付はすべて 11 月）は、日付に従う", () => {
    const rows = table("2026年10月分 稼働表", days(11, 1, 30));
    const g = guessMapping(rows, known);
    expect(suggestMonth(rows, g.mapping, "稼働.xlsx")).toEqual({ month: "2026-11-01", from: "dates" });
  });
});
