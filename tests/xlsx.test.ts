import { describe, expect, it } from "vitest";
import { ZIP_SIG_CENTRAL, ZIP_SIG_EOCD, ZIP_SIG_LOCAL } from "@/lib/exports/zip";
import {
  XLSX_HEADER_STYLE,
  buildXlsx,
  colName,
  displayWidth,
  escapeXml,
  excelDateSerial,
  normalizeSheetName,
  sheetFromRows,
  uniqueSheetName,
  xlsxFilename,
  type XlsxCell,
  type XlsxSheet,
} from "@/lib/exports/xlsx";

const dec = new TextDecoder();

/** テスト用の最小 ZIP 読み取り（セントラルディレクトリをたどってエントリ名 → 中身の文字列） */
function readXlsx(bytes: Uint8Array): Map<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(ZIP_SIG_EOCD);
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  const out = new Map<string, string>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(ZIP_SIG_CENTRAL);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    expect(dv.getUint32(localOffset, true)).toBe(ZIP_SIG_LOCAL);
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    out.set(name, dec.decode(bytes.subarray(start, start + size)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function sheet1(sheets: XlsxSheet[]): string {
  return readXlsx(buildXlsx(sheets)).get("xl/worksheets/sheet1.xml") ?? "";
}

/** 見出し行 ＋ 1 行のデータ、という最小のシート */
function oneRow(cells: XlsxCell[]): string {
  return sheet1([{ name: "テスト", rows: [["見出し"], cells] }]);
}

describe("colName（列参照）", () => {
  it("先頭の列は A、26 列目は Z", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
  });

  it("27 列目から AA・AB と 2 文字になる", () => {
    expect(colName(26)).toBe("AA");
    expect(colName(27)).toBe("AB");
  });

  it("AZ の次は BA", () => {
    expect(colName(51)).toBe("AZ");
    expect(colName(52)).toBe("BA");
  });

  it("ZZ の次は AAA、負の値は A に丸める", () => {
    expect(colName(701)).toBe("ZZ");
    expect(colName(702)).toBe("AAA");
    expect(colName(-5)).toBe("A");
  });
});

describe("ZIP としての構造", () => {
  const bytes = buildXlsx([{ name: "明細", rows: [["見出し"], ["値"]] }]);

  it("PK シグネチャで始まる", () => {
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("xlsx に必要なエントリがすべて入っている", () => {
    const names = [...readXlsx(bytes).keys()];
    expect(names).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("シートを増やすと worksheets と Content_Types・rels も増える", () => {
    const files = readXlsx(buildXlsx([{ name: "A", rows: [["a"]] }, { name: "B", rows: [["b"]] }]));
    expect(files.has("xl/worksheets/sheet2.xml")).toBe(true);
    expect(files.get("[Content_Types].xml")).toContain("/xl/worksheets/sheet2.xml");
    expect(files.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"');
    expect(files.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId3"');
  });

  it("シートが 0 件だと日本語のエラーになる", () => {
    expect(() => buildXlsx([])).toThrowError(/シートがありません/);
  });
});

describe("見出し行と固定", () => {
  it("先頭行は見出しスタイル（太字＋薄い背景＋下罫線）になる", () => {
    const xml = sheet1([{ name: "テスト", rows: [["名前", "金額"], ["山田", 100]] }]);
    expect(xml).toContain(`<c r="A1" s="${XLSX_HEADER_STYLE}" t="inlineStr"><is><t xml:space="preserve">名前</t></is></c>`);
    expect(xml).toContain(`<c r="B1" s="${XLSX_HEADER_STYLE}"`);
  });

  it("styles.xml の見出しスタイルは太字フォント・塗り・罫線を参照する", () => {
    const styles = readXlsx(buildXlsx([{ name: "A", rows: [["a"]] }])).get("xl/styles.xml") ?? "";
    expect(styles).toContain('<xf numFmtId="0" fontId="1" fillId="2" borderId="1"');
    expect(styles).toContain("<b/>");
    expect(styles).toContain('patternType="solid"');
    expect(styles).toContain('<bottom style="thin">');
  });

  it("freezeHeader で先頭行が固定される", () => {
    const xml = sheet1([{ name: "テスト", rows: [["a"], ["b"]], freezeHeader: true }]);
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  });

  it("freezeHeader を指定しなければ pane は入らない", () => {
    expect(sheet1([{ name: "テスト", rows: [["a"], ["b"]] }])).not.toContain("<pane ");
  });

  it("autoFilter は見出しから最終行までの範囲に付く", () => {
    const xml = sheet1([{ name: "テスト", rows: [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]], autoFilter: true }]);
    expect(xml).toContain('<autoFilter ref="A1:C3"/>');
    expect(xml).toContain('<dimension ref="A1:C3"/>');
  });

  it("autoFilter を指定しなければ付かない", () => {
    expect(sheet1([{ name: "テスト", rows: [["a"]] }])).not.toContain("<autoFilter");
  });
});

describe("書式（numFmt）を参照するスタイル", () => {
  it("styles.xml に金額・率・数量・日付の numFmt がある", () => {
    const styles = readXlsx(buildXlsx([{ name: "A", rows: [["a"]] }])).get("xl/styles.xml") ?? "";
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/>');
    expect(styles).toContain('<numFmt numFmtId="165" formatCode="0.0%"/>');
    expect(styles).toContain('<numFmt numFmtId="166" formatCode="#,##0.##"/>');
    expect(styles).toContain('<numFmt numFmtId="167" formatCode="yyyy/mm/dd"/>');
    expect(styles).toContain('<cellXfs count="11">');
  });

  it("金額セルは s=1（#,##0;[Red]-#,##0）", () => {
    expect(oneRow([{ v: 12345, t: "money" }])).toContain('<c r="A2" s="1"><v>12345</v></c>');
  });

  it("率セルは s=2（0.0%）で、率のまま（0.1 = 10%）書く", () => {
    expect(oneRow([{ v: 0.1, t: "percent" }])).toContain('<c r="A2" s="2"><v>0.1</v></c>');
  });

  it("数量セルは s=3（#,##0.##）", () => {
    expect(oneRow([{ v: 12.5, t: "qty" }])).toContain('<c r="A2" s="3"><v>12.5</v></c>');
  });

  it("日付セルは s=4 でシリアル値になる", () => {
    expect(oneRow([{ v: "2026-09-18", t: "date" }])).toContain('<c r="A2" s="4"><v>46283</v></c>');
  });

  it("日付にできない文字列は文字列セルへフォールバックする", () => {
    const xml = oneRow([{ v: "未定", t: "date" }]);
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">未定</t></is></c>');
  });

  it("太字のセルは +5 のスタイル（金額なら s=6）", () => {
    expect(oneRow([{ v: 100, t: "money", bold: true }])).toContain('<c r="A2" s="6"><v>100</v></c>');
    expect(oneRow([{ v: "合計", bold: true }])).toContain('<c r="A2" s="5" t="inlineStr">');
  });
});

describe("excelDateSerial", () => {
  it("1970-01-01 は 25569、2026-09-18 は 46283", () => {
    expect(excelDateSerial("1970-01-01")).toBe(25569);
    expect(excelDateSerial("2026-09-18")).toBe(46283);
  });

  it("時刻付き・タイムゾーン付きの ISO も日付として読める", () => {
    expect(excelDateSerial("2026-09-18 08:30")).toBe(46283);
    expect(excelDateSerial("2026-09-18T08:30:00Z")).toBe(46283);
  });

  it("存在しない日付・日付でない文字列は null", () => {
    expect(excelDateSerial("2026-02-30")).toBeNull();
    expect(excelDateSerial("2026/09/18")).toBeNull();
    expect(excelDateSerial("")).toBeNull();
    expect(excelDateSerial(null)).toBeNull();
  });
});

describe("XML のエスケープ", () => {
  it("& < > \" ' を実体参照にする", () => {
    expect(escapeXml(`<a href="x">A&B'C</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;A&amp;B&apos;C&lt;/a&gt;");
  });

  it("制御文字は取り除く（改行・タブは残す）", () => {
    expect(escapeXml("あ\u0000い\u0007う\nえ\tお")).toBe("あいう\nえ\tお");
  });

  it("エスケープが必要な文字を含むセルでも XML が壊れない", () => {
    const xml = oneRow(["A & B <危険> \"引用\" 'それ'"]);
    expect(xml).toContain("A &amp; B &lt;危険&gt; &quot;引用&quot; &apos;それ&apos;");
    expect(xml).not.toContain("<危険>");
  });

  it("シート名のエスケープもされる", () => {
    const wb = readXlsx(buildXlsx([{ name: "A&B", rows: [["a"]] }])).get("xl/workbook.xml") ?? "";
    expect(wb).toContain('<sheet name="A&amp;B" sheetId="1" r:id="rId1"/>');
  });
});

describe("シート名の正規化", () => {
  it("禁止文字（: \\ / ? * [ ]）を取り除く", () => {
    expect(normalizeSheetName("売上:2026/09?[集計]*x\\y")).toBe("売上202609集計xy");
  });

  it("31 文字を超えたら切り詰める", () => {
    expect(normalizeSheetName("あ".repeat(40))).toBe("あ".repeat(31));
  });

  it("空・記号だけなら Sheet1 にする", () => {
    expect(normalizeSheetName("")).toBe("Sheet1");
    expect(normalizeSheetName("  ")).toBe("Sheet1");
    expect(normalizeSheetName("[]")).toBe("Sheet1");
  });

  it("重複したシート名には (2), (3) を付ける", () => {
    const used = new Set<string>();
    expect(uniqueSheetName("明細", used)).toBe("明細");
    expect(uniqueSheetName("明細", used)).toBe("明細(2)");
    expect(uniqueSheetName("明細", used)).toBe("明細(3)");
  });

  it("31 文字ぴったりの名前が重複しても 31 文字を超えない", () => {
    const used = new Set<string>();
    const long = "あ".repeat(31);
    expect(uniqueSheetName(long, used)).toBe(long);
    const second = uniqueSheetName(long, used);
    expect(second.length).toBe(31);
    expect(second.endsWith("(2)")).toBe(true);
  });

  it("buildXlsx でも同名シートは自動で別名になる", () => {
    const wb = readXlsx(buildXlsx([{ name: "集計", rows: [["a"]] }, { name: "集計", rows: [["b"]] }])).get("xl/workbook.xml") ?? "";
    expect(wb).toContain('name="集計" sheetId="1"');
    expect(wb).toContain('name="集計(2)" sheetId="2"');
  });
});

describe("値の種類ごとの書き出し", () => {
  it("数値はそのまま数値セル（t を付けない）", () => {
    expect(oneRow([1234])).toContain('<c r="A2"><v>1234</v></c>');
    expect(oneRow([-0.5])).toContain('<c r="A2"><v>-0.5</v></c>');
  });

  it("文字列は inlineStr で書く", () => {
    expect(oneRow(["山田"])).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">山田</t></is></c>');
  });

  it("null・undefined・空文字は空セルにする", () => {
    expect(oneRow([null])).toContain('<c r="A2"/>');
    expect(oneRow([undefined])).toContain('<c r="A2"/>');
    expect(oneRow([""])).toContain('<c r="A2"/>');
    expect(oneRow([{ v: null, t: "money" }])).toContain('<c r="A2" s="1"/>');
  });

  it("NaN・Infinity は数値にせず文字列で書く", () => {
    expect(oneRow([Number.NaN])).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>');
    expect(oneRow([Number.POSITIVE_INFINITY])).toContain("Infinity");
    expect(oneRow([Number.POSITIVE_INFINITY])).not.toContain("<v>Infinity</v>");
  });

  it("真偽値は文字列として書く", () => {
    expect(oneRow([true as unknown as XlsxCell])).toContain('<is><t xml:space="preserve">true</t></is>');
    expect(oneRow([false as unknown as XlsxCell])).toContain('<is><t xml:space="preserve">false</t></is>');
  });

  it("数値の列に来た数字の文字列（rawNumber の結果）は数値セルにする", () => {
    expect(oneRow([{ v: "1234.5", t: "money" }])).toContain('<c r="A2" s="1"><v>1234.5</v></c>');
    expect(oneRow([{ v: "0.075", t: "percent" }])).toContain('<c r="A2" s="2"><v>0.075</v></c>');
  });

  it("数値の列でも数字でない文字列は文字列のままにする", () => {
    expect(oneRow([{ v: "—", t: "money" }])).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">—</t></is></c>');
  });
});

describe("列幅", () => {
  it("全角は 2 文字として数える", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("あいう")).toBe(6);
    expect(displayWidth("ｱｲｳ")).toBe(3);
  });

  it("指定が無ければ中身から概算し、最小 6・最大 40 に収める", () => {
    const xml = sheet1([{ name: "テスト", rows: [["名"], ["あ".repeat(40)]] }]);
    expect(xml).toContain('<col min="1" max="1" width="40" customWidth="1"/>');
    const narrow = sheet1([{ name: "テスト", rows: [["a"], ["b"]] }]);
    expect(narrow).toContain('<col min="1" max="1" width="6" customWidth="1"/>');
  });

  it("columns で指定した幅が優先される", () => {
    const xml = sheet1([{ name: "テスト", rows: [["名前"], ["山田"]], columns: [{ width: 25 }] }]);
    expect(xml).toContain('<col min="1" max="1" width="25" customWidth="1"/>');
  });
});

describe("sheetFromRows（CSV の行配列からシートを作る）", () => {
  const rows = [
    ["稼動月", "ドライバー", "売上", "利益率", "発生日"],
    ["2026-09", "山田", "120000", "0.25", "2026-09-30"],
    ["合計", "1 名", "120000", "0.25", ""],
  ];

  it("見出し行は見出しスタイル、データ行には列の型が付く", () => {
    const s = sheetFromRows("採算", rows, { types: ["text", "text", "money", "percent", "date"] });
    const xml = sheet1([s]);
    expect(xml).toContain(`<c r="A1" s="${XLSX_HEADER_STYLE}"`);
    expect(xml).toContain('<c r="C2" s="1"><v>120000</v></c>');
    expect(xml).toContain('<c r="D2" s="2"><v>0.25</v></c>');
    expect(xml).toContain('<c r="E2" s="4"><v>46295</v></c>');
  });

  it("既定で見出しの固定とオートフィルタが付く", () => {
    const s = sheetFromRows("採算", rows);
    expect(s.freezeHeader).toBe(true);
    expect(s.autoFilter).toBe(true);
    expect(sheet1([s])).toContain('<autoFilter ref="A1:E3"/>');
  });

  it("boldLastRow で合計行が太字になる", () => {
    const xml = sheet1([sheetFromRows("採算", rows, { types: ["text", "text", "money", "percent", "date"], boldLastRow: true })]);
    expect(xml).toContain('<c r="A3" s="5" t="inlineStr"><is><t xml:space="preserve">合計</t></is></c>');
    expect(xml).toContain('<c r="C3" s="6"><v>120000</v></c>');
    expect(xml).toContain('<c r="C2" s="1"><v>120000</v></c>');
  });

  it("widths を渡すと列幅になる", () => {
    const xml = sheet1([sheetFromRows("採算", rows, { widths: [10, undefined, 14, undefined, undefined] })]);
    expect(xml).toContain('<col min="1" max="1" width="10" customWidth="1"/>');
    expect(xml).toContain('<col min="3" max="3" width="14" customWidth="1"/>');
  });
});

describe("xlsxFilename", () => {
  it("CSV のファイル名の拡張子だけ .xlsx にする", () => {
    expect(xlsxFilename("稼働明細_2026-09.csv")).toBe("稼働明細_2026-09.xlsx");
    expect(xlsxFilename("単価表_20260918")).toBe("単価表_20260918.xlsx");
  });
});
