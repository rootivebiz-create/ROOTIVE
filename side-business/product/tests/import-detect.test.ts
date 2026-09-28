import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  colLetter,
  dayColumnDates,
  dayOfHeader,
  detectHeaderDepth,
  findProfile,
  guessMapping,
  monthInText,
  profileData,
  shapeSignature,
  suggestMonth,
  unitHint,
} from "~/server/features/import/detect";
import { parseWithMapping, unreadableQty } from "~/server/features/import/parse";
import { compareWithPrev, resolveRecords, totalsOf, type Known } from "~/server/features/import/resolve";
import { parseCsv, readTable } from "~/server/tabular";

const samples = path.join(__dirname, "..", "public", "samples");

/** デモの台帳と同じ名前（id は仮） */
const known: Known = {
  drivers: [
    { id: "d1", code: "D01", name: "青木 翔太", kana: "アオキ ショウタ", active: true },
    { id: "d2", code: "D02", name: "井上 美咲", kana: "イノウエ ミサキ", active: true },
    { id: "d3", code: "D03", name: "上田 健", kana: "ウエダ ケン", active: true },
    { id: "d4", code: "D04", name: "遠藤 大輔", kana: "エンドウ ダイスケ", active: true },
    { id: "d5", code: "D05", name: "岡田 拓也", kana: "オカダ タクヤ", active: true },
    { id: "d6", code: "D06", name: "加藤 由美", kana: "カトウ ユミ", active: true },
    { id: "d7", code: "D07", name: "木村 誠", kana: "キムラ マコト", active: true },
    { id: "d8", code: "D08", name: "佐藤 亮", kana: "サトウ リョウ", active: true },
  ],
  projects: [
    { id: "p1", name: "宅配（個建て）", aliases: ["宅配", "個建"], unit: "個", active: true },
    { id: "p2", name: "企業配（日当）", aliases: ["企業配", "日当"], unit: "日", active: true },
    { id: "p3", name: "スポット便", aliases: ["スポット"], unit: "件", active: true },
    { id: "p4", name: "ルート配送（時給）", aliases: ["ルート"], unit: "時間", active: true },
    { id: "p5", name: "夜間便", aliases: ["夜間"], unit: "便", active: true },
  ],
};

const noSkip = { drivers: [], projects: [] };

async function sheetOf(file: string) {
  const { sheets } = await readTable(file, fs.readFileSync(path.join(samples, file)));
  return sheets[0].rows;
}

function pairs(rows: string[][], month = "2026-10-01") {
  const g = guessMapping(rows, known);
  const parsed = parseWithMapping(rows, g.mapping, month);
  const res = resolveRecords(parsed.records, known, g.mapping.fixedProjectId, noSkip);
  const totals = totalsOf(res.resolved, known);
  const flat: Record<string, number> = {};
  for (const d of totals.byDriver) for (const l of d.lines) flat[`${d.name}|${l.name}`] = l.qty;
  return { g, parsed, res, totals, flat };
}

describe("見本の 2 つのファイル", () => {
  it("縦持ち：見出し・列の役目・合計行の照合", async () => {
    const rows = await sheetOf("稼働_縦持ち_2026年10月.xlsx");
    const { g, parsed, res, flat } = pairs(rows);
    expect(g.mapping.headerRow).toBe(3);
    expect(g.mapping.roles).toEqual(["ignore", "date", "driver", "project", "qty", "note"]);
    // 日付はすべて 10/31（集計した日）なので、日ごとには分けない
    expect(g.mapping.useDates).toBe(false);
    expect(parsed.problem).toBeNull();
    expect(parsed.records).toHaveLength(11);
    expect(parsed.checks).toHaveLength(1);
    expect(parsed.checks[0]).toMatchObject({ expected: 5205, actual: 5205, ok: true });
    expect(res.unresolvedRecords).toBe(0);
    expect(flat["青木 翔太|宅配（個建て）"]).toBe(2310);
    expect(flat["青木 翔太|スポット便"]).toBe(4);
    expect(flat["岡田 拓也|企業配（日当）"]).toBe(18);
    expect(flat["岡田 拓也|宅配（個建て）"]).toBe(420);
    expect(flat["加藤 由美|夜間便"]).toBe(20);
    expect(suggestMonth(rows, g.mapping, "x.xlsx")).toEqual({ month: "2026-10-01", from: "dates" });
  });

  it("横持ち：案件が列。「計」の列は使わず、行ごとの照合に使う", async () => {
    const rows = await sheetOf("稼働_横持ち_2026年10月.xlsx");
    const { g, parsed, res, flat } = pairs(rows);
    expect(g.mapping.headerRow).toBe(1);
    expect(g.mapping.roles).toEqual(["driver", "value", "value", "value", "value", "value", "ignore"]);
    expect(res.unresolvedRecords).toBe(0);
    expect(parsed.checks).toEqual([expect.objectContaining({ ok: true, expected: 5205, actual: 5205 })]);
    expect(flat["青木 翔太|宅配（個建て）"]).toBe(2310);
    expect(flat["青木 翔太|スポット便"]).toBe(4);
    expect(flat["岡田 拓也|企業配（日当）"]).toBe(18);
    expect(flat["加藤 由美|夜間便"]).toBe(20);
    expect(suggestMonth(rows, g.mapping, "x.xlsx")).toEqual({ month: "2026-10-01", from: "title" });
  });

  it("2 つのファイルから、ドライバー × 案件の合計がまったく同じになる", async () => {
    const a = pairs(await sheetOf("稼働_縦持ち_2026年10月.xlsx")).flat;
    const b = pairs(await sheetOf("稼働_横持ち_2026年10月.xlsx")).flat;
    expect(a).toEqual(b);
    expect(Object.values(a).reduce((s, n) => s + n, 0)).toBe(5205);
    expect(Object.keys(a)).toHaveLength(11);
  });
});

