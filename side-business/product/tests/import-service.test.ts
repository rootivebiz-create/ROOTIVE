import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import {
  applyBatch,
  createDraftFromFile,
  discardDraft,
  listBatches,
  loadDraftView,
  readSampleFile,
  resolveName,
  setBatchMonth,
  undoBatch,
  updateMapping,
} from "~/server/features/import/service";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

const user = { id: null };

async function monthWork(db: Db, tenantId: string, month = DEMO_MONTH) {
  return db
    .select()
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month)));
}

async function driverId(db: Db, tenantId: string, code: string) {
  const [d] = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d.id;
}

async function draftFromSample(db: Db, tenantId: string, key: "long" | "wide") {
  const { fileName, bytes } = await readSampleFile(key);
  return createDraftFromFile(db, tenantId, user, { fileName, bytes, pageMonth: DEMO_MONTH, sample: true });
}

function csv(text: string) {
  return new TextEncoder().encode(text);
}

/** 振込額（明細の計算そのもの） */
async function totals(db: Db, tenantId: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
  return Object.fromEntries(drafts.map((d) => [d.driver.code, d.total]));
}

describe("取り込み：見本のファイルを反映する", () => {
  it("縦持ち：合計 5,205 と一致 → 手入力の分と重なるので止まる → すべて入れ替えると明細の金額は 1 円も変わらない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const before = await totals(db, tenantId);
    expect(before.D01).toBe(357555);

    const { id, month } = await draftFromSample(db, tenantId, "long");
    expect(month).toBe(DEMO_MONTH);
    const view = (await loadDraftView(db, tenantId, id))!;
    expect(view.blockers).toEqual([]);
    expect(view.summary.mappingFrom).toBe("guess");
    expect(view.computed.parse.checks[0]).toMatchObject({ expected: 5205, actual: 5205, ok: true });
    expect(view.stats).toMatchObject({ records: 11, totalQty: 5205, drivers: 8, projects: 5, unresolved: 0 });
    // すでにある 10 月の稼働（手入力 11 行）と重なる
    expect(view.preview!.modes.replace.duplicates).toHaveLength(11);
    expect(view.preview!.modes.replace.duplicateYen).toBeGreaterThan(0);
    expect(view.preview!.modes.replaceAll.removeManual).toBe(11);
    expect(view.preview!.modes.replaceAll.duplicates).toHaveLength(0);
    // 先月より大きく減った人（木村 1300 → 380）に印
    const kimura = view.preview!.compare.find((r) => r.driverName === "木村 誠")!;
    expect(kimura).toMatchObject({ prev: 1300, now: 380, flag: "down" });

    await expect(applyBatch(db, tenantId, user, id, { mode: "replace", confirmDuplicates: false })).rejects.toThrow("重なる");
    const all = (await loadDraftView(db, tenantId, id, { mode: "replaceAll" }))!;
    expect(all.preview!.statements).toEqual([]);
    expect(all.preview!.unchangedStatements).toBe(8);

    const res = await applyBatch(db, tenantId, user, id, { mode: "replaceAll", confirmDuplicates: false });
    expect(res).toMatchObject({ entries: 11, removedEntries: 11 });
    const work = await monthWork(db, tenantId);
    expect(work).toHaveLength(11);
    expect(work.every((w) => w.importBatchId === id && w.workDate === null)).toBe(true);
    expect(await totals(db, tenantId)).toEqual(before);

    // 同じ形を覚えた：もう一度置くと「前回の読み方」
    const again = await draftFromSample(db, tenantId, "long");
    const v2 = (await loadDraftView(db, tenantId, again.id))!;
    expect(v2.summary.mappingFrom).toBe("profile");
    expect(v2.preview!.modes.replace.removeBatches.map((b) => b.id)).toEqual([id]);
    expect(v2.preview!.modes.replace.duplicates).toEqual([]);
    // 足すなら「同じファイル」で止まる
    await expect(applyBatch(db, tenantId, user, again.id, { mode: "add", confirmDuplicates: true })).rejects.toThrow("倍");
    // 入れ替えれば倍にならない
    await applyBatch(db, tenantId, user, again.id, { mode: "replace", confirmDuplicates: false });
    expect(await monthWork(db, tenantId)).toHaveLength(11);
    expect(await totals(db, tenantId)).toEqual(before);
    const history = await listBatches(db, tenantId, DEMO_MONTH);
    expect(history.map((h) => [h.id, h.status, h.discardedReason])).toEqual([
      [again.id, "applied", null],
      [id, "discarded", "replaced"],
    ]);

    // 取り消し：2 回目を取り消すと 1 回目が戻る。1 回目を取り消すと元の手入力が戻る
    const u2 = await undoBatch(db, tenantId, user, again.id);
    expect(u2).toMatchObject({ deleted: 11, restored: 11 });
    expect((await monthWork(db, tenantId)).every((w) => w.importBatchId === id)).toBe(true);
    const u1 = await undoBatch(db, tenantId, user, id);
    expect(u1).toMatchObject({ deleted: 11, restored: 11 });
    const back = await monthWork(db, tenantId);
    expect(back).toHaveLength(11);
    expect(back.every((w) => w.importBatchId === null)).toBe(true);
    expect(await totals(db, tenantId)).toEqual(before);
    await expect(undoBatch(db, tenantId, user, id)).rejects.toThrow("反映済みの取り込みだけ");
    await client.close();
  });

  it("横持ち：縦持ちと同じドライバー × 案件の数量になる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const before = await totals(db, tenantId);
    const { id } = await draftFromSample(db, tenantId, "wide");
    const view = (await loadDraftView(db, tenantId, id, { mode: "replaceAll" }))!;
    expect(view.blockers).toEqual([]);
    expect(view.computed.parse.checks).toEqual([expect.objectContaining({ ok: true, expected: 5205 })]);
    expect(view.summary.monthFrom).toBe("title");
    const flat = Object.fromEntries(view.totals.byDriver.flatMap((d) => d.lines.map((l) => [`${d.name}|${l.name}`, l.qty])));
    expect(flat).toMatchObject({
      "青木 翔太|宅配（個建て）": 2310,
      "青木 翔太|スポット便": 4,
      "岡田 拓也|企業配（日当）": 18,
      "岡田 拓也|宅配（個建て）": 420,
      "加藤 由美|夜間便": 20,
    });
    await applyBatch(db, tenantId, user, id, { mode: "replaceAll", confirmDuplicates: false });
    expect(await monthWork(db, tenantId)).toHaveLength(11);
    expect(await totals(db, tenantId)).toEqual(before);
    await client.close();
  });
});

