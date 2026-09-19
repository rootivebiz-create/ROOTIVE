import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import {
  detectReceiptImageType,
  emptyReceiptDraft,
  extractReceipt,
  isAiReadableMediaType,
  isOwnedReceiptPath,
  itemLabelOf,
  nameKey,
  normalizeName,
  parseReceiptAmount,
  parseReceiptDate,
  receiptExtension,
  receiptStoragePath,
  resolveCategoryId,
  taxExcludedAmount,
} from "@/lib/intake/helpers";
import {
  applyMapping,
  columnIndex,
  EMPTY_MAPPING,
  guessMapping,
  learnedMatches,
  matchNames,
  missingMappingFields,
  monthsOf,
  normalizeMapping,
  normalizeMatchMap,
  restrictToMonth,
  type DriverChoice,
  type ItemChoice,
  type SheetMapping,
} from "@/lib/intake/mapping";
import { detectDelimiter, detectHeader, isSupportedSheetFile, parseSheet, sheetExtension, SheetParseError } from "@/lib/intake/sheet";
import { confidenceLabel, previewSummaryText, receiptImageUrl, runResultText, sanitizeMatchMap, shortDate } from "@/components/intake/helpers";

const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
const utf8Bom = (text: string): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]));
const sjis = (text: string): Uint8Array => new Uint8Array(iconv.encode(text, "cp932"));

// ===========================================================================
// A. レシートの読み取り
// ===========================================================================

describe("extractReceipt", () => {
  const json = '{"amount": 3300, "tax_included": true, "incurred_on": "2026-09-18", "vendor": "エネオス板橋SS", "label": "ガソリン代", "category_id": "cat-1", "confidence": 0.92}';

  it("JSON だけの応答を読む", () => {
    const d = extractReceipt(json);
    expect(d.amount).toBe(3300);
    expect(d.tax_included).toBe(true);
    expect(d.incurred_on).toBe("2026-09-18");
    expect(d.vendor).toBe("エネオス板橋SS");
    expect(d.label).toBe("ガソリン代");
    expect(d.category_id).toBe("cat-1");
    expect(d.confidence).toBe(0.92);
    expect(d.raw).toContain("3300");
  });

  it("コードフェンス付きでも読む", () => {
    const d = extractReceipt("```json\n" + json + "\n```");
    expect(d.amount).toBe(3300);
    expect(d.vendor).toBe("エネオス板橋SS");
  });

  it("前置き・後書きが付いていても読む", () => {
    const d = extractReceipt(`レシートを読み取りました。\n\n${json}\n\n以上です。`);
    expect(d.amount).toBe(3300);
    expect(d.incurred_on).toBe("2026-09-18");
  });

  it("壊れた JSON でも読めるところだけ拾う", () => {
    const broken = '{"amount": 1280, "incurred_on": "2026-09-01", "vendor": "セブンイレブン", ';
    const d = extractReceipt(broken);
    expect(d.amount).toBe(1280);
    expect(d.incurred_on).toBe("2026-09-01");
    expect(d.vendor).toBe("セブンイレブン");
  });

  it("全角数字・カンマ・円記号でも金額と日付を読む", () => {
    const d = extractReceipt('{"amount": "￥１，２３４", "incurred_on": "２０２６年９月１８日", "vendor": "　カフェ　", "confidence": 85}');
    expect(d.amount).toBe(1234);
    expect(d.incurred_on).toBe("2026-09-18");
    expect(d.vendor).toBe("カフェ");
    expect(d.confidence).toBe(0.85);
  });

  it("配列や空の応答は空の結果にする", () => {
    expect(extractReceipt("").amount).toBeNull();
    expect(extractReceipt("読み取れませんでした").amount).toBeNull();
    expect(extractReceipt("[]").vendor).toBe("");
  });

  it("読めない項目は null のまま", () => {
    const d = extractReceipt('{"amount": null, "incurred_on": "不明", "vendor": "手書き領収書", "tax_included": null}');
    expect(d.amount).toBeNull();
    expect(d.incurred_on).toBeNull();
    expect(d.tax_included).toBeNull();
    expect(d.vendor).toBe("手書き領収書");
  });

  it("日本語のキー・税込の表記にも耐える", () => {
    const d = extractReceipt('{"金額": "2,200円", "日付": "2026/9/5", "支払先": "コメリ", "税込": "税込"}');
    expect(d.amount).toBe(2200);
    expect(d.incurred_on).toBe("2026-09-05");
    expect(d.tax_included).toBe(true);
  });

  it("空の結果は raw だけを持つ", () => {
    expect(emptyReceiptDraft("x")).toEqual({ amount: null, incurred_on: null, vendor: "", category_id: null, label: "", tax_included: null, confidence: 0, raw: "x" });
  });
});