describe("読み方の推測", () => {
  it("日付が横に並ぶ表（2 段の見出し・案件の列あり）", () => {
    const rows = parseCsv(
      [
        "2026年10月 日別稼働,,,,,",
        "氏名,コース,10月,,,",
        ",,1,2,3,計",
        "青木 翔太,宅配,100,110,0,210",
        "青木 翔太,スポット,1,,,1",
        "井上 美咲,企業配,1,1,1,3",
        "合計,,102,111,1,214",
      ].join("\n"),
    );
    expect(detectHeaderDepth(rows, 1)).toBe(2);
    const g = guessMapping(rows, known);
    expect(g.mapping.headerDepth).toBe(2);
    expect(g.mapping.roles).toEqual(["driver", "project", "value", "value", "value", "ignore"]);
    const parsed = parseWithMapping(rows, g.mapping, "2026-10-01");
    expect(parsed.problem).toBeNull();
    const res = resolveRecords(parsed.records, known, null, noSkip);
    expect(res.resolved.map((r) => [r.driverId, r.projectId, r.qty, r.date])).toEqual([
      ["d1", "p1", 100, "2026-10-01"],
      ["d1", "p1", 110, "2026-10-02"],
      ["d1", "p3", 1, "2026-10-01"],
      ["d2", "p2", 1, "2026-10-01"],
      ["d2", "p2", 1, "2026-10-02"],
      ["d2", "p2", 1, "2026-10-03"],
    ]);
    expect(parsed.checks.every((c) => c.ok)).toBe(true);
    // 30 日と 31 日の月で形の目印が変わらない
    expect(shapeSignature(["氏名", "1", "2", "30"])).toBe(shapeSignature(["氏名", "1", "2", "30", "31"]));
  });

  it("締め日が 20 日の表（21〜31, 1〜20）は前の月の日付になる", () => {
    const dates = dayColumnDates(
      ["21", "31", "1", "20"].map((h, i) => ({ col: i, header: h })),
      "2026-10-01",
    );
    expect(dates.get(0)).toBe("2026-09-21");
    expect(dates.has(1)).toBe(false); // 9 月 31 日は無い
    expect(dates.get(2)).toBe("2026-10-01");
    expect(dates.get(3)).toBe("2026-10-20");
  });

  it("案件の列が無い表は「すべて同じ案件」を選ぶまで読めない", () => {
    const rows = parseCsv("氏名,個数\n青木 翔太,100\n井上 美咲,50");
    const g = guessMapping(rows, known);
    expect(g.mapping.roles).toEqual(["driver", "qty"]);
    expect(parseWithMapping(rows, g.mapping, "2026-10-01").problem).toContain("すべて同じ案件");
    const parsed = parseWithMapping(rows, { ...g.mapping, fixedProjectId: "p1" }, "2026-10-01");
    const res = resolveRecords(parsed.records, known, "p1", noSkip);
    expect(res.resolved.map((r) => [r.driverId, r.projectId, r.qty])).toEqual([
      ["d1", "p1", 100],
      ["d2", "p1", 50],
    ]);
  });

  it("数の列が無いときは、読めない理由を返す", () => {
    const rows = parseCsv("氏名,コース\n青木 翔太,宅配\n井上 美咲,企業配");
    const g = guessMapping(rows, known);
    expect(g.notes.join("")).toContain("数の入った列が見つかりませんでした");
    expect(parseWithMapping(rows, g.mapping, "2026-10-01").problem).toContain("数量の列");
  });

  it("番号の列があれば番号で当てる。読めない数・0・空の行は理由つきで外す", () => {
    const rows = parseCsv(
      ["社員番号,名前,案件,件数", "D01,青木,宅配,１２O", "D02,井上,企業配,0", ",,,", "D03,上田健,宅配,1,840", "D09,山田 花子,待機料,3"].join("\n"),
    );
    const g = guessMapping(rows, known);
    expect(g.mapping.roles.slice(0, 4)).toEqual(["driverCode", "driver", "project", "qty"]);
    const parsed = parseWithMapping(rows, g.mapping, "2026-10-01");
    expect(parsed.skipped.map((s) => s.reason)).toEqual([
      "D2「１２O」は数字ではありません。英字の O（オー）が混じっている可能性があります",
      "数量が 0",
      "空の行",
    ]);
    const res = resolveRecords(parsed.records, known, null, noSkip);
    expect(res.resolved.map((r) => [r.driverId, r.qty])).toEqual([["d3", 1]]);
    expect(res.unresolvedRecords).toBe(1);
    const unknownDriver = res.drivers.find((d) => !d.match)!;
    expect(unknownDriver.raw).toBe("山田 花子");
    expect(res.projects.find((p) => !p.match)?.raw).toBe("待機料");
    // 取り込まないと決めれば、名前の決まっていない行は無くなる
    const res2 = resolveRecords(parsed.records, known, null, { drivers: [unknownDriver.key], projects: [] });
    expect(res2.unresolvedRecords).toBe(0);
    expect(res2.skippedRecords).toBe(1);
  });

  it("覚えた読み方は、同じ形のファイルで同じ役目になる", async () => {
    const rows = await sheetOf("稼働_縦持ち_2026年10月.xlsx");
    const g = guessMapping(rows, known);
    const header = rows[g.mapping.headerRow];
    const changed = { ...g.mapping, roles: g.mapping.roles.map((r) => (r === "note" ? "ignore" : r)) as typeof g.mapping.roles };
    const data = profileData(header, changed);
    const found = findProfile(rows, [{ id: "prof", headerSignature: shapeSignature(header), ...data }]);
    expect(found?.profile.id).toBe("prof");
    expect(found?.mapping.roles).toEqual(changed.roles);
    expect(findProfile(rows, [{ id: "x", headerSignature: "違う形", ...data }])).toBeNull();
  });
});

