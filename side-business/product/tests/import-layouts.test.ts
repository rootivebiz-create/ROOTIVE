import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  findProfile,
  guessMapping,
  mappingProblem,
  marksText,
  parseMarks,
  profileData,
  sheetDriverMatch,
  sheetDriverName,
  shapeSignature,
} from "~/server/features/import/detect";
import { parseWithMapping } from "~/server/features/import/parse";
import { resolveRecords, type Known } from "~/server/features/import/resolve";
import {
  applyBatch,
  createDraftFromFile,
  loadDraftView,
  registerAllDrivers,
  undoBatch,
  updateMapping,
} from "~/server/features/import/service";
import { DEFAULT_MARKS, type WorkMapping } from "~/server/features/import/types";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 取り込み：いろいろな形の Excel（C02）
 * - ○・出・休 などの印（数え方を読み方に持ち、覚える）
 * - 人が横に並ぶ表（行が日付、列がドライバー）
 * - 1 人 1 枚の表（「この表はすべて同じ人」。シートの名前・表題から当てる。覚えた読み方でも前の人を当てない）
 * - シートごとに別の人のブック（同じ形のシートをすべて読む）
 */

const known: Known = {
  drivers: [
    { id: "d1", code: "D01", name: "青木 翔太", kana: "アオキ ショウタ", active: true },
    { id: "d3", code: "D03", name: "上田 健", kana: "ウエダ ケン", active: true },
  ],
  projects: [
    { id: "p1", name: "宅配（個建て）", aliases: ["宅配", "個建"], unit: "個", active: true },
    { id: "p2", name: "企業配（日当）", aliases: ["企業配", "日当"], unit: "日", active: true },
  ],
};
const noSkip = { drivers: [], projects: [] };
const user = { id: null };

describe("印（○・出・休）", () => {
  it("日付が横に並ぶ表の ○・休 を、既定の数え方（○＝1・休＝0）で読み、行の「計」とも照らす", () => {
    const rows = [
      ["氏名", "コース", "1", "2", "3", "計"],
      ["青木 翔太", "企業配", "○", "休", "出", "2"],
      ["上田 健", "企業配", "◯", "○", "×", "2"],
    ];
    const g = guessMapping(rows, known);
    expect(g.mapping.roles).toEqual(["driver", "project", "value", "value", "value", "ignore"]);
    expect(g.mapping.marks).toEqual(DEFAULT_MARKS);
    expect(g.notes.join("")).toContain("「○」「出」などの印を 1");
    const p = parseWithMapping(rows, g.mapping, DEMO_MONTH);
    expect(p.problem).toBeNull();
    expect(p.records.map((r) => [r.driver, r.date, r.qty])).toEqual([
      ["青木 翔太", "2026-10-01", 1],
      ["青木 翔太", "2026-10-03", 1],
      ["上田 健", "2026-10-01", 1],
      ["上田 健", "2026-10-02", 1],
    ]);
    expect(p.emptyCells).toBe(2);
    expect(p.checks.map((c) => c.ok)).toEqual([true]);
    // 数え方が無ければ、印は読めないセルとして番地つきで出る（今までどおり）
    const plain = parseWithMapping(rows, { ...g.mapping, marks: null }, DEMO_MONTH);
    expect(plain.skipped.some((x) => x.reason.includes("C2「○」は数字ではありません"))).toBe(true);
  });

  it("数え方は「○=1, 出=1, 休=0」の形で直せる。読めない書き方は理由を返す", () => {
    expect(parseMarks("○=1, 出=0.5、休=0")).toEqual({ marks: { "○": 1, 出: 0.5, 休: 0 }, error: null });
    expect(parseMarks("")).toEqual({ marks: null, error: null });
    expect(parseMarks("○は1").error).toContain("「○は1」が読めません");
    expect(parseMarks("○=5000").error).toContain("0 から 1000");
    expect(marksText({ "○": 1, 休: 0 })).toBe("○=1, 休=0");
  });
});