describe("金額・日付の解釈", () => {
  it("parseReceiptAmount", () => {
    expect(parseReceiptAmount(1200)).toBe(1200);
    expect(parseReceiptAmount("1,200")).toBe(1200);
    expect(parseReceiptAmount("¥1,200")).toBe(1200);
    expect(parseReceiptAmount("１２００円")).toBe(1200);
    expect(parseReceiptAmount("1200円（税込）")).toBe(1200);
    expect(parseReceiptAmount("読めない")).toBeNull();
    expect(parseReceiptAmount(null)).toBeNull();
  });

  it("parseReceiptDate", () => {
    expect(parseReceiptDate("2026-09-18")).toBe("2026-09-18");
    expect(parseReceiptDate("2026/9/8")).toBe("2026-09-08");
    expect(parseReceiptDate("2026年9月8日")).toBe("2026-09-08");
    expect(parseReceiptDate("20260918")).toBe("2026-09-18");
    expect(parseReceiptDate("２０２６.０９.１８")).toBe("2026-09-18");
    expect(parseReceiptDate("9/18", "2026-09")).toBe("2026-09-18");
    expect(parseReceiptDate("9/18")).toBeNull();
    expect(parseReceiptDate("2026-13-01")).toBeNull();
    expect(parseReceiptDate("2026-02-30")).toBeNull();
    expect(parseReceiptDate("")).toBeNull();
  });

  it("taxExcludedAmount（税込 → 税抜）", () => {
    expect(taxExcludedAmount(1100, 0.1)).toBe(1000);
    expect(taxExcludedAmount(3300, 0.1)).toBe(3000);
    expect(taxExcludedAmount(1000, 0.1)).toBe(909.09);
    expect(taxExcludedAmount(1000, 0)).toBe(1000);
  });
});

describe("カテゴリの解決", () => {
  const categories = [
    { id: "11111111-1111-4111-8111-111111111111", name: "燃料費" },
    { id: "22222222-2222-4222-8222-222222222222", name: "高速道路料金" },
    { id: "33333333-3333-4333-8333-333333333333", name: "消耗品費", is_active: false },
  ];

  it("id をそのまま返す", () => {
    expect(resolveCategoryId(categories[0].id, categories)).toBe(categories[0].id);
  });

  it("名前から引く（全角・空白は無視）", () => {
    expect(resolveCategoryId("燃料費", categories)).toBe(categories[0].id);
    expect(resolveCategoryId(" 高速道路料金 ", categories)).toBe(categories[1].id);
  });

  it("決められないときは null", () => {
    expect(resolveCategoryId("", categories)).toBeNull();
    expect(resolveCategoryId("交際費", categories)).toBeNull();
    expect(resolveCategoryId(null, categories)).toBeNull();
  });
});

