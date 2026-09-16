import { describe, expect, it } from "vitest";
import {
  applyRounding,
  calcCompanyMonth,
  calcDriverMonth,
  calcEntry,
  parseNumberInput,
  parsePercentInput,
  resolveEntryDefaults,
  resolveRoundingMode,
  roundDisplay,
  sumMoney,
  type DriverMonthInput,
  type EntryInput,
} from "@/lib/calc";
import { addMonths, currentMonthJST, monthToDate, payoutDate } from "@/lib/month";
import { rawNumber, yen } from "@/lib/format";

const e = (qty: number, billRate: number, payRate: number, royaltyRate: number): EntryInput => ({
  qty,
  billRate,
  payRate,
  royaltyRate,
  roundingMode: "none",
});

/** §2.6 計算テストケース（端数処理＝丸めない） */
const CASES: { name: string; input: DriverMonthInput; profit: number; payout: number; bill: number }[] = [
  {
    name: "相曽慧 三郷Amazon 日給 21 × 23,025/21,780 10% 管理費 14,999",
    input: { entries: [e(21, 23025, 21780, 0.1)], mgmtFee: 14999, adjustments: [] },
    profit: 86882,
    payout: 396643,
    bill: 483525,
  },
  {
    name: "金島幸太 にほんばし蔵前郵便局 個数 803 × 180/162 10% 管理費 0",
    input: { entries: [e(803, 180, 162, 0.1)], mgmtFee: 0, adjustments: [] },
    profit: 27462.6,
    payout: 117077.4,
    bill: 144540,
  },
  {
    name: "沼田基 にほんばし蔵前郵便局 個数 803 × 180/162 10% 管理費 15,000",
    input: { entries: [e(803, 180, 162, 0.1)], mgmtFee: 15000, adjustments: [] },
    profit: 42462.6,
    payout: 102077.4,
    bill: 144540,
  },
  {
    name: "今井皇輝 和光ヤマト 宅急便 1,398 (180/162) + ネコポス 749 (50/50) 10% 管理費 15,000",
    input: { entries: [e(1398, 180, 162, 0.1), e(749, 50, 50, 0.1)], mgmtFee: 15000, adjustments: [] },
    profit: 66556.6,
    payout: 222533.4,
    bill: 289090,
  },
  {
    name: "藤田裕介 Temu 日給 21 × 23,025/21,960 10% 管理費 0",
    input: { entries: [e(21, 23025, 21960, 0.1)], mgmtFee: 0, adjustments: [] },
    profit: 68481,
    payout: 415044,
    bill: 483525,
  },
  {
    name: "石田泰典 川口領家Amazon 日給 16 × 21,133/20,250 12.5% 管理費 15,000",
    input: { entries: [e(16, 21133, 20250, 0.125)], mgmtFee: 15000, adjustments: [] },
    profit: 69628,
    payout: 268500,
    bill: 338128,
  },
  {
    name: "黒岩亜夢莉 三郷Amazon 日給 21 × 23,025/21,780 12.5% 管理費 15,000",
    input: { entries: [e(21, 23025, 21780, 0.125)], mgmtFee: 15000, adjustments: [] },
    profit: 98317.5,
    payout: 385207.5,
    bill: 483525,
  },
  {
    name: "川島幹太 三郷Amazon 8 日 (23,025/0) + 辰巳屋興業 1 日 (8,500/0) 0% 管理費 0",
    input: { entries: [e(8, 23025, 0, 0), e(1, 8500, 0, 0)], mgmtFee: 0, adjustments: [] },
    profit: 192700,
    payout: 0,
    bill: 192700,
  },
];

describe("§2.6 計算テストケース", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = calcDriverMonth(c.input);
      expect(r.driverProfit).toBeCloseTo(c.profit, 2);
      expect(r.payout).toBeCloseTo(c.payout, 2);
      expect(r.bill).toBeCloseTo(c.bill, 2);
      // 恒等式：Σbill = payout + driver_profit（利益計上なしの調整が無い場合）
      expect(r.payout + r.driverProfit).toBeCloseTo(r.bill, 2);
    });
  }

  it("10 行の合計：売上 2,559,573 / 利益 652,490.3 / 支払 1,907,082.7", () => {
    const all = calcCompanyMonth(CASES.map((c) => calcDriverMonth(c.input)));
    expect(all.entryCount).toBe(10);
    expect(all.driverCount).toBe(8);
    expect(all.bill).toBeCloseTo(2559573, 2);
    expect(all.profit).toBeCloseTo(652490.3, 2);
    expect(all.payout).toBeCloseTo(1907082.7, 2);
    expect(all.profitRate).toBeCloseTo(652490.3 / 2559573, 6);
  });
});