describe("取り込み：同じひな形の別のファイル", () => {
  it("形が同じでも、人と案件が重ならないファイルは入れ替えずに残す", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const first = await draftFromSample(db, tenantId, "long");
    await applyBatch(db, tenantId, user, first.id, { mode: "replaceAll", confirmDuplicates: false });
    const other = await createDraftFromFile(db, tenantId, user, {
      fileName: "B商事_追加分.csv",
      bytes: csv("No,日付,ドライバー,コース,個数・日数,備考\n1,2026/10/31,井上 美咲,夜間,3,\n"),
      pageMonth: DEMO_MONTH,
    });
    const v = (await loadDraftView(db, tenantId, other.id))!;
    expect(v.summary.mappingFrom).toBe("profile");
    expect(v.preview!.mode).toBe("replace");
    expect(v.preview!.modes.replace.removeBatches).toEqual([]);
    expect(v.preview!.modes.replace.keptSameShape).toEqual(["稼働_縦持ち_2026年10月.xlsx"]);
    await applyBatch(db, tenantId, user, other.id, { mode: "replace", confirmDuplicates: false });
    expect(await monthWork(db, tenantId)).toHaveLength(12);
    expect((await listBatches(db, tenantId, DEMO_MONTH)).filter((b) => b.status === "applied")).toHaveLength(2);
    await client.close();
  });
});