describe("レシート画像", () => {
  it("先頭バイトから形式を判定する", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
    expect(detectReceiptImageType(png)).toBe("image/png");
    expect(detectReceiptImageType(jpeg)).toBe("image/jpeg");
    expect(detectReceiptImageType(webp)).toBe("image/webp");
    expect(detectReceiptImageType(heic)).toBe("image/heic");
    expect(detectReceiptImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("HEIC は AI に渡さない", () => {
    expect(isAiReadableMediaType("image/jpeg")).toBe(true);
    expect(isAiReadableMediaType("image/heic")).toBe(false);
  });

  it("保存先は会社のフォルダ配下", () => {
    const company = "11111111-1111-4111-8111-111111111111";
    const path = receiptStoragePath(company, "image/jpeg", new Date("2026-09-18T01:02:03.000Z"), "abcdef");
    expect(path).toBe(`${company}/2026-09/receipt-20260918T010203Z-abcdef.jpg`);
    expect(isOwnedReceiptPath(company, path)).toBe(true);
    expect(isOwnedReceiptPath("22222222-2222-4222-8222-222222222222", path)).toBe(false);
    expect(isOwnedReceiptPath(company, `${company}/../other/x.jpg`)).toBe(false);
    expect(receiptExtension("image/png")).toBe("png");
  });
});

// ===========================================================================
// B. 元請の実績ファイル
// ===========================================================================

describe("parseSheet", () => {
  const CSV = ["配送日,ドライバー,コース,区分,個数", "2026/9/1,山田太郎,Aコース,通常,80"].join("\r\n");

  it("CSV（UTF-8）を読む", () => {
    const res = parseSheet(utf8(CSV), "jisseki.csv");
    expect(res.encoding).toBe("utf-8");
    expect(res.delimiter).toBe(",");
    expect(res.sheets).toHaveLength(1);
    expect(res.sheets[0].rows[0]).toEqual(["配送日", "ドライバー", "コース", "区分", "個数"]);
    expect(res.sheets[0].rows[1][1]).toBe("山田太郎");
  });

  it("BOM 付きの UTF-8 を読む", () => {
    const res = parseSheet(utf8Bom(CSV), "jisseki.csv");
    expect(res.encoding).toBe("utf-8");
    expect(res.sheets[0].rows[0][0]).toBe("配送日");
  });

  it("Shift_JIS を読む", () => {
    const res = parseSheet(sjis(CSV), "jisseki.csv");
    expect(res.encoding).toBe("shift_jis");
    expect(res.sheets[0].rows[0][0]).toBe("配送日");
    expect(res.sheets[0].rows[1][2]).toBe("Aコース");
  });

  it("TSV を読む", () => {
    const tsv = ["日付\tドライバー\t件数", "2026-09-01\t鈴木一郎\t12"].join("\n");
    const res = parseSheet(utf8(tsv), "jisseki.tsv");
    expect(res.delimiter).toBe("\t");
    expect(res.sheets[0].rows[1]).toEqual(["2026-09-01", "鈴木一郎", "12"]);
  });

  it("引用符つきのセル・末尾の空行に耐える", () => {
    const csv = '日付,ドライバー,個数\n2026-09-01,"山田, 太郎",5\n\n';
    const res = parseSheet(utf8(csv), "a.csv");
    expect(res.sheets[0].rows).toHaveLength(2);
    expect(res.sheets[0].rows[1][1]).toBe("山田, 太郎");
  });

  it("Excel・PDF は日本語のメッセージで断る", () => {
    expect(() => parseSheet(utf8(CSV), "jisseki.xlsx")).toThrow(SheetParseError);
    expect(() => parseSheet(utf8(CSV), "jisseki.xlsx")).toThrow(/CSV UTF-8/);
    expect(() => parseSheet(utf8(CSV), "jisseki.pdf")).toThrow(/PDF は読み込めません/);
    expect(() => parseSheet(new Uint8Array(), "a.csv")).toThrow(/ファイルが空です/);
  });

  it("拡張子の判定", () => {
    expect(sheetExtension("a/b/実績.CSV")).toBe(".csv");
    expect(isSupportedSheetFile("実績.csv")).toBe(true);
    expect(isSupportedSheetFile("実績.tsv")).toBe(true);
    expect(isSupportedSheetFile("実績.xlsx")).toBe(false);
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a,b,c")).toBe(",");
  });
});

describe("detectHeader", () => {
  it("前置きの行があってもヘッダー行を見つける", () => {
    const rows = [
      ["〇〇運輸株式会社　実績表", "", "", "", ""],
      ["2026年9月分", "", "", "", ""],
      ["", "", "", "", ""],
      ["配送日", "ドライバー", "コース", "区分", "個数"],
      ["2026/9/1", "山田太郎", "Aコース", "通常", "80"],
      ["2026/9/2", "山田太郎", "Aコース", "通常", "75"],
    ];
    const { headerRow, headers } = detectHeader(rows);
    expect(headerRow).toBe(3);
    expect(headers[0]).toBe("配送日");
  });

  it("1 行目がヘッダーのときはそのまま", () => {
    const rows = [
      ["日付", "配送員", "件数"],
      ["2026-09-01", "鈴木一郎", "12"],
    ];
    expect(detectHeader(rows).headerRow).toBe(0);
  });

  it("見出しらしい行が無ければ最初の中身のある行を使う", () => {
    const rows = [[], ["", ""], ["2026-09-01", "鈴木一郎", "12"]];
    expect(detectHeader(rows).headerRow).toBe(2);
  });
});

describe("guessMapping", () => {
  const cases: { headers: string[]; expected: SheetMapping }[] = [
    {
      headers: ["配送日", "ドライバー", "コース", "区分", "個数"],
      expected: { date: "配送日", driver: "ドライバー", project: "コース", item: "区分", qty: "個数" },
    },
    {
      headers: ["日付", "配送員", "エリア", "種別", "件数"],
      expected: { date: "日付", driver: "配送員", project: "エリア", item: "種別", qty: "件数" },
    },
    {
      headers: ["稼働日", "担当者", "案件", "作業内容", "数量"],
      expected: { date: "稼働日", driver: "担当者", project: "案件", item: "作業内容", qty: "数量" },
    },
    {
      headers: ["年月日", "氏名", "ルート", "品目", "配達数"],
      expected: { date: "年月日", driver: "氏名", project: "ルート", item: "品目", qty: "配達数" },
    },
    {
      headers: ["取扱日", "乗務員名", "センター", "業務区分", "個口数"],
      expected: { date: "取扱日", driver: "乗務員名", project: "センター", item: "業務区分", qty: "個口数" },
    },
    {
      headers: ["No", "配達日", "ドライバー名", "コース名", "配達件数", "備考"],
      expected: { date: "配達日", driver: "ドライバー名", project: "コース名", item: "", qty: "配達件数" },
    },
  ];

  cases.forEach(({ headers, expected }, i) => {
    it(`日本語のヘッダー ${i + 1}`, () => {
      expect(guessMapping(headers)).toEqual(expected);
    });
  });

  it("同じ列を 2 つの項目に割り当てない", () => {
    const mapping = guessMapping(["日付", "氏名", "個数"]);
    const used = [mapping.date, mapping.driver, mapping.project, mapping.item, mapping.qty].filter((v) => v !== "");
    expect(new Set(used).size).toBe(used.length);
    expect(mapping.project).toBe("");
  });

  it("見出しが無ければ空のまま", () => {
    expect(guessMapping(["A", "B", "C"])).toEqual(EMPTY_MAPPING);
    expect(missingMappingFields(EMPTY_MAPPING)).toEqual(["date", "driver", "qty"]);
    expect(missingMappingFields(guessMapping(["日付", "氏名", "個数"]))).toEqual([]);
  });

  it("normalizeMapping / normalizeMatchMap は未知の値に耐える", () => {
    expect(normalizeMapping(null)).toEqual(EMPTY_MAPPING);
    expect(normalizeMapping({ date: "配送日", qty: "個数", zzz: "x" })).toEqual({ ...EMPTY_MAPPING, date: "配送日", qty: "個数" });
    expect(normalizeMatchMap({ "  山田　太郎 ": "id-1", bad: 3 })).toEqual({ "山田 太郎": "id-1" });
    expect(normalizeMatchMap("x")).toEqual({});
  });
});

describe("applyMapping", () => {
  const rows = [
    ["〇〇運輸　実績表", "", "", "", ""],
    ["配送日", "ドライバー", "コース", "区分", "個数"],
    ["2026/9/1", "山田太郎", "Aコース", "通常", "80"],
    ["2026/9/2", "鈴木 一郎", "Bコース", "通常", "１２０"],
    ["", "", "", "", ""],
    ["合計", "", "", "", "200"],
  ];
  const mapping = guessMapping(rows[1]);

  it("ヘッダー行より下を取り出す", () => {
    const parsed = applyMapping(rows, mapping, 1);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ line: 3, date: "2026-09-01", driverName: "山田太郎", projectName: "Aコース", itemName: "通常", qty: 80 });
    // 全角数字も読む
    expect(parsed[1].qty).toBe(120);
    expect(parsed[1].driverName).toBe("鈴木 一郎");
    // 合計行は日付もドライバーも無いので取り込めない行として残る
    expect(parsed[2].date).toBe("");
  });

  it("年の無い日付は稼動月から補う", () => {
    const parsed = applyMapping([["日付", "氏名", "件数"], ["9/18", "山田太郎", "3"]], { ...EMPTY_MAPPING, date: "日付", driver: "氏名", qty: "件数" }, 0, "2026-09");
    expect(parsed[0].date).toBe("2026-09-18");
  });

  it("使わない列は空になる", () => {
    const parsed = applyMapping(rows, { ...mapping, project: "", item: "" }, 1);
    expect(parsed[0].projectName).toBe("");
    expect(parsed[0].itemName).toBe("");
  });

  it("columnIndex は正規化して引く", () => {
    expect(columnIndex(["配送日", "ドライバー"], "配送日")).toBe(0);
    expect(columnIndex(["配送日", "ドライバー"], "ドライバー")).toBe(1);
    expect(columnIndex(["配送日"], "個数")).toBe(-1);
  });
});

