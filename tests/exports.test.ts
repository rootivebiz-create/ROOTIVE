import { describe, expect, it } from "vitest";
import { CSV_BOM, ENTRIES_CSV_HEADERS, PAYOUTS_CSV_HEADERS, csvCell, entriesToCsv, entryToCsvRow, monthFileLabel, payoutToCsvRow, payoutsToCsv, toCsv, type EntryCsvSource, type PayoutCsvSource } from "@/lib/exports/csv";
import { STATEMENT_CSV_HEADERS, statementToCsv, statementToCsvRows } from "@/lib/exports/statement-csv";
import { asciiFallbackName, contentDisposition, encodeRfc5987, safeFilePart, timestampJST } from "@/lib/exports/download";
import type { StatementData } from "@/lib/statement";

describe("toCsv", () => {
  it("先頭に UTF-8 BOM、行区切りは CRLF、末尾にも CRLF", () => {
    const csv = toCsv([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${CSV_BOM}a,b\r\n1,2\r\n`);
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("ダブルクォート・カンマ・改行を含むセルは引用符で囲み、引用符は二重にする", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("普通の文字")).toBe("普通の文字");
    const csv = toCsv([["備考", 'x,"y"']]);
    expect(csv).toBe(`${CSV_BOM}備考,"x,""y"""\r\n`);
  });

  it("null / undefined は空、数値はそのまま", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(27462.6)).toBe("27462.6");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("稼働明細 CSV", () => {
  const entry: EntryCsvSource = {
    month: "2026-09-01",
    driver_name: "相曽慧",
    project_name: "三郷Amazon",
    item_name: "標準",
    unit: "day",
    qty: 21,
    bill_rate: 23025,
    pay_rate: 21780,
    bill: 483525,
    pay: 457380,
    margin: 26145,
    royalty_rate: 0.1,
    royalty: 45738,
    entry_profit: 71883,
    memo: "備考, あり",
  };

  it("列並びが §8.1 のとおり", () => {
    expect([...ENTRIES_CSV_HEADERS]).toEqual(["稼動月", "ドライバー", "案件", "内容", "区分", "数量", "受注単価", "支払単価", "会社売上", "ドライバー売上", "単価差額利益", "ロイヤリティ率", "ロイヤリティ額", "行の利益", "備考"]);
    const csv = entriesToCsv([entry]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(ENTRIES_CSV_HEADERS.join(","));
    expect(lines[1]).toBe('2026-09,相曽慧,三郷Amazon,標準,日給,21,23025,21780,483525,457380,26145,0.1,45738,71883,"備考, あり"');
    expect(lines[2]).toBe("");
  });

  it("稼動月は YYYY-MM、区分は日本語、率は 0.1 のような率、数値は生の値（カンマ無し）", () => {
    const row = entryToCsvRow({ ...entry, unit: "piece", qty: 803, bill_rate: 180, pay_rate: 162, bill: 144540, pay: 130086, margin: 14454, royalty: 13008.6, entry_profit: 27462.6, memo: "" });
    expect(row[0]).toBe("2026-09");
    expect(row[4]).toBe("個数");
    expect(row[5]).toBe("803");
    expect(row[8]).toBe("144540");
    expect(row[11]).toBe("0.1");
    expect(row[12]).toBe("13008.6");
    expect(row[13]).toBe("27462.6");
    expect(row.length).toBe(ENTRIES_CSV_HEADERS.length);
  });

  it("null の列は空文字か 0 になる", () => {
    const row = entryToCsvRow({ ...entry, month: null, driver_name: null, unit: null, qty: null, memo: null });
    expect(row[0]).toBe("");
    expect(row[1]).toBe("");
    expect(row[4]).toBe("");
    expect(row[5]).toBe("0");
    expect(row[14]).toBe("");
  });
});

describe("支払一覧 CSV", () => {
  it("列並びが §8.1 のとおり", () => {
    expect([...PAYOUTS_CSV_HEADERS]).toEqual(["稼動月", "ドライバー", "会社売上", "ドライバー売上", "単価差額利益", "ロイヤリティ", "管理費", "調整", "支払額", "会社利益"]);
    const row: PayoutCsvSource = { month: "2026-09-01", driver_name: "相曽慧", bill: 483525, pay: 457380, margin: 26145, royalty: 45738, mgmt_fee: 14999, adj_pay: 0, payout: 396643, driver_profit: 86882 };
    expect(payoutToCsvRow(row)).toEqual(["2026-09", "相曽慧", "483525", "457380", "26145", "45738", "14999", "0", "396643", "86882"]);
    const lines = payoutsToCsv([row]).slice(1).split("\r\n");
    expect(lines[0]).toBe(PAYOUTS_CSV_HEADERS.join(","));
    expect(lines[1]).toBe("2026-09,相曽慧,483525,457380,26145,45738,14999,0,396643,86882");
  });

  it("ファイル名の月部分", () => {
    expect(monthFileLabel("2026-09")).toBe("2026-09");
    expect(monthFileLabel("all")).toBe("全期間");
  });
});

const statement: StatementData = {
  month: "2026-09",
  monthLabel: "2026年9月",
  driverId: "d1",
  driverName: "相曽慧",
  company: { name: "株式会社ROOTIVE", address: "", tel: "", invoice_reg_no: "", statement_note: "", payout_month_offset: 1, payout_day: 0 },
  payoutDate: "2026-10-31",
  payoutDateLabel: "2026年10月31日",
  issuedAt: "2026-09-16",
  entries: [
    { id: "e1", projectName: "三郷Amazon", itemName: "標準", unit: "day", qty: 21, payRate: 21780, pay: 457380, billRate: 23025, bill: 483525, margin: 26145, royaltyRate: 0.1, royalty: 45738, entryProfit: 71883, memo: "" },
  ],
  adjustments: [
    { id: "a1", label: "リース代", amount: -3000, countAsProfit: true, recurringId: null, sortOrder: 0 },
    { id: "a2", label: "立替精算", amount: 2000, countAsProfit: false, recurringId: null, sortOrder: 1 },
  ],
  pay: 457380,
  royalty: 45738,
  mgmtFee: 14999,
  mgmtFeeSetting: 14999,
  driverDefaultMgmtFee: 15000,
  adjPay: -1000,
  adjProfit: 3000,
  payout: 395643,
  bill: 483525,
  margin: 26145,
  driverProfit: 89882,
  profitRate: 0.1859,
  isClosed: true,
  driverMonthId: "dm1",
  memo: "社内メモ",
  royaltyRate: 0.1,
};

describe("個人明細 CSV", () => {
  it("種別・案件・内容・数量・単価・金額・備考 の順で、控除はマイナス、支払額の行を除いた金額の合計 ＝ 支払額", () => {
    const rows = statementToCsvRows(statement);
    expect(rows[0]).toEqual([...STATEMENT_CSV_HEADERS]);
    expect(rows[1]).toEqual(["稼働", "三郷Amazon", "標準", "21", "21780", "457380", ""]);
    expect(rows[2]).toEqual(["ロイヤリティ", "", "率 10.0%", "", "", "-45738", ""]);
    expect(rows[3]).toEqual(["管理費", "", "", "", "", "-14999", ""]);
    expect(rows[4]).toEqual(["調整", "", "リース代", "", "", "-3000", ""]);
    expect(rows[5]).toEqual(["調整", "", "立替精算", "", "", "2000", ""]);
    expect(rows[6]).toEqual(["支払額", "", "", "", "", "395643", "振込予定日 2026年10月31日"]);
    const sum = rows.slice(1, -1).reduce((acc, r) => acc + Number(r[5]), 0);
    expect(sum).toBe(395643);
  });

  it("会社売上・利益・社内メモは含めない", () => {
    const csv = statementToCsv(statement);
    expect(csv).not.toContain("483525");
    expect(csv).not.toContain("89882");
    expect(csv).not.toContain("社内メモ");
    expect(csv).not.toContain("会社利益");
  });

  it("ロイヤリティ率を隠せる（ドライバー向け）。管理費 0 の月は管理費の行を出さない", () => {
    const rows = statementToCsvRows({ ...statement, mgmtFee: 0 }, { showRoyaltyRate: false });
    expect(rows[2][2]).toBe("");
    expect(rows.some((r) => r[0] === "管理費")).toBe(false);
  });
});

describe("ダウンロード応答", () => {
  it("日本語ファイル名は ASCII の代替名と RFC 5987 の両方を付ける", () => {
    const cd = contentDisposition("稼働明細_2026-09.csv");
    expect(cd).toBe(`attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent("稼働明細_2026-09.csv")}`);
    expect(contentDisposition("backup_20260916_1200.json")).toBe(`attachment; filename="backup_20260916_1200.json"; filename*=UTF-8''backup_20260916_1200.json`);
  });

  it("RFC 5987 では ' ( ) * も符号化する", () => {
    expect(encodeRfc5987("a'b(c)*.pdf")).toBe("a%27b%28c%29%2A.pdf");
    expect(asciiFallbackName('bad"name.pdf')).toBe("export.pdf");
    expect(asciiFallbackName("名前")).toBe("export");
  });

  it("ファイル名に使えない文字を置き換える", () => {
    expect(safeFilePart("山田/太郎:テスト")).toBe("山田_太郎_テスト");
    expect(safeFilePart("  ")).toBe("_");
  });

  it("バックアップのタイムスタンプは日本時間 YYYYMMDD_HHMM", () => {
    expect(timestampJST(new Date("2026-09-16T15:04:00Z"))).toBe("20260917_0004");
    expect(timestampJST(new Date("2026-01-05T01:02:00Z"))).toBe("20260105_1002");
  });
});
