import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchName, normalizeName } from "~/server/names";
import { dataRows, decodeText, detectHeaderRow, headerSignature, parseCsv, parseDateCell, parseNumberCell, readTable } from "~/server/tabular";

const samples = path.join(__dirname, "..", "public", "samples");

describe("表の読み取り", () => {
  it("縦持ちの Excel：タイトル・空行・合計行を飛ばして見出しを当てる", async () => {
    const buf = fs.readFileSync(path.join(samples, "稼働_縦持ち_2026年10月.xlsx"));
    const { sheets, encoding } = await readTable("稼働_縦持ち_2026年10月.xlsx", buf);
    expect(encoding).toBe("xlsx");
    const rows = sheets[0].rows;
    const h = detectHeaderRow(rows);
    expect(rows[h]).toEqual(["No", "日付", "ドライバー", "コース", "個数・日数", "備考"]);
    const data = dataRows(rows, h);
    expect(data).toHaveLength(11);
    expect(data.at(-1)!.cells[2]).toBe("佐藤 亮");
  });

  it("Shift_JIS と UTF-8（BOM）の CSV が同じ中身になる", async () => {
    const a = await readTable("x.csv", fs.readFileSync(path.join(samples, "元請_支払通知_2026年10月_SJIS.csv")));
    const b = await readTable("x.csv", fs.readFileSync(path.join(samples, "元請_支払通知_2026年10月_UTF8.csv")));
    expect(a.encoding).toBe("shift_jis");
    expect(b.encoding).toBe("utf-8");
    expect(a.sheets[0].rows).toEqual(b.sheets[0].rows);
    const h = detectHeaderRow(a.sheets[0].rows);
    expect(a.sheets[0].rows[h]).toEqual(["品目", "数量", "単価", "金額"]);
    expect(dataRows(a.sheets[0].rows, h).map((r) => r.cells[0])).toEqual(["宅配", "企業配", "夜間便", "待機料"]);
  });

  it("CSV の引用符・改行・カンマ", () => {
    expect(parseCsv('a,"b,c","d""e"\r\n"f\ng",h')).toEqual([
      ["a", "b,c", 'd"e'],
      ["f\ng", "h"],
    ]);
    expect(decodeText(new TextEncoder().encode("あ")).encoding).toBe("utf-8");
  });

  it("数と日付の読み取り", () => {
    expect(parseNumberCell("１，２３４円")).toBe(1234);
    expect(parseNumberCell("△500")).toBe(-500);
    expect(parseNumberCell("(1,000)")).toBe(-1000);
    expect(parseNumberCell("12.5時間")).toBe(12.5);
    expect(parseNumberCell("青木")).toBeNull();
    expect(parseDateCell("2026/10/31")).toBe("2026-10-31");
    expect(parseDateCell("R8.10.1")).toBe("2026-10-01");
    expect(parseDateCell("10/5", 2026)).toBe("2026-10-05");
    expect(parseDateCell("46296")).toBe("2026-10-01");
    expect(parseDateCell("2026/02/30")).toBeNull();
  });

  it("見出しの目印は全角半角・空白の違いを無視する", () => {
    expect(headerSignature(["ドライバー ", "個数・日数"])).toBe(headerSignature(["ﾄﾞﾗｲﾊﾞｰ", "個数日数"]));
  });
});

describe("名前の照合", () => {
  const drivers = [
    { id: "1", name: "青木 翔太", kana: "アオキ ショウタ", code: "D01" },
    { id: "2", name: "佐藤 亮" },
    { id: "3", name: "佐藤 健" },
  ];
  const projects = [
    { id: "a", name: "宅配（個建て）", aliases: ["宅配"] },
    { id: "b", name: "企業配（日当）", aliases: ["企業配"] },
    { id: "c", name: "スポット便", aliases: ["スポット"] },
    { id: "d", name: "夜間便", aliases: ["夜間"] },
  ];
  it("空白・全角半角・かな・番号", () => {
    expect(matchName("青木翔太", drivers)?.id).toBe("1");
    expect(matchName("青木　翔太", drivers)?.id).toBe("1");
    expect(matchName("あおき しょうた", drivers)?.id).toBe("1");
    expect(matchName("D01", drivers)?.id).toBe("1");
  });
  it("候補が 2 つあるときは当てない", () => {
    expect(matchName("佐藤", drivers)).toBeNull();
  });
  it("案件の括弧書き・別名", () => {
    expect(matchName("企業配（日当）", projects)?.id).toBe("b");
    expect(matchName("宅配", projects)?.id).toBe("a");
    expect(matchName("夜間", projects)?.id).toBe("d");
    expect(matchName("スポット便", projects)?.id).toBe("c");
    expect(matchName("待機料", projects)).toBeNull();
  });
  it("会社の種類を外して比べる", () => {
    expect(normalizeName("株式会社 A物流（架空）")).toBe(normalizeName("A物流"));
  });
});