describe("matchNames", () => {
  const drivers: DriverChoice[] = [
    { id: "d-yamada", name: "山田 太郎", is_active: true },
    { id: "d-suzuki", name: "鈴木一郎", is_active: true },
    { id: "d-tanaka-old", name: "田中 花子", is_active: false },
    { id: "d-tanaka-new", name: "田中 花子", is_active: true },
    { id: "d-sato-a", name: "佐藤 実", is_active: true },
    { id: "d-sato-b", name: "佐藤 実", is_active: true },
  ];
  const items: ItemChoice[] = [
    { id: "i-a-normal", name: "通常", project_id: "p-a", project_name: "Aコース", is_active: true },
    { id: "i-a-extra", name: "追加", project_id: "p-a", project_name: "Aコース", is_active: true },
    { id: "i-b-normal", name: "通常", project_id: "p-b", project_name: "Bコース", is_active: true },
    { id: "i-c-only", name: "定期便", project_id: "p-c", project_name: "Cエリア", is_active: true },
  ];
  const row = (over: Partial<{ line: number; date: string; driverName: string; projectName: string; itemName: string; qty: number }> = {}) => ({
    line: 2,
    date: "2026-09-01",
    driverName: "山田 太郎",
    projectName: "Aコース",
    itemName: "通常",
    qty: 10,
    ...over,
  });

  it("全角・半角・空白の違いを吸収する", () => {
    const res = matchNames([row({ driverName: "山田　太郎" }), row({ driverName: "山田太郎" }), row({ driverName: "ヤマダ タロウ" })], drivers, items);
    expect(res.rows[0].driverId).toBe("d-yamada");
    expect(res.rows[1].driverId).toBe("d-yamada");
    // カナ書きは名前が違うので対応が付かない
    expect(res.rows[2].driverId).toBe("");
    expect(res.unmatched.drivers).toEqual(["ヤマダ タロウ"]);
  });

  it("ひらがな・カタカナの違いを吸収する", () => {
    const kana: DriverChoice[] = [{ id: "d-kana", name: "たなか たろう", is_active: true }];
    const res = matchNames([row({ driverName: "タナカ　タロウ", itemName: "通常" })], kana, items);
    expect(res.rows[0].driverId).toBe("d-kana");
  });

  it("同名が複数あるときは有効な 1 件だけを選ぶ", () => {
    const res = matchNames([row({ driverName: "田中 花子" }), row({ driverName: "佐藤 実" })], drivers, items);
    expect(res.rows[0].driverId).toBe("d-tanaka-new");
    // 有効なものが 2 件あるときは決められない
    expect(res.rows[1].driverId).toBe("");
    expect(res.unmatched.drivers).toEqual(["佐藤 実"]);
  });

  it("案件名と内容名の組み合わせで案件内容を決める", () => {
    const res = matchNames([row(), row({ projectName: "Bコース" }), row({ projectName: "Aコース", itemName: "追加" })], drivers, items);
    expect(res.rows.map((r) => r.itemId)).toEqual(["i-a-normal", "i-b-normal", "i-a-extra"]);
    expect(res.rows[0].itemLabel).toBe("Aコース / 通常");
  });

  it("内容の列が無くても案件の内容が 1 つなら決まる", () => {
    const res = matchNames([row({ projectName: "Cエリア", itemName: "" })], drivers, items);
    expect(res.rows[0].itemId).toBe("i-c-only");
    expect(res.rows[0].ok).toBe(true);
  });

  it("保存済みの対応を最優先する", () => {
    const res = matchNames(
      [row({ driverName: "ﾔﾏﾀﾞ ﾀﾛｳ", projectName: "A便", itemName: "" })],
      drivers,
      items,
      { "ヤマダ タロウ": "d-yamada" },
      { A便: "i-a-extra" },
    );
    expect(res.rows[0].driverId).toBe("d-yamada");
    expect(res.rows[0].itemId).toBe("i-a-extra");
    expect(res.unmatched).toEqual({ drivers: [], items: [] });
  });

  it("対応が付かない名前・読めない行を理由つきで返す", () => {
    const res = matchNames(
      [row({ driverName: "知らない人" }), row({ date: "", qty: 0, itemName: "未知の区分" })],
      drivers,
      items,
    );
    expect(res.matched).toHaveLength(0);
    expect(res.rows[0].ok).toBe(false);
    expect(res.rows[0].error).toContain("ドライバーの対応が付いていません");
    expect(res.rows[1].error).toContain("日付を読み取れません");
    expect(res.rows[1].error).toContain("数量が 0 です");
    expect(res.unmatched.drivers).toEqual(["知らない人"]);
    expect(res.unmatched.items).toEqual(["Aコース / 未知の区分"]);
  });

  it("同じ名前は 1 回だけ unmatched に入れる", () => {
    const res = matchNames([row({ driverName: "知らない人" }), row({ driverName: "知らない人" })], drivers, items);
    expect(res.unmatched.drivers).toEqual(["知らない人"]);
  });

  it("取り込める行だけを matched に入れる", () => {
    const res = matchNames([row(), row({ driverName: "知らない人" })], drivers, items);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].driverId).toBe("d-yamada");
    expect(learnedMatches(res.rows)).toEqual({ drivers: { "山田 太郎": "d-yamada" }, items: { "Aコース / 通常": "i-a-normal" } });
  });

  it("選択中の稼動月以外の行は取り込まない", () => {
    const res = matchNames([row(), row({ date: "2026-08-31" })], drivers, items);
    const checked = restrictToMonth(res.rows, "2026-09");
    expect(checked[0].ok).toBe(true);
    expect(checked[1].ok).toBe(false);
    expect(checked[1].error).toContain("2026-09 以外の日付です");
    expect(monthsOf(checked)).toEqual(["2026-08", "2026-09"]);
  });
});