describe("稼働行の計算", () => {
  it("bill / pay / margin / royalty / entry_profit", () => {
    const r = calcEntry(e(21, 23025, 21780, 0.1));
    expect(r.bill).toBe(483525);
    expect(r.pay).toBe(457380);
    expect(r.margin).toBe(26145);
    expect(r.royalty).toBe(45738);
    expect(r.entryProfit).toBe(71883);
  });
  it("個数型の小数ロイヤリティ（丸めない）", () => {
    const r = calcEntry(e(803, 180, 162, 0.1));
    expect(r.royalty).toBeCloseTo(13008.6, 6);
    expect(r.entryProfit).toBeCloseTo(27462.6, 6);
  });
  it("端数処理 floor / round / ceil", () => {
    const base = e(803, 180, 162, 0.1); // royalty 13008.6
    expect(calcEntry({ ...base, roundingMode: "floor" }).royalty).toBe(13008);
    expect(calcEntry({ ...base, roundingMode: "round" }).royalty).toBe(13009);
    expect(calcEntry({ ...base, roundingMode: "ceil" }).royalty).toBe(13009);
    const half = e(1, 100, 25, 0.1); // 2.5
    expect(calcEntry({ ...half, roundingMode: "round" }).royalty).toBe(3);
    expect(calcEntry({ ...half, roundingMode: "floor" }).royalty).toBe(2);
    expect(calcEntry({ ...half, roundingMode: "ceil" }).royalty).toBe(3);
    const small = e(1, 100, 24, 0.1); // 2.4
    expect(calcEntry({ ...small, roundingMode: "round" }).royalty).toBe(2);
  });
  it("数量 0 の行はすべて 0", () => {
    const r = calcEntry(e(0, 23025, 21780, 0.1));
    expect(r).toEqual({ bill: 0, pay: 0, margin: 0, royalty: 0, entryProfit: 0 });
  });
  it("小数の数量（0.5 日）", () => {
    const r = calcEntry(e(0.5, 23025, 21780, 0.1));
    expect(r.bill).toBe(11512.5);
    expect(r.pay).toBe(10890);
    expect(r.royalty).toBe(1089);
  });
  it("浮動小数点誤差が出ない（0.1 × 3 など）", () => {
    const r = calcEntry(e(3, 0.1, 0.1, 0.1));
    expect(r.bill).toBe(0.3);
    expect(r.pay).toBe(0.3);
    expect(r.royalty).toBe(0.03);
  });
});

describe("applyRounding（負数を含む）", () => {
  it("floor は −∞ 方向、ceil は +∞ 方向、round は 0 から遠い方向", () => {
    expect(applyRounding(-2.5, "floor")).toBe(-3);
    expect(applyRounding(-2.5, "ceil")).toBe(-2);
    expect(applyRounding(-2.5, "round")).toBe(-3);
    expect(applyRounding(-2.4, "round")).toBe(-2);
    expect(applyRounding(2.5, "round")).toBe(3);
    expect(applyRounding(2.0, "ceil")).toBe(2);
    expect(applyRounding(2.0000001, "floor")).toBe(2);
    expect(applyRounding(1234.5678, "none")).toBe(1234.5678);
  });
  it("表示丸め：四捨五入、負数は 0 から遠い方向", () => {
    expect(roundDisplay(2.5)).toBe(3);
    expect(roundDisplay(-2.5)).toBe(-3);
    expect(roundDisplay(27462.6)).toBe(27463);
    expect(roundDisplay(-0.4)).toBe(0);
    expect(yen(-1234.5)).toBe("-¥1,235");
    expect(yen(652490.3)).toBe("¥652,490");
    expect(yen(0)).toBe("¥0");
  });
  it("rawNumber は最大 4 桁で末尾 0 を除去", () => {
    expect(rawNumber(27462.6)).toBe("27462.6");
    expect(rawNumber(100)).toBe("100");
    expect(rawNumber(0.125)).toBe("0.125");
    expect(rawNumber(-13008.6)).toBe("-13008.6");
  });
});

