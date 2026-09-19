import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import {
  classifyHeader,
  decodeBankCsv,
  fingerprintTxn,
  fingerprintTxns,
  matchKey,
  clientKey,
  normalizeDescription,
  parseBankAmount,
  parseBankCsv,
  parseBankDate,
  parseCsv,
  suggestInvoiceMatches,
  summarizeImport,
  UNKNOWN_FORMAT,
  type InvoiceCandidate,
  type ParsedTxn,
} from "@/lib/bank";
import { BANK_CSV_HEADERS, bankCsv, bankCsvFilename, bankCsvRow } from "@/lib/exports/bank-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import { bankCsvFileSchema, bankStatusFromParam, isBankCsvFileName, matchBankTxnSchema, setBankTxnStatusSchema, MAX_BANK_CSV_BYTES } from "@/lib/schemas/bank";
import { bankExportUrl, bankStatusHref, bankTotals, importResultMessage, shortDate, toImportRow, toInvoiceCandidate, toTxnRow } from "@/components/bank/helpers";
import type { BankImport, BankTransactionRow, InvoiceListRow } from "@/lib/db/types";

const COMPANY = "11111111-1111-4111-8111-111111111111";

const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
const utf8Bom = (text: string): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]));
const sjis = (text: string): Uint8Array => new Uint8Array(iconv.encode(text, "cp932"));

// ---------------------------------------------------------------------------
// 実在するネット銀行の書式を模した CSV（5 種類以上）
// ---------------------------------------------------------------------------

/** ① 2 列型（メガバンクのネットバンキングによくある形。CRLF） */
const CSV_TWO_COLUMN = [
  "日付,お取引内容,お預入金額,お支払金額,残高",
  "2026/9/18,振込 ｶ)ﾀﾅｶｼｮｳｼﾞ,330000,,1530000",
  "2026/9/19,ATM引出,,50000,1480000",
  "2026/9/30,振込ﾃｽｳﾘｮｳ,,440,1479560",
].join("\r\n");

/** ② 1 列型（金額 1 列。出金はマイナス） */
const CSV_ONE_COLUMN = ["取引日,摘要,金額,残高", "2026-09-18,振込 ｶ)ｽｽﾞｷｳﾝﾕ,220000,1250000", "2026-09-20,電気料金,-12000,1238000"].join("\n");

/** ③ Shift_JIS（全角のカナ・見出しの前に口座情報の行がある） */
const CSV_SJIS_TEXT = [
  "口座番号,1234567",
  "照会期間,2026/09/01〜2026/09/30",
  "",
  "お取引日,お取引内容,お預入金額,お支払金額,差引残高",
  "2026/09/18,振込 カ）タナカショウジ,330000,,1530000",
  "2026/09/25,口座振替 デンキ,,12000,1518000",
].join("\r\n");

/** ④ ヘッダー無し（日付は YYYYMMDD、入金・出金・残高の 3 列） */
const CSV_NO_HEADER = ["20260918,振込 ｶ)ﾔﾏﾀﾞ,150000,,900000", "20260919,ｶｰﾄﾞ ﾘﾖｳ,,20000,880000"].join("\n");

/** ⑤ 全角数字・カンマ・¥・△・空欄・壊れた行が混ざったもの（和暦もある） */
const CSV_MESSY = [
  "お取引日,入出金先内容,お取引金額,差引残高",
  '2026/9/18,"振込 ﾄｸｲｻｷ","¥123,456","1,234,567"',
  'R8.9.19,"ＡＴＭ 引出","△5,000","1,229,567"',
  ',"日付が空",1000,',
  '2026/9/21,"金額が空",,',
  '2026/9/22,"全角の金額","１０，０００","1,239,567"',
  'こわれた行,"読めない日付","abc","1,239,567"',
].join("\r\n");

/** ヘッダー無し・1 列型（金額と残高だけ） */
const CSV_NO_HEADER_ONE = ["2026/9/18,振込 ｶ)ﾔﾏﾀﾞ,150000,900000", "2026/9/19,ｶｰﾄﾞ ﾘﾖｳ,-20000,880000"].join("\n");

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