describe("取り込み：名前・月・読み方", () => {
  it("見出し「企業配（日当）」はそのまま当たる。当たらない名前は候補つきで出て、選ぶと覚える", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const file = "氏名,企業配（日当）,待機料（時間）\n井上 美咲,21,2\n井上さん,1,0\n佐藤 亮,22,0\n";
    const d1 = await createDraftFromFile(db, tenantId, user, { fileName: "B商事_2026年11月.csv", bytes: csv(file), pageMonth: DEMO_MONTH });
    expect(d1.month).toBe("2026-11-01");
    const v1 = (await loadDraftView(db, tenantId, d1.id))!;
    const { drivers, projects } = v1.computed.resolution;
    expect(projects.find((p) => p.raw === "企業配（日当）")?.match?.name).toBe("企業配（日当）");
    const waiting = projects.find((p) => p.raw === "待機料（時間）")!;
    expect(waiting.match).toBeNull();
    const san = drivers.find((d) => d.raw === "井上さん")!;
    expect(san.match).toBeNull();
    expect(san.candidates[0].name).toBe("井上 美咲");
    expect(v1.blockers.join()).toContain("名前が決まっていない行");

    const inoue = await driverId(db, tenantId, "D02");
    const r = await resolveName(db, tenantId, d1.id, { kind: "driver", key: san.key, action: "match", targetId: inoue });
    expect(r.message).toContain("覚えました");
    const [row] = await db.select().from(s.drivers).where(eq(s.drivers.id, inoue));
    expect(row.aliases).toContain("井上さん");
    // 案件は新しく登録する（単位は見出しの括弧から）
    await resolveName(db, tenantId, d1.id, {
      kind: "project",
      key: waiting.key,
      action: "create",
      name: "待機料",
      unit: "時間",
      billRate: 2000,
      payRate: 1500,
      clientId: null,
    });
    const v2 = (await loadDraftView(db, tenantId, d1.id))!;
    expect(v2.blockers).toEqual([]);
    expect(v2.summary.learned.map((l) => [l.kind, l.name, l.how])).toEqual([
      ["driver", "井上 美咲", "alias"],
      ["project", "待機料", "new"],
    ]);
    const inoueLines = v2.totals.byDriver.find((d) => d.driverId === inoue)!.lines;
    expect(inoueLines).toEqual([expect.objectContaining({ name: "企業配（日当）", qty: 22 }), expect.objectContaining({ name: "待機料", qty: 2 })]);

    // 次に同じ書き方のファイルを置くと、聞かずに当たる
    const d2 = await createDraftFromFile(db, tenantId, user, { fileName: "B商事_2026年12月.csv", bytes: csv(file), pageMonth: DEMO_MONTH });
    const v3 = (await loadDraftView(db, tenantId, d2.id))!;
    expect(v3.computed.resolution.unresolvedRecords).toBe(0);
    expect(v3.computed.resolution.drivers.find((d) => d.raw === "井上さん")?.match?.how).toBe("alias");
    await client.close();
  });

  it("「取り込まない」にした名前の行は外す。戻すこともできる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const d = await createDraftFromFile(db, tenantId, user, {
      fileName: "x.csv",
      bytes: csv("ドライバー,コース,個数\n青木 翔太,宅配,100\n応援 太郎,宅配,30\n"),
      pageMonth: "2026-11-01",
    });
    const v = (await loadDraftView(db, tenantId, d.id))!;
    const ouen = v.computed.resolution.drivers.find((g) => g.raw === "応援 太郎")!;
    await resolveName(db, tenantId, d.id, { kind: "driver", key: ouen.key, action: "skip" });
    const v2 = (await loadDraftView(db, tenantId, d.id))!;
    expect(v2.blockers).toEqual([]);
    expect(v2.computed.resolution).toMatchObject({ skippedRecords: 1, skippedQty: 30 });
    await resolveName(db, tenantId, d.id, { kind: "driver", key: ouen.key, action: "unskip" });
    expect((await loadDraftView(db, tenantId, d.id))!.computed.resolution.unresolvedRecords).toBe(1);
    // 新しく登録する
    await resolveName(db, tenantId, d.id, { kind: "driver", key: ouen.key, action: "create", name: "応援 太郎", kana: "オウエン タロウ", code: "D09" });
    const res = await applyBatch(db, tenantId, user, d.id, { mode: "replace", confirmDuplicates: false });
    expect(res.entries).toBe(2);
    await client.close();
  });

  it("締めた月（2026年9月）には反映できない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { id } = await draftFromSample(db, tenantId, "long");
    await setBatchMonth(db, tenantId, id, DEMO_PREV_MONTH);
    const view = (await loadDraftView(db, tenantId, id))!;
    expect(view.closed).toBe(true);
    expect(view.blockers[0]).toContain("締め済み");
    await expect(applyBatch(db, tenantId, user, id, { mode: "replaceAll", confirmDuplicates: true })).rejects.toThrow("締め済み");
    expect(await monthWork(db, tenantId, DEMO_PREV_MONTH)).toHaveLength(11);
    await client.close();
  });

  it("案件の列が無い表：「すべて同じ案件」を選ぶと読める。数の列が無い表は理由を出す", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const d = await createDraftFromFile(db, tenantId, user, {
      fileName: "夜間_2026年11月.csv",
      bytes: csv("氏名,便数\n加藤 由美,19\n"),
      pageMonth: DEMO_MONTH,
    });
    const v = (await loadDraftView(db, tenantId, d.id))!;
    expect(v.blockers.join()).toContain("すべて同じ案件");
    const [night] = await db
      .select()
      .from(s.projects)
      .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "夜間便")));
    const r = await updateMapping(db, tenantId, d.id, { roles: v.summary.mapping.roles, fixedProjectId: night.id, useDates: false, remember: true });
    expect(r.problem).toBeNull();
    const v2 = (await loadDraftView(db, tenantId, d.id))!;
    expect(v2.blockers).toEqual([]);
    expect(v2.totals.byProject).toEqual([expect.objectContaining({ name: "夜間便", qty: 19 })]);

    const n = await createDraftFromFile(db, tenantId, user, { fileName: "名簿.csv", bytes: csv("氏名,コース\n加藤 由美,夜間\n"), pageMonth: DEMO_MONTH });
    const nv = (await loadDraftView(db, tenantId, n.id))!;
    expect(nv.blockers.join()).toContain("数");
    await discardDraft(db, tenantId, user, n.id);
    expect((await loadDraftView(db, tenantId, n.id))!.batch.status).toBe("discarded");
    await client.close();
  });

  it("読めないファイルは、次にすることを添えて断る", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const up = (fileName: string, text = "a,b\n1,2") => createDraftFromFile(db, tenantId, user, { fileName, bytes: csv(text), pageMonth: DEMO_MONTH });
    await expect(up("稼働.xls")).rejects.toThrow("名前を付けて保存");
    await expect(up("支払通知.pdf")).rejects.toThrow("CSV");
    await expect(up("空.csv", "")).rejects.toThrow("空");
    await expect(up("写真.jpg")).rejects.toThrow("画像");
    await expect(up("壊れた.xlsx", "PK\u0003\u0004 broken")).rejects.toThrow("開けません");
    await client.close();
  });
});

