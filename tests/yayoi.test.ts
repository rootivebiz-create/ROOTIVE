import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { DEFAULT_YAYOI_ACCOUNTS, resolveYayoiAccounts } from "@/lib/yayoi/accounts";
import { YAYOI_COLUMN_COUNT, YAYOI_SUMMARY_MAX, buildYayoiRows, normalizeForCp932, toYayoiCsvBuffer, toYayoiCsvText, yayoiJournalDate, yayoiPayableBalance, type YayoiBuildInput, type YayoiDriverInput } from "@/lib/yayoi/build";

/** §2.6 相曽慧：三郷Amazon 日給 21 × 23,025/21,780、率 10%、管理費 14,999 → 支払額 396,643 */
const AISO: YayoiDriverInput = { driverId: "d1", driverName: "相曽慧", bill: 483525, pay: 457380, royalty: 45738, mgmtFee: 14999, adjustments: [] };

const base: YayoiBuildInput = { month: "2026-09", accounts: DEFAULT_YAYOI_ACCOUNTS, payoutDate: "2026-10-31", drivers: [AISO] };

describe("弥生 仕訳 CSV（§8.2）", () => {
  it("25 列・識別フラグ 2000・固定列（タイプ 0／付箋 0／調整 no）", () => {
    const rows = buildYayoiRows(base);
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect(r.length).toBe(YAYOI_COLUMN_COUNT);
      expect(r[0]).toBe("2000");
      expect(r[1]).toBe(""); // 伝票No
      expect(r[2]).toBe(""); // 決算
      expect(r[3]).toBe("2026/09/30"); // 取引日付＝稼動月末日
      expect(r[6]).toBe(""); // 借方部門
      expect(r[9]).toBe(""); // 借方税金額
      expect(r[12]).toBe(""); // 貸方部門
      expect(r[15]).toBe(""); // 貸方税金額
      expect(r[17]).toBe(""); // 番号
      expect(r[18]).toBe(""); // 期日
      expect(r[19]).toBe("0"); // タイプ
      expect(r[20]).toBe(""); // 生成元
      expect(r[21]).toBe(""); // 仕訳メモ
      expect(r[22]).toBe("0"); // 付箋1
      expect(r[23]).toBe("0"); // 付箋2
      expect(r[24]).toBe("no"); // 調整
      expect(r[8]).toBe(r[14]); // 借方金額 ＝ 貸方金額
    }
  });

  it("相曽慧：売上 483,525／外注 457,380／ロイヤリティ 45,738／管理費 14,999 → 未払金残高 396,643", () => {
    const rows = buildYayoiRows(base);
    const [sales, outsourcing, royalty, mgmt] = rows;
    // (a) 売上：借方 売掛金／貸方 売上高（税区分 課税売上）
    expect(sales.slice(4, 16)).toEqual(["売掛金", "", "", "対象外", "483525", "", "売上高", "", "", "課税売上込10%", "483525", ""]);
    expect(sales[16]).toBe("2026年9月 相曽慧 稼働分 売上");
    // (b) 外注費：借方 外注費（課対仕入）／貸方 未払金
    expect(outsourcing.slice(4, 16)).toEqual(["外注費", "", "", "課対仕入込10%", "457380", "", "未払金", "", "", "対象外", "457380", ""]);
    // (c) ロイヤリティ：借方 未払金／貸方 雑収入（補助 ロイヤリティ）
    expect(royalty.slice(4, 16)).toEqual(["未払金", "", "", "対象外", "45738", "", "雑収入", "ロイヤリティ", "", "課税売上込10%", "45738", ""]);
    expect(royalty[16]).toBe("2026年9月 相曽慧 ロイヤリティ");
    // (d) 管理費：借方 未払金／貸方 雑収入（補助 管理費）
    expect(mgmt.slice(4, 16)).toEqual(["未払金", "", "", "対象外", "14999", "", "雑収入", "管理費", "", "課税売上込10%", "14999", ""]);
    expect(mgmt[16]).toBe("2026年9月 相曽慧 管理費");
    expect(yayoiPayableBalance(rows, DEFAULT_YAYOI_ACCOUNTS)).toBe(396643);
  });

  it("調整：利益計上の控除は 未払金／雑収入（調整）、加算は逆仕訳。利益計上なしは 立替金。残高 ＝ 支払額", () => {
    const driver: YayoiDriverInput = {
      ...AISO,
      adjustments: [
        { label: "リース代相殺", amount: -3000, countAsProfit: true },
        { label: "ペナルティ返金", amount: 500, countAsProfit: true },
        { label: "立替精算", amount: 2000, countAsProfit: false },
        { label: "駐車場代控除", amount: -800, countAsProfit: false },
        { label: "ゼロ", amount: 0, countAsProfit: true },
      ],
    };
    const rows = buildYayoiRows({ ...base, drivers: [driver] });
    expect(rows.length).toBe(8); // 0 円は出さない
    const adj = rows.slice(4);
    expect(adj[0].slice(4, 16)).toEqual(["未払金", "", "", "対象外", "3000", "", "雑収入", "調整", "", "課税売上込10%", "3000", ""]);
    expect(adj[0][16]).toBe("2026年9月 相曽慧 調整 リース代相殺");
    expect(adj[1].slice(4, 16)).toEqual(["雑収入", "調整", "", "課税売上込10%", "500", "", "未払金", "", "", "対象外", "500", ""]);
    expect(adj[2].slice(4, 16)).toEqual(["立替金", "", "", "対象外", "2000", "", "未払金", "", "", "対象外", "2000", ""]);
    expect(adj[3].slice(4, 16)).toEqual(["未払金", "", "", "対象外", "800", "", "立替金", "", "", "対象外", "800", ""]);
    // payout = 457380 − 45738 − 14999 + (−3000 + 500 + 2000 − 800) = 395343
    expect(yayoiPayableBalance(rows, DEFAULT_YAYOI_ACCOUNTS)).toBe(395343);
  });

  it("金額は整数へ四捨五入する（金島幸太：803 × 162、ロイヤリティ 13,008.6 → 13,009）", () => {
    const kane: YayoiDriverInput = { driverId: "d2", driverName: "金島幸太", bill: 144540, pay: 130086, royalty: 13008.6, mgmtFee: 0, adjustments: [] };
    const rows = buildYayoiRows({ ...base, drivers: [kane] });
    expect(rows.length).toBe(3); // 管理費 0 は出さない
    expect(rows[2][8]).toBe("13009");
    expect(yayoiPayableBalance(rows, DEFAULT_YAYOI_ACCOUNTS)).toBe(130086 - 13009);
  });

  it("split_by_driver = false なら月合計 1 セット（摘要にドライバー名を入れない）", () => {
    const kane: YayoiDriverInput = { driverId: "d2", driverName: "金島幸太", bill: 144540, pay: 130086, royalty: 13008.6, mgmtFee: 0, adjustments: [{ label: "立替", amount: 1000, countAsProfit: false }] };
    const accounts = { ...DEFAULT_YAYOI_ACCOUNTS, split_by_driver: false };
    const rows = buildYayoiRows({ ...base, accounts, drivers: [AISO, kane] });
    expect(rows.length).toBe(5); // 売上・外注・ロイヤリティ・管理費・調整（立替）
    expect(rows[0][8]).toBe(String(483525 + 144540));
    expect(rows[1][8]).toBe(String(457380 + 130086));
    expect(rows[2][8]).toBe(String(Math.round(45738 + 13008.6)));
    expect(rows[3][8]).toBe("14999");
    expect(rows[4].slice(4, 16)).toEqual(["立替金", "", "", "対象外", "1000", "", "未払金", "", "", "対象外", "1000", ""]);
    expect(rows[0][16]).toBe("2026年9月 稼働分 売上");
    expect(rows.every((r) => !r[16].includes("相曽慧"))).toBe(true);
  });

  it("date_basis = payout_date なら振込予定日、month_end なら稼動月末日（うるう年も）", () => {
    expect(yayoiJournalDate("2026-09", { date_basis: "month_end" }, "2026-10-31")).toBe("2026/09/30");
    expect(yayoiJournalDate("2028-02", { date_basis: "month_end" }, "2028-03-31")).toBe("2028/02/29");
    expect(yayoiJournalDate("2026-09", { date_basis: "payout_date" }, "2026-10-31")).toBe("2026/10/31");
    const rows = buildYayoiRows({ ...base, accounts: { ...DEFAULT_YAYOI_ACCOUNTS, date_basis: "payout_date" } });
    expect(rows[0][3]).toBe("2026/10/31");
  });

  it("会社設定の科目・税区分を使う", () => {
    const accounts = resolveYayoiAccounts({ sales_debit: "売掛金（ROOTIVE）", outsourcing_credit: "買掛金", royalty_sub: "ＦＣ収入", tax_class_sales: "課税売上10%" });
    const rows = buildYayoiRows({ ...base, accounts });
    expect(rows[0][4]).toBe("売掛金（ROOTIVE）");
    expect(rows[0][13]).toBe("課税売上10%");
    expect(rows[1][10]).toBe("買掛金");
    expect(rows[2][4]).toBe("買掛金");
    expect(rows[2][11]).toBe("ＦＣ収入");
    expect(yayoiPayableBalance(rows, accounts)).toBe(396643);
  });

  it("摘要は 32 文字まで", () => {
    const driver: YayoiDriverInput = { ...AISO, driverName: "とても長い名前のドライバーさんです", adjustments: [{ label: "非常に長い調整項目の名前をここに入れてみます", amount: -100, countAsProfit: true }] };
    const rows = buildYayoiRows({ ...base, drivers: [driver] });
    for (const r of rows) expect(Array.from(r[16]).length).toBeLessThanOrEqual(YAYOI_SUMMARY_MAX);
  });

  it("ドライバーが 0 名なら空", () => {
    expect(buildYayoiRows({ ...base, drivers: [] })).toEqual([]);
    expect(toYayoiCsvText([])).toBe("");
    expect(toYayoiCsvBuffer([]).length).toBe(0);
  });

  it("Shift_JIS（cp932）・CRLF・ヘッダー無し・BOM 無し", () => {
    const rows = buildYayoiRows(base);
    const buf = toYayoiCsvBuffer(rows);
    expect(buf[0]).not.toBe(0xef); // BOM 無し
    const text = iconv.decode(buf, "cp932");
    const lines = text.split("\r\n");
    expect(lines.length).toBe(rows.length + 1); // 末尾 CRLF
    expect(lines[lines.length - 1]).toBe("");
    expect(lines[0].startsWith("2000,,,2026/09/30,売掛金,")).toBe(true);
    expect(lines[0].split(",").length).toBe(YAYOI_COLUMN_COUNT);
    expect(text).not.toContain("\n\n");
    expect(text).not.toMatch(/[^\r]\n/);
    // 素の Shift_JIS では文字化けする記号も cp932 なら保持される
    const sjis = iconv.decode(iconv.encode("髙橋", "cp932"), "cp932");
    expect(sjis).toBe("髙橋");
  });

  it("〜 などの JIS 系記号は cp932 の対応文字へ寄せる", () => {
    expect(normalizeForCp932("9:00〜18:00 −100 —")).toBe("9:00～18:00 －100 ―");
    const buf = toYayoiCsvBuffer([["2000", "", "", "2026/09/30", "未払金", "", "", "対象外", "1", "", "雑収入", "", "", "対象外", "1", "", "9:00〜18:00", "", "", "0", "", "", "0", "0", "no"]]);
    expect(iconv.decode(buf, "cp932")).toContain("9:00～18:00");
  });

  it("カンマ・引用符を含む摘要は引用符で囲む", () => {
    const text = toYayoiCsvText([["2000", "", "", "2026/09/30", "未払金", "", "", "対象外", "1", "", "雑収入", "", "", "対象外", "1", "", 'a,b "c"', "", "", "0", "", "", "0", "0", "no"]]);
    expect(text).toContain(',"a,b ""c""",');
  });
});