describe("人が横に並ぶ表（行が日付、列がドライバー）", () => {
  const rows = [
    ["日付", "青木 翔太", "上田 健", "計"],
    ["2026/10/1", "120", "80", "200"],
    ["2026/10/2", "100", "", "100"],
    ["合計", "220", "80", "300"],
  ];

  it("見出しが台帳のドライバーの名前なら、人ごとの数として読む。案件は「すべて同じ案件」で決める", () => {
    const g = guessMapping(rows, known);
    expect(g.mapping.roles).toEqual(["date", "driverValue", "driverValue", "ignore"]);
    expect(g.mapping.useDates).toBe(true);
    expect(mappingProblem(g.mapping)).toBeNull();
    expect(parseWithMapping(rows, g.mapping, DEMO_MONTH).problem).toContain("人が横に並ぶ表です");
    const mapping = { ...g.mapping, fixedProjectId: "p1" };
    const p = parseWithMapping(rows, mapping, DEMO_MONTH);
    expect(p.records.map((r) => [r.driver, r.date, r.qty])).toEqual([
      ["青木 翔太", "2026-10-01", 120],
      ["上田 健", "2026-10-01", 80],
      ["青木 翔太", "2026-10-02", 100],
    ]);
    // 合計の行（人ごと）と「計」の列（日ごと）の両方と照らす
    expect(p.checks.map((c) => c.ok)).toEqual([true, true]);
    const res = resolveRecords(p.records, known, "p1", noSkip);
    expect(res.unresolvedRecords).toBe(0);
    expect(res.resolved.map((r) => r.driverId)).toEqual(["d1", "d3", "d1"]);
  });

  it("人の列と、見出しが人の名前の列・数量の列は、どちらか一方にする", () => {
    const base: WorkMapping = { headerRow: 0, headerDepth: 1, roles: ["driver", "driverValue", "driverValue", "ignore"], fixedProjectId: "p1", useDates: false };
    expect(mappingProblem(base)).toContain("どちらか一方");
    expect(mappingProblem({ ...base, roles: ["date", "driverValue", "qty", "ignore"] })).toContain("どちらか一方");
  });
});