describe("ドライバー × 月", () => {
  it("数量 0 の行だけの月は管理費を計上しない（前月から複製直後）", () => {
    const r = calcDriverMonth({ entries: [e(0, 23025, 21780, 0.1)], mgmtFee: 15000, adjustments: [] });
    expect(r.mgmtFee).toBe(0);
    expect(r.mgmtFeeSetting).toBe(15000);
    expect(r.payout).toBe(0);
    expect(r.driverProfit).toBe(0);
  });
  it("稼働行が 1 件も無い月は管理費を計上しない", () => {
    const r = calcDriverMonth({ entries: [], mgmtFee: 15000, adjustments: [] });
    expect(r.mgmtFee).toBe(0);
    expect(r.payout).toBe(0);
  });
  it("数量 > 0 の行が 1 件でもあれば管理費を 1 回だけ計上", () => {
    const r = calcDriverMonth({
      entries: [e(0, 23025, 21780, 0.1), e(1, 23025, 21780, 0.1), e(2, 180, 162, 0.1)],
      mgmtFee: 15000,
      adjustments: [],
    });
    expect(r.mgmtFee).toBe(15000);
    expect(r.activeEntryCount).toBe(2);
    expect(r.entryCount).toBe(3);
  });
  it("調整：控除はマイナス、利益計上にチェックした分だけ会社利益へ", () => {
    const base = { entries: [e(21, 23025, 21780, 0.1)], mgmtFee: 15000 };
    // リース代 -30,000（利益計上あり）
    const a = calcDriverMonth({ ...base, adjustments: [{ amount: -30000, countAsProfit: true }] });
    expect(a.payout).toBe(457380 - 45738 - 15000 - 30000);
    expect(a.driverProfit).toBe(26145 + 45738 + 15000 + 30000);
    expect(a.payout + a.driverProfit).toBeCloseTo(a.bill, 2);
    // 立替精算 +5,000（利益計上なし）→ 支払は増えるが利益は変わらない
    const b = calcDriverMonth({ ...base, adjustments: [{ amount: 5000, countAsProfit: false }] });
    expect(b.payout).toBe(457380 - 45738 - 15000 + 5000);
    expect(b.driverProfit).toBe(26145 + 45738 + 15000);
    expect(b.adjPay).toBe(5000);
    expect(b.adjProfit).toBe(0);
    // 恒等式は利益計上なしの調整分だけ崩れる
    expect(b.payout + b.driverProfit - b.bill).toBeCloseTo(5000, 2);
    // 加算（利益計上あり）は会社利益を減らす
    const c = calcDriverMonth({ ...base, adjustments: [{ amount: 5000, countAsProfit: true }] });
    expect(c.driverProfit).toBe(26145 + 45738 + 15000 - 5000);
  });
  it("会社 × 月の利益率（売上 0 なら 0）", () => {
    const zero = calcCompanyMonth([calcDriverMonth({ entries: [], mgmtFee: 15000, adjustments: [] })]);
    expect(zero.profitRate).toBe(0);
    expect(zero.bill).toBe(0);
  });
});