// ===========================================================================
// 画面のヘルパー
// ===========================================================================

describe("画面のヘルパー", () => {
  it("名前の正規化", () => {
    expect(normalizeName(" 山田　太郎 ")).toBe("山田 太郎");
    expect(nameKey("ﾔﾏﾀﾞ ﾀﾛｳ")).toBe(nameKey("やまだ たろう"));
    expect(itemLabelOf("Aコース", "通常")).toBe("Aコース / 通常");
    expect(itemLabelOf("", "通常")).toBe("通常");
    expect(itemLabelOf("Aコース", "")).toBe("Aコース");
  });

  it("レシート画像の URL", () => {
    expect(receiptImageUrl("abc/2026-09/receipt-1.jpg")).toBe("/api/receipt/abc/2026-09/receipt-1.jpg");
  });

  it("読み取りの自信の表示", () => {
    expect(confidenceLabel(0.9)).toContain("高い");
    expect(confidenceLabel(0.6)).toContain("ふつう");
    expect(confidenceLabel(0.1)).toContain("低い");
  });

  it("件数の要約", () => {
    expect(previewSummaryText({ total: 0, ok: 0, ng: 0 })).toContain("ありません");
    expect(previewSummaryText({ total: 10, ok: 10, ng: 0 })).toContain("10 行すべて");
    expect(previewSummaryText({ total: 10, ok: 8, ng: 2 })).toContain("2 行は対応が付いていません");
    expect(runResultText({ applied: 12, skipped: 0 })).toContain("12 件");
    expect(runResultText({ applied: 12, skipped: 3 })).toContain("3 行は取り込みませんでした");
    expect(shortDate("2026-09-08")).toBe("9/8");
  });

  it("対応表は壊れた項目を落としてから保存する", () => {
    expect(sanitizeMatchMap({ "山田 太郎": "d-1", "  ": "d-2", 長い: "", x: "d-3" })).toEqual({ "山田 太郎": "d-1", x: "d-3" });
    expect(sanitizeMatchMap({ ["あ".repeat(300)]: "d-1" })).toEqual({});
  });
});