describe("1 人 1 枚の表・シートごとに別の人（純）", () => {
  it("シートの名前・表題の「氏名：〇〇」から人の名前を読む（Sheet1・月の名前・集計は人ではない）", () => {
    const rows = [["氏名：上田 健 様", ""], ["日付", "個数"], ["10/1", "90"]];
    expect(sheetDriverName("Sheet1", rows, 1)).toBe("上田 健");
    expect(sheetDriverName("青木 翔太", [["日付", "個数"]], 0)).toBe("青木 翔太");
    expect(sheetDriverName("10月", [["日付", "個数"]], 0)).toBeNull();
    expect(sheetDriverName("集計", [["日付", "個数"]], 0)).toBeNull();
    expect(sheetDriverName("Sheet2", [["日付", "個数"]], 0)).toBeNull();
    expect(sheetDriverMatch("Sheet1", rows, 1, known)).toEqual({ id: "d3", name: "上田 健" });
    // 名前の一部だけ（「上田」）は当てない（別の人に入れないように）
    expect(sheetDriverMatch("上田", [["日付", "個数"]], 0, known)).toBeNull();
  });

  it("「この表はすべて同じ人」：人の列が無くても読め、その人に当てる。人の列と一緒には使えない", () => {
    const rows = [
      ["日付", "コース", "個数"],
      ["10/1", "宅配", "90"],
      ["10/2", "宅配", "85"],
    ];
    const g = guessMapping(rows, known, { driverHint: { fixedDriverId: "d3" } });
    expect(g.mapping.roles).toEqual(["date", "project", "qty"]);
    expect(g.mapping.fixedDriverId).toBe("d3");
    const p = parseWithMapping(rows, g.mapping, DEMO_MONTH);
    expect(p.records).toHaveLength(2);
    const res = resolveRecords(p.records, known, null, noSkip, "d3");
    expect(res.resolved.map((r) => [r.driverId, r.projectId, r.qty])).toEqual([
      ["d3", "p1", 90],
      ["d3", "p1", 85],
    ]);
    expect(res.drivers).toEqual([]);
    expect(resolveRecords(p.records, known, null, noSkip, "gone").fixedDriverMissing).toBe(true);
    // 手がかりが無ければ、人の列が決まらない（案件の列を人とみなさない）→ 選んでもらう
    const none = guessMapping(rows, known);
    expect(mappingProblem(none.mapping)).toContain("この表はすべて同じ人");
    expect(mappingProblem({ ...g.mapping, roles: ["driver", "project", "qty"] })).toContain("「使わない」");
  });

  it("覚えた読み方：印の数え方・シートごと・調整の列は覚え、「すべて同じ人」は覚えない（前の人を当てない）", () => {
    const header = ["日付", "コース", "個数", "燃料代"];
    const rows = [header, ["10/1", "宅配", "90", "1200"]];
    const mapping: WorkMapping = {
      headerRow: 0,
      headerDepth: 1,
      roles: ["date", "project", "qty", "ignore"],
      fixedProjectId: null,
      useDates: true,
      fixedDriverId: "d3",
      marks: { "○": 1 },
      sheetDrivers: true,
      adjust: [{ col: 3, label: "燃料代", sign: "minus", taxable: true, agreedInWriting: false, basis: null }],
    };
    const data = profileData(header, mapping);
    expect(data.options).not.toHaveProperty("fixedDriverId");
    const found = findProfile(rows, [{ id: "p", headerSignature: shapeSignature(header), ...data }])!;
    expect(found.mapping.fixedDriverId).toBeUndefined();
    expect(found.mapping.marks).toEqual({ "○": 1 });
    expect(found.mapping.sheetDrivers).toBe(true);
    expect(found.mapping.adjust).toEqual([{ col: 3, label: "燃料代", sign: "minus", taxable: true, agreedInWriting: false, basis: null }]);
  });
});

// ---------------------------------------------------------------- DB

async function book(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    for (const r of sh.rows) ws.addRow(r);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function batchEntries(db: Db, tenantId: string, batchId: string) {
  return db
    .select()
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.importBatchId, batchId)));
}

async function driverIdOf(db: Db, tenantId: string, name: string) {
  const [d] = await db
    .select({ id: s.drivers.id })
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.name, name)));
  return d?.id;
}