describe("マスタからの自動入力（§2.5）", () => {
  const company = { defaultRoyaltyRate: 0.1, roundingMode: "none" as const };
  it("個別単価 → 案件内容の順、率と端数処理はドライバー → 会社の順", () => {
    const d = resolveEntryDefaults({
      item: { billRate: 23025, payRate: 21780 },
      override: { payRate: 21960 },
      driver: { royaltyRate: 0.125, roundingMode: "floor" },
      company,
    });
    expect(d).toMatchObject({
      billRate: 23025,
      payRate: 21960,
      royaltyRate: 0.125,
      roundingMode: "floor",
      billRateSource: "item",
      payRateSource: "override",
      royaltySource: "driver",
      roundingSource: "driver",
    });
  });
  it("ドライバー別単価は受注単価も上書きできる（片方だけの上書きも可）", () => {
    const both = resolveEntryDefaults({
      item: { billRate: 23025, payRate: 21780 },
      override: { billRate: 23500, payRate: 21960 },
      driver: { royaltyRate: null, roundingMode: null },
      company,
    });
    expect(both).toMatchObject({ billRate: 23500, payRate: 21960, billRateSource: "override", payRateSource: "override" });
    const billOnly = resolveEntryDefaults({
      item: { billRate: 23025, payRate: 21780 },
      override: { billRate: 23100, payRate: null },
      driver: { royaltyRate: null, roundingMode: null },
      company,
    });
    expect(billOnly).toMatchObject({ billRate: 23100, payRate: 21780, billRateSource: "override", payRateSource: "item" });
    const payZero = resolveEntryDefaults({
      item: { billRate: 23025, payRate: 21780 },
      override: { payRate: 0 },
      driver: { royaltyRate: 0, roundingMode: null },
      company,
    });
    // 支払 0（オーナー本人）は「上書きあり」として扱う
    expect(payZero).toMatchObject({ billRate: 23025, payRate: 0, billRateSource: "item", payRateSource: "override" });
  });
  it("個別設定が無ければ標準値", () => {
    const d = resolveEntryDefaults({
      item: { billRate: 23025, payRate: 21780 },
      override: null,
      driver: { royaltyRate: null, roundingMode: null },
      company,
    });
    expect(d).toMatchObject({
      billRate: 23025,
      payRate: 21780,
      royaltyRate: 0.1,
      roundingMode: "none",
      billRateSource: "item",
      payRateSource: "item",
      royaltySource: "company",
      roundingSource: "company",
    });
  });
  it("端数処理の優先順：稼働行 ← ドライバー ← 会社", () => {
    expect(resolveRoundingMode("ceil", "floor", "none")).toBe("ceil");
    expect(resolveRoundingMode(null, "floor", "none")).toBe("floor");
    expect(resolveRoundingMode(null, null, "round")).toBe("round");
  });
});

describe("入力の正規化", () => {
  it("全角・カンマ・円・空白を受け付ける", () => {
    expect(parseNumberInput("２３，０２５")).toBe(23025);
    expect(parseNumberInput("¥21,780")).toBe(21780);
    expect(parseNumberInput(" 1 234 ")).toBe(1234);
    expect(parseNumberInput("１２．５")).toBe(12.5);
    expect(parseNumberInput("-15000円")).toBe(-15000);
    expect(parseNumberInput("−３０，０００")).toBe(-30000);
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput(null)).toBeNull();
  });
  it("パーセント入力を率へ", () => {
    expect(parsePercentInput("10")).toBe(0.1);
    expect(parsePercentInput("12.5%")).toBe(0.125);
    expect(parsePercentInput("１２．５％")).toBe(0.125);
    expect(parsePercentInput("0")).toBe(0);
    expect(parsePercentInput("")).toBeNull();
  });
  it("sumMoney は誤差なく合計する", () => {
    expect(sumMoney([27462.6, 42462.6, 66556.6, 68481, 69628, 98317.5, 192700, 86882])).toBe(652490.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
});

describe("稼動月ユーティリティ", () => {
  it("月初日への変換と加減算", () => {
    expect(monthToDate("2026-09")).toBe("2026-09-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(() => monthToDate("2026-13")).toThrow();
  });
  it("振込予定日：翌月末", () => {
    expect(payoutDate("2026-09", 1, 0)).toBe("2026-10-31");
    expect(payoutDate("2026-01", 1, 0)).toBe("2026-02-28");
    expect(payoutDate("2027-01", 1, 0)).toBe("2027-02-28");
    expect(payoutDate("2028-01", 1, 0)).toBe("2028-02-29");
    expect(payoutDate("2026-09", 1, 15)).toBe("2026-10-15");
    expect(payoutDate("2026-09", 0, 31)).toBe("2026-09-30");
    expect(payoutDate("2026-09", 2, 10)).toBe("2026-11-10");
  });
  it("日本時間の当月", () => {
    // 2026-09-30T23:00Z は日本では 10 月 1 日
    expect(currentMonthJST(new Date("2026-09-30T23:00:00Z"))).toBe("2026-10");
    expect(currentMonthJST(new Date("2026-09-30T14:59:00Z"))).toBe("2026-09");
  });
});