describe("parseBankDate（日付の解釈）", () => {
  it("よくある区切りを受け付ける", () => {
    expect(parseBankDate("2026/9/18")).toBe("2026-09-18");
    expect(parseBankDate("2026-09-18")).toBe("2026-09-18");
    expect(parseBankDate("2026.9.18")).toBe("2026-09-18");
    expect(parseBankDate("2026年9月18日")).toBe("2026-09-18");
    expect(parseBankDate("20260918")).toBe("2026-09-18");
    expect(parseBankDate("26/9/18")).toBe("2026-09-18");
  });

  it("和暦（令和）を西暦へ直す", () => {
    expect(parseBankDate("R8.9.18")).toBe("2026-09-18");
    expect(parseBankDate("令和8年9月18日")).toBe("2026-09-18");
    expect(parseBankDate("H31.4.30")).toBe("2019-04-30");
  });

  it("全角・空白・曜日つきでも読める", () => {
    expect(parseBankDate("２０２６／９／１８")).toBe("2026-09-18");
    expect(parseBankDate(" 2026/09/18 ")).toBe("2026-09-18");
    expect(parseBankDate("2026/09/18(金)")).toBe("2026-09-18");
  });

  it("実在しない日付・空欄・数字でない値は null", () => {
    expect(parseBankDate("2026/2/30")).toBeNull();
    expect(parseBankDate("2026/13/01")).toBeNull();
    expect(parseBankDate("12345678")).toBeNull();
    expect(parseBankDate("")).toBeNull();
    expect(parseBankDate("お取引日")).toBeNull();
    expect(parseBankDate(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 金額
// ---------------------------------------------------------------------------

describe("parseBankAmount（金額の解釈）", () => {
  it("カンマ・¥・円・全角を受け付ける", () => {
    expect(parseBankAmount("1,234,567")).toBe(1234567);
    expect(parseBankAmount("¥123,456")).toBe(123456);
    expect(parseBankAmount("￥123,456")).toBe(123456);
    expect(parseBankAmount("12,000円")).toBe(12000);
    expect(parseBankAmount("１０，０００")).toBe(10000);
  });

  it("マイナスの書き方（-・△・▲・括弧・後置）をすべてマイナスにする", () => {
    expect(parseBankAmount("-5000")).toBe(-5000);
    expect(parseBankAmount("△5,000")).toBe(-5000);
    expect(parseBankAmount("▲5,000")).toBe(-5000);
    expect(parseBankAmount("(5,000)")).toBe(-5000);
    expect(parseBankAmount("5000-")).toBe(-5000);
    expect(parseBankAmount("−5,000")).toBe(-5000);
  });

  it("空欄・文字は null、0 は 0", () => {
    expect(parseBankAmount("")).toBeNull();
    expect(parseBankAmount("   ")).toBeNull();
    expect(parseBankAmount("-")).toBeNull();
    expect(parseBankAmount("abc")).toBeNull();
    expect(parseBankAmount("0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CSV の分解・文字コード
// ---------------------------------------------------------------------------

describe("parseCsv（CSV の分解）", () => {
  it("引用符つき・カンマ入り・エスケープ・セル内改行に対応する", () => {
    const rows = parseCsv('a,"b,c","d""e"\r\n"1\n2",3,4\n');
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1\n2", "3", "4"],
    ]);
  });

  it("末尾の改行で空行を作らない（CRLF / LF / CR）", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("BOM を落とす", () => {
    expect(parseCsv("﻿日付,金額")).toEqual([["日付", "金額"]]);
  });
});

describe("decodeBankCsv（文字コードの判定）", () => {
  it("BOM 付き UTF-8 を読む（BOM は残さない）", () => {
    const res = decodeBankCsv(utf8Bom("日付,摘要\n2026/9/18,振込"));
    expect(res.encoding).toBe("utf-8");
    expect(res.text.startsWith("日付")).toBe(true);
  });

  it("BOM 無し UTF-8 を読む", () => {
    const res = decodeBankCsv(utf8("日付,摘要,お預入金額"));
    expect(res.encoding).toBe("utf-8");
    expect(res.text).toContain("お預入金額");
  });

  it("Shift_JIS を文字化けさせずに読む", () => {
    const res = decodeBankCsv(sjis("日付,お取引内容,お預入金額\n2026/09/18,振込 カ）タナカ,330000"));
    expect(res.encoding).toBe("shift_jis");
    expect(res.text).toContain("振込 カ）タナカ");
    expect(res.text).not.toContain("�");
  });
});

// ---------------------------------------------------------------------------
// 書式ごとの読み取り
// ---------------------------------------------------------------------------

describe("parseBankCsv ① 2 列型（お預入金額／お支払金額）", () => {
  const res = parseBankCsv(utf8Bom(CSV_TWO_COLUMN));

  it("書式名と件数", () => {
    expect(res.format).toBe("2列型（お預入金額／お支払金額）");
    expect(res.encoding).toBe("utf-8");
    expect(res.rows).toHaveLength(3);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(0);
  });

  it("入金は ＋・出金は −、残高と摘要（半角カナ → 全角）も読む", () => {
    expect(res.rows[0]).toMatchObject({ txnDate: "2026-09-18", amount: 330000, balance: 1530000 });
    expect(res.rows[0].description).toBe("振込 カ)タナカショウジ");
    expect(res.rows[1]).toMatchObject({ txnDate: "2026-09-19", amount: -50000, balance: 1480000 });
    expect(res.rows[2].amount).toBe(-440);
  });
});

describe("parseBankCsv ② 1 列型（金額）", () => {
  const res = parseBankCsv(utf8(CSV_ONE_COLUMN));

  it("書式名と符号（出金はマイナスのまま）", () => {
    expect(res.format).toBe("1列型（金額）");
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ txnDate: "2026-09-18", amount: 220000, balance: 1250000 });
    expect(res.rows[1]).toMatchObject({ txnDate: "2026-09-20", amount: -12000, balance: 1238000 });
    expect(res.errors).toEqual([]);
  });
});

describe("parseBankCsv ③ Shift_JIS（見出しの前に口座情報がある）", () => {
  const res = parseBankCsv(sjis(CSV_SJIS_TEXT));

  it("文字コードを判定し、見出し行を探し当てる", () => {
    expect(res.encoding).toBe("shift_jis");
    expect(res.format).toBe("2列型（お預入金額／お支払金額）");
    expect(res.columns?.headerRow).toBe(2); // 空行を除いた位置（口座番号・照会期間の次）
    expect(res.rows).toHaveLength(2);
  });

  it("全角のカナも文字化けしない", () => {
    expect(res.rows[0]).toMatchObject({ txnDate: "2026-09-18", amount: 330000, balance: 1530000 });
    expect(res.rows[0].description).toBe("振込 カ)タナカショウジ");
    expect(res.rows[1].amount).toBe(-12000);
  });
});

describe("parseBankCsv ④ ヘッダー無し", () => {
  it("日付・入金・出金・残高の並びを推測する", () => {
    const res = parseBankCsv(utf8(CSV_NO_HEADER));
    expect(res.format).toBe("ヘッダー無し・2列型");
    expect(res.columns?.headerRow).toBeNull();
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ txnDate: "2026-09-18", amount: 150000, balance: 900000 });
    expect(res.rows[1]).toMatchObject({ txnDate: "2026-09-19", amount: -20000, balance: 880000 });
  });

  it("金額 1 列の並びも推測する", () => {
    const res = parseBankCsv(utf8(CSV_NO_HEADER_ONE));
    expect(res.format).toBe("ヘッダー無し・1列型");
    expect(res.rows.map((r) => r.amount)).toEqual([150000, -20000]);
    expect(res.rows.map((r) => r.balance)).toEqual([900000, 880000]);
  });
});

describe("parseBankCsv ⑤ 全角・カンマ・¥・空欄・壊れた行が混ざったもの", () => {
  const res = parseBankCsv(utf8(CSV_MESSY));

  it("読める行だけを取り込む", () => {
    expect(res.format).toBe("1列型（お取引金額）");
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => r.amount)).toEqual([123456, -5000, 10000]);
    expect(res.rows.map((r) => r.balance)).toEqual([1234567, 1229567, 1239567]);
    expect(res.rows[1].txnDate).toBe("2026-09-19"); // R8.9.19（和暦）
  });

  it("読めない行は理由を日本語で積み、件数を数える", () => {
    expect(res.skipped).toBe(3);
    expect(res.errors).toHaveLength(3);
    expect(res.errors[0]).toContain("4 行目");
    expect(res.errors[0]).toContain("日付を読み取れませんでした");
    expect(res.errors[1]).toContain("5 行目");
    expect(res.errors[1]).toContain("金額を読み取れませんでした");
    expect(res.errors[2]).toContain("7 行目");
  });
});

describe("parseBankCsv（その他）", () => {
  it("書式を判定できなければ rows は空で errors だけを返す", () => {
    const res = parseBankCsv(utf8("これは\n銀行の明細ではありません\n"));
    expect(res.format).toBe(UNKNOWN_FORMAT);
    expect(res.rows).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("判定できませんでした");
  });

  it("空のファイルも落ちない", () => {
    const res = parseBankCsv(utf8(""));
    expect(res.rows).toEqual([]);
    expect(res.errors[0]).toContain("中身がありません");
  });

  it("途中で見出しが繰り返されても、その行は黙って飛ばす", () => {
    const text = [CSV_ONE_COLUMN, "取引日,摘要,金額,残高", "2026-10-01,振込 ｶ)ｻﾄｳ,50000,1288000"].join("\n");
    const res = parseBankCsv(utf8(text));
    expect(res.rows).toHaveLength(3);
    expect(res.skipped).toBe(0);
    expect(res.errors).toEqual([]);
  });

  it("maxRows を超えた分は取り込まず、理由を残す", () => {
    const lines = ["取引日,摘要,金額,残高"];
    for (let i = 1; i <= 5; i += 1) lines.push(`2026-09-0${i},振込${i},1000,${1000 * i}`);
    const res = parseBankCsv(utf8(lines.join("\n")), { maxRows: 3 });
    expect(res.rows).toHaveLength(3);
    expect(res.errors[0]).toContain("3 件を超えた");
  });
});

describe("classifyHeader（列の判定）", () => {
  it("よくある見出しを取り違えない", () => {
    expect(classifyHeader("お取引日")).toBe("date");
    expect(classifyHeader("入出金先内容")).toBe("description");
    expect(classifyHeader("お預入金額")).toBe("deposit");
    expect(classifyHeader("お支払金額")).toBe("withdrawal");
    expect(classifyHeader("入出金金額")).toBe("amount");
    expect(classifyHeader("差引残高")).toBe("balance");
    expect(classifyHeader("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 指紋（二重取り込みの防止）
// ---------------------------------------------------------------------------

describe("fingerprintTxn（二重取り込みの防止）", () => {
  it("同じ CSV を 2 回読んでも同じ指紋になる", () => {
    const a = parseBankCsv(utf8Bom(CSV_TWO_COLUMN));
    const b = parseBankCsv(utf8Bom(CSV_TWO_COLUMN));
    expect(fingerprintTxns(COMPANY, a.rows)).toEqual(fingerprintTxns(COMPANY, b.rows));
    expect(new Set(fingerprintTxns(COMPANY, a.rows)).size).toBe(a.rows.length);
  });

  it("会社が違えば指紋も違う", () => {
    const rows = parseBankCsv(utf8Bom(CSV_TWO_COLUMN)).rows;
    expect(fingerprintTxns(COMPANY, rows)[0]).not.toBe(fingerprintTxns("22222222-2222-4222-8222-222222222222", rows)[0]);
  });

  it("同じ日・同じ金額・同じ摘要が同一ファイル内に 2 件あっても片方が消えない（連番が付く）", () => {
    const text = ["取引日,摘要,金額,残高", "2026-09-18,振込 ｶ)ｽｽﾞｷ,10000,110000", "2026-09-18,振込 ｶ)ｽｽﾞｷ,10000,120000"].join("\n");
    const rows = parseBankCsv(utf8(text)).rows;
    const fps = fingerprintTxns(COMPANY, rows);
    expect(new Set(fps).size).toBe(2);

    // 残高まで同じ（本当に同じ内容の 2 行）でも別の指紋になる
    const same: ParsedTxn[] = [
      { txnDate: "2026-09-18", description: "振込 カ)スズキ", amount: 10000, balance: 110000, raw: "" },
      { txnDate: "2026-09-18", description: "振込 カ)スズキ", amount: 10000, balance: 110000, raw: "" },
    ];
    const sameFps = fingerprintTxns(COMPANY, same);
    expect(new Set(sameFps).size).toBe(2);
    expect(sameFps[0]).toBe(fingerprintTxn(COMPANY, same[0]));
    expect(sameFps[1]).toBe(`${sameFps[0]}#2`);
  });

  it("摘要の書き方の揺れ（半角カナ・全角空白）は同じ指紋になる", () => {
    const a: ParsedTxn = { txnDate: "2026-09-18", description: "ﾌﾘｺﾐ ｶ)ﾀﾅｶ", amount: 1000, balance: null, raw: "" };
    const b: ParsedTxn = { txnDate: "2026-09-18", description: "フリコミ　カ)タナカ", amount: 1000, balance: null, raw: "" };
    expect(fingerprintTxn(COMPANY, a)).toBe(fingerprintTxn(COMPANY, b));
  });
});

// ---------------------------------------------------------------------------
// 摘要の正規化・取り込みの要約
// ---------------------------------------------------------------------------

describe("normalizeDescription / matchKey / clientKey", () => {
  it("全角→半角・半角カナ→全角カナ・空白の圧縮", () => {
    expect(normalizeDescription("ﾌﾘｺﾐ　　ｶ)ﾛｰﾃｨﾌﾞ")).toBe("フリコミ カ)ローティブ");
    expect(normalizeDescription("  ＡＴＭ  引出 ")).toBe("ATM 引出");
    expect(normalizeDescription(null)).toBe("");
  });

  it("照合キーは記号・空白を落としてカタカナに揃える", () => {
    expect(matchKey("ふりこみ ｶ)ﾀﾅｶ")).toBe(matchKey("フリコミカ)タナカ"));
  });

  it("取引先名は法人格を落として照合する", () => {
    expect(clientKey("株式会社タナカ商事")).toBe(clientKey("タナカ商事"));
    expect(clientKey("㈱タナカ商事")).toBe(clientKey("タナカ商事"));
  });
});

describe("summarizeImport（取り込みの要約）", () => {
  it("件数・期間・入出金の合計", () => {
    const rows = parseBankCsv(utf8Bom(CSV_TWO_COLUMN)).rows;
    expect(summarizeImport(rows)).toEqual({ count: 3, from: "2026-09-18", to: "2026-09-30", inflow: 330000, outflow: 50440, net: 279560 });
  });

  it("0 件でも落ちない", () => {
    expect(summarizeImport([])).toEqual({ count: 0, from: null, to: null, inflow: 0, outflow: 0, net: 0 });
  });
});

// ---------------------------------------------------------------------------
// 請求書の候補
// ---------------------------------------------------------------------------

const invoice = (over: Partial<InvoiceCandidate> & { id: string }): InvoiceCandidate => ({
  invoiceNo: "INV-2609-001",
  clientName: "株式会社タナカ商事",
  total: 330000,
  status: "issued",
  month: "2026-09",
  issueDate: "2026-09-30",
  dueDate: "2026-10-31",
  ...over,
});

describe("suggestInvoiceMatches（消込先の候補）", () => {
  const txn = { txnDate: "2026-10-31", description: "振込 カ)タナカショウジ", amount: 330000 };

  it("金額の一致を最優先し、次に取引先名が摘要に含まれるもの", () => {
    const candidates = [
      invoice({ id: "name-only", clientName: "株式会社タナカショウジ", total: 500000, invoiceNo: "INV-A" }),
      invoice({ id: "amount-only", clientName: "スズキ運輸", total: 330000, invoiceNo: "INV-B" }),
      invoice({ id: "both", clientName: "タナカショウジ", total: 330000, invoiceNo: "INV-C" }),
      invoice({ id: "none", clientName: "サトウ物流", total: 120000, invoiceNo: "INV-D" }),
    ];
    const res = suggestInvoiceMatches(txn, candidates);
    expect(res.map((r) => r.invoice.id)).toEqual(["both", "amount-only", "name-only"]);
    expect(res[0].reasons).toContain("金額が一致");
    expect(res[0].reasons).toContain("取引先名が摘要に含まれる");
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  it("摘要がカナだけでも、取引先名の先頭が一致すれば候補に出す（漢字の社名）", () => {
    const res = suggestInvoiceMatches(txn, [invoice({ id: "kana", clientName: "株式会社タナカ商事", total: 500000 })]);
    expect(res).toHaveLength(1);
    expect(res[0].reasons).toContain("取引先名の一部が摘要に含まれる");
  });

  it("どれにも当たらない請求書は候補に出さない", () => {
    expect(suggestInvoiceMatches(txn, [invoice({ id: "x", clientName: "サトウ物流", total: 1000 })])).toEqual([]);
  });

  it("振込手数料を引かれた入金は「金額がほぼ一致」で拾う", () => {
    const res = suggestInvoiceMatches({ ...txn, amount: 329560 }, [invoice({ id: "fee", clientName: "スズキ運輸", total: 330000 })]);
    expect(res).toHaveLength(1);
    expect(res[0].reasons).toContain("金額がほぼ一致");
  });

  it("最大 5 件まで（スコア順）", () => {
    const many = Array.from({ length: 8 }, (_, i) => invoice({ id: `i${i}`, invoiceNo: `INV-${i}`, clientName: "スズキ運輸", total: 330000 }));
    const res = suggestInvoiceMatches(txn, many);
    expect(res).toHaveLength(5);
    expect(res.map((r) => r.score)).toEqual([...res.map((r) => r.score)].sort((a, b) => b - a));
  });
});

// ---------------------------------------------------------------------------
// CSV 出力
// ---------------------------------------------------------------------------

const txnRow = (over: Partial<BankTransactionRow> = {}): BankTransactionRow => ({
  id: "33333333-3333-4333-8333-333333333333",
  company_id: COMPANY,
  import_id: "44444444-4444-4444-8444-444444444444",
  txn_date: "2026-09-18",
  description: "振込 カ)タナカショウジ",
  amount: 330000,
  balance: 1530000,
  status: "matched",
  invoice_id: "55555555-5555-4555-8555-555555555555",
  expense_id: null,
  auto_matched: true,
  memo: "",
  created_at: "2026-09-19T01:00:00Z",
  invoice_no: "INV-2609-001",
  invoice_total: 330000,
  client_name: "株式会社タナカ商事",
  expense_label: "",
  import_file_name: "meisai.csv",
  ...over,
});

describe("bankCsv（銀行明細 CSV）", () => {
  it("BOM・CRLF・ヘッダー行", () => {
    const csv = bankCsv([txnRow()]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain([...BANK_CSV_HEADERS].join(","));
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("入金と出金を分け、数値は生の値で出す", () => {
    expect(bankCsvRow(txnRow())).toEqual([
      "2026-09-18",
      "振込 カ)タナカショウジ",
      "330000",
      "0",
      "1530000",
      "消込済み",
      "自動",
      "INV-2609-001",
      "株式会社タナカ商事",
      "meisai.csv",
      "",
    ]);
    const out = bankCsvRow(txnRow({ amount: -50000, status: "unmatched", auto_matched: false, invoice_no: "", client_name: "" }));
    expect(out[2]).toBe("0");
    expect(out[3]).toBe("50000");
    expect(out[5]).toBe("未消込");
    expect(out[6]).toBe("");
  });

  it("カンマ・改行を含む摘要を引用符で囲む", () => {
    expect(bankCsv([txnRow({ description: 'ﾌﾘｺﾐ,"A"' })])).toContain('"ﾌﾘｺﾐ,""A"""');
  });

  it("ファイル名は絞り込みごと", () => {
    expect(bankCsvFilename("unmatched")).toBe("銀行明細_未消込.csv");
    expect(bankCsvFilename("all")).toBe("銀行明細_すべて.csv");
  });
});

// ---------------------------------------------------------------------------
// スキーマ
// ---------------------------------------------------------------------------

describe("lib/schemas/bank", () => {
  it("?status= は未指定・不正なら未消込", () => {
    expect(bankStatusFromParam(undefined)).toBe("unmatched");
    expect(bankStatusFromParam("matched")).toBe("matched");
    expect(bankStatusFromParam(["ignored"])).toBe("ignored");
    expect(bankStatusFromParam("all")).toBe("all");
    expect(bankStatusFromParam("なにか")).toBe("unmatched");
  });

  it("拡張子は .csv / .txt のみ", () => {
    expect(isBankCsvFileName("meisai.csv")).toBe(true);
    expect(isBankCsvFileName("MEISAI.CSV")).toBe(true);
    expect(isBankCsvFileName("meisai.txt")).toBe(true);
    expect(isBankCsvFileName("meisai.xlsx")).toBe(false);
  });

  it("2MB を超えるファイル・拡張子違いは日本語で弾く", () => {
    expect(bankCsvFileSchema.safeParse({ name: "meisai.csv", size: 1024 }).success).toBe(true);
    const tooBig = bankCsvFileSchema.safeParse({ name: "meisai.csv", size: MAX_BANK_CSV_BYTES + 1 });
    expect(tooBig.success).toBe(false);
    expect(bankCsvFileSchema.safeParse({ name: "meisai.pdf", size: 10 }).success).toBe(false);
  });

  it("手で設定できる状態は未消込・対象外のみ（消込は RPC bank_match_invoice）", () => {
    expect(setBankTxnStatusSchema.safeParse({ txn_id: COMPANY, status: "ignored" }).success).toBe(true);
    expect(setBankTxnStatusSchema.safeParse({ txn_id: COMPANY, status: "matched" }).success).toBe(false);
    expect(matchBankTxnSchema.safeParse({ txn_id: COMPANY, invoice_id: "x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 画面用の純関数
// ---------------------------------------------------------------------------

describe("components/bank/helpers", () => {
  it("取り込み結果のサマリー文", () => {
    expect(importResultMessage({ inserted: 45, matched: 3, skipped: 2 })).toBe("45 件を取り込み、3 件を自動で消し込みました。2 件は取り込み済みのため飛ばしました。");
    expect(importResultMessage({ inserted: 10, matched: 0, skipped: 0 })).toBe("10 件を取り込みました。");
    expect(importResultMessage({ inserted: 0, matched: 0, skipped: 12 })).toBe("新しく取り込んだ明細はありませんでした。12 件は取り込み済みのため飛ばしました。");
    expect(importResultMessage({ inserted: 3, matched: 1, skipped: 0, failed: 2 })).toContain("2 行は読み取れませんでした。");
  });

  it("ビューの行を画面用に整える（null を安全な既定値へ）", () => {
    const row = toTxnRow(txnRow());
    expect(row).toMatchObject({ txnDate: "2026-09-18", amount: 330000, status: "matched", invoiceNo: "INV-2609-001", autoMatched: true });
    const empty = toTxnRow({ ...txnRow(), id: null, amount: null, balance: null, status: null, description: null, auto_matched: null });
    expect(empty).toMatchObject({ id: "", amount: 0, balance: null, status: "unmatched", description: "", autoMatched: false });
  });

  it("未入金の請求書を候補の形にする", () => {
    const listRow = {
      id: "55555555-5555-4555-8555-555555555555",
      invoice_no: "INV-2609-001",
      client_name: "株式会社タナカ商事",
      total: 330000,
      status: "issued",
      month: "2026-09-01",
      issue_date: "2026-09-30",
      due_date: "2026-10-31",
    } as InvoiceListRow;
    expect(toInvoiceCandidate(listRow)).toMatchObject({ invoiceNo: "INV-2609-001", total: 330000, month: "2026-09", dueDate: "2026-10-31" });
  });

  it("取り込み履歴の行", () => {
    const imp = {
      id: "44444444-4444-4444-8444-444444444444",
      company_id: COMPANY,
      file_name: "meisai.csv",
      format: "1列型（金額）",
      row_count: 47,
      inserted_count: 45,
      skipped_count: 2,
      matched_count: 3,
      period_from: "2026-09-01",
      period_to: "2026-09-30",
      created_by: null,
      created_at: "2026-10-01T00:00:00Z",
    } satisfies BankImport;
    expect(toImportRow(imp)).toMatchObject({ fileName: "meisai.csv", rowCount: 47, insertedCount: 45, matchedCount: 3 });
  });

  it("集計（入金・出金・未消込）", () => {
    const rows = [
      toTxnRow(txnRow({ id: "a", amount: 330000, status: "unmatched", invoice_id: null })),
      toTxnRow(txnRow({ id: "b", amount: -50000, status: "unmatched", invoice_id: null })),
      toTxnRow(txnRow({ id: "c", amount: 120000, status: "matched" })),
    ];
    expect(bankTotals(rows)).toEqual({ count: 3, inflow: 450000, outflow: 50000, unmatchedCount: 2, unmatchedInflow: 330000 });
  });

  it("リンクと日付の表示", () => {
    expect(bankStatusHref("matched")).toBe("/bank?status=matched");
    expect(bankExportUrl("all")).toBe("/api/export/bank.csv?status=all");
    expect(shortDate("2026-09-18")).toBe("9/18");
  });
});