describe("1 人 1 枚の表・シートごとに別の人（DB）", () => {
  it("シートの名前が台帳の人なら、その人の表として読んで反映する。同じ形の別の人の表は、覚えた読み方でも新しい人に当て直す", async () => {
    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const one = (name: string, qty: number) => [
      { name, rows: [["2026年11月 稼働表"], ["日付", "コース", "個数"], ["11/1", "宅配", qty], ["11/2", "宅配", qty]] },
    ];
    const first = await createDraftFromFile(db, tenantId, user, { fileName: "上田.xlsx", bytes: await book(one("上田 健", 90)), pageMonth: DEMO_MONTH });
    expect(first.month).toBe("2026-11-01");
    const v1 = (await loadDraftView(db, tenantId, first.id))!;
    expect(v1.summary.mapping.fixedDriverId).toBe(await driverIdOf(db, tenantId, "上田 健"));
    expect(v1.blockers).toEqual([]);
    await applyBatch(db, tenantId, user, first.id, { mode: "add", confirmDuplicates: false });
    const e1 = await batchEntries(db, tenantId, first.id);
    expect(e1.map((e) => e.qty)).toEqual([90, 90]);
    expect(new Set(e1.map((e) => e.driverId))).toEqual(new Set([await driverIdOf(db, tenantId, "上田 健")]));

    // 同じ形の青木さんの表：覚えた読み方で読むが、人は青木さんに当て直す
    const second = await createDraftFromFile(db, tenantId, user, { fileName: "青木.xlsx", bytes: await book(one("青木 翔太", 70)), pageMonth: DEMO_MONTH });
    const v2 = (await loadDraftView(db, tenantId, second.id))!;
    expect(v2.summary.mappingFrom).toBe("profile");
    expect(v2.summary.mapping.fixedDriverId).toBe(await driverIdOf(db, tenantId, "青木 翔太"));

    // 人が分からない表（Sheet1）は、選ぶまで反映できない。選べば読める
    const third = await createDraftFromFile(db, tenantId, user, {
      fileName: "だれか.xlsx",
      bytes: await book([{ name: "Sheet1", rows: [["2026年11月 稼働表"], ["日付", "コース", "個数"], ["11/1", "宅配", 50]] }]),
      pageMonth: DEMO_MONTH,
    });
    const v3 = (await loadDraftView(db, tenantId, third.id))!;
    expect(v3.blockers.join("")).toContain("この表はすべて同じ人");
    const kimura = (await driverIdOf(db, tenantId, "木村 誠"))!;
    await updateMapping(db, tenantId, third.id, { roles: v3.summary.mapping.roles, fixedProjectId: null, useDates: true, remember: false, fixedDriverId: kimura });
    const v3b = (await loadDraftView(db, tenantId, third.id))!;
    expect(v3b.blockers).toEqual([]);
    expect(v3b.computed.resolution.resolved.map((r) => r.driverId)).toEqual([kimura]);
  });

  it("シートごとに別の人のブック：同じ形のシートをすべて読み、台帳に無い人はまとめて登録できる。形の違うシートは読まない", async () => {
    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const sheet = (name: string, qty: number) => ({ name, rows: [["日付", "コース", "個数"], ["11/1", "宅配", qty], ["11/2", "企業配", 1]] });
    const bytes = await book([
      { name: "集計", rows: [["氏名", "合計"], ["青木 翔太", 999]] },
      sheet("青木 翔太", 100),
      sheet("上田 健", 80),
      sheet("新人 花子", 60),
    ]);
    const { id, month } = await createDraftFromFile(db, tenantId, user, { fileName: "人ごと_2026年11月.xlsx", bytes, pageMonth: DEMO_MONTH });
    expect(month).toBe("2026-11-01");
    let view = (await loadDraftView(db, tenantId, id))!;
    expect(view.summary.mapping.sheetDrivers).toBe(true);
    expect(view.summary.mapping.roles).toEqual(["date", "project", "qty"]);
    expect(view.computed.parse.records).toHaveLength(6);
    expect(view.computed.parse.records[0].cell).toMatch(/!C2$/);
    // 台帳に無い「新人 花子」だけが名前の確認に出る
    expect(view.computed.resolution.drivers.filter((g) => !g.match).map((g) => g.raw)).toEqual(["新人 花子"]);
    await registerAllDrivers(db, tenantId, id);
    view = (await loadDraftView(db, tenantId, id))!;
    expect(view.blockers).toEqual([]);
    expect(view.stats).toMatchObject({ records: 6, drivers: 3, totalQty: 243 });
    await applyBatch(db, tenantId, user, id, { mode: "add", confirmDuplicates: false });
    const entries = await batchEntries(db, tenantId, id);
    expect(entries).toHaveLength(6);
    const hanako = (await driverIdOf(db, tenantId, "新人 花子"))!;
    expect(entries.filter((e) => e.driverId === hanako).map((e) => e.qty).sort()).toEqual([1, 60]);
    // 取り消すと、すべてのシートの分が消える
    const undone = await undoBatch(db, tenantId, user, id);
    expect(undone.deleted).toBe(6);
  });
});

describe("印の列の見分け", () => {
  it("見出しが日付・案件・数量でない「確認」の ○ の列は、数として読まない（数量の列はそのまま）", () => {
    const rows = [
      ["氏名", "宅配", "確認"],
      ["青木 翔太", "120", "○"],
      ["上田 健", "80", "○"],
    ];
    const g = guessMapping(rows, known);
    expect(g.mapping.roles).toEqual(["driver", "qty", "ignore"]);
    expect(g.mapping.marks).toBeUndefined();
  });
});