describe("小さな道具", () => {
  it("列の名前・日付の見出し・月・単位", () => {
    expect([colLetter(0), colLetter(25), colLetter(26), colLetter(27)]).toEqual(["A", "Z", "AA", "AB"]);
    expect(dayOfHeader("1")).toEqual({ d: 1 });
    expect(dayOfHeader("10/1")).toEqual({ m: 10, d: 1 });
    expect(dayOfHeader("1日(水)")).toEqual({ d: 1 });
    expect(dayOfHeader("2026-10-01")).toEqual({ y: 2026, m: 10, d: 1 });
    expect(dayOfHeader("32")).toBeNull();
    expect(dayOfHeader("宅配")).toBeNull();
    expect(monthInText("サンプル運送　2026年10月 稼働集計")).toBe("2026-10-01");
    expect(monthInText("令和8年9月分")).toBe("2026-09-01");
    expect(monthInText("work_2026-11.csv")).toBe("2026-11-01");
    expect(monthInText("稼働202612.xlsx")).toBe("2026-12-01");
    expect(monthInText("稼働表.xlsx")).toBeNull();
    expect(unitHint("宅配（個）")).toBe("個");
    expect(unitHint("ルート(時間)")).toBe("時間");
    expect(unitHint("夜間便")).toBeNull();
    expect(unreadableQty("C3", "1l0")).toContain("英字の l");
    expect(unreadableQty("C3", "10〜12")).toContain("範囲");
  });

  it("先月との比べ：±50% を超えたもの・新しく出た・いなくなった", () => {
    const rows = compareWithPrev(
      [
        { driverId: "d7", projectId: "p1", qty: 380 },
        { driverId: "d1", projectId: "p1", qty: 2310 },
        { driverId: "d2", projectId: "p3", qty: 1 },
      ],
      [
        { driverId: "d7", projectId: "p1", qty: 1300 },
        { driverId: "d1", projectId: "p1", qty: 2250 },
        { driverId: "d8", projectId: "p2", qty: 21 },
      ],
      known,
    );
    const flag = Object.fromEntries(rows.map((r) => [`${r.driverName}|${r.projectName}`, r.flag]));
    expect(flag).toEqual({
      "木村 誠|宅配（個建て）": "down",
      "青木 翔太|宅配（個建て）": null,
      "井上 美咲|スポット便": "new",
      "佐藤 亮|企業配（日当）": "gone",
    });
  });
});