describe("取り込み：ほかの会社のデータ", () => {
  it("別の会社の取り込み・ドライバー・案件は、読めず・使えず・変えられない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId: t1 } = await seedDemo(db);
    const { tenantId: t2 } = await seedDemo(db);
    const d1 = await createDraftFromFile(db, t1, user, { fileName: "x.csv", bytes: csv("ドライバー,コース,個数\n山田 花子,宅配,5\n"), pageMonth: DEMO_MONTH });
    const v = (await loadDraftView(db, t1, d1.id))!;
    const key = v.computed.resolution.drivers[0].key;
    const other = await driverId(db, t2, "D01");
    const [otherProject] = await db.select().from(s.projects).where(eq(s.projects.tenantId, t2));

    await expect(resolveName(db, t1, d1.id, { kind: "driver", key, action: "match", targetId: other })).rejects.toThrow("見つかりません");
    await expect(
      updateMapping(db, t1, d1.id, { roles: v.summary.mapping.roles, fixedProjectId: otherProject.id, useDates: false, remember: false }),
    ).rejects.toThrow("見つかりません");
    // 別の会社からは、この取り込みは見えない・触れない
    expect(await loadDraftView(db, t2, d1.id)).toBeNull();
    await expect(applyBatch(db, t2, user, d1.id, { mode: "add", confirmDuplicates: true })).rejects.toThrow("見つかりません");
    await expect(resolveName(db, t2, d1.id, { kind: "driver", key, action: "skip" })).rejects.toThrow("見つかりません");
    expect(await listBatches(db, t2, DEMO_MONTH)).toEqual([]);
    // 別の会社のドライバーの別名は変わっていない
    const [o] = await db.select().from(s.drivers).where(eq(s.drivers.id, other));
    expect(o.aliases).not.toContain("山田 花子");

    // 反映しても、別の会社の稼働は変わらない
    const long = await draftFromSample(db, t1, "long");
    await applyBatch(db, t1, user, long.id, { mode: "replaceAll", confirmDuplicates: false });
    const t2work = await monthWork(db, t2);
    expect(t2work).toHaveLength(11);
    expect(t2work.every((w) => w.importBatchId === null)).toBe(true);
    await expect(undoBatch(db, t2, user, long.id)).rejects.toThrow("見つかりません");
    // 手入力の稼働は、別の会社には無い
    const manual = await db
      .select()
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, t1), isNull(s.workEntries.importBatchId)));
    expect(manual).toHaveLength(11); // 9 月の分だけ残る
    await client.close();
  });
});
