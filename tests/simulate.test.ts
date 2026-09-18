import { describe, expect, it } from "vitest";
import {
  applyRateChange,
  calcDriverMonth,
  changedRate,
  clampRoyaltyRate,
  hasRateChange,
  roundRate,
  simulateCompanyMonth,
  simulateDriverMonth,
  type EntryInput,
  type RateChange,
  type RoundingMode,
  type SimDriver,
  type SimDriverMonth,
} from "@/lib/calc";

/** 稼働行（指定しない項目は既定値） */
function entry(over: Partial<EntryInput> = {}): EntryInput {
  return { qty: 20, billRate: 23025, payRate: 21780, royaltyRate: 0.1, roundingMode: "none", ...over };
}

/** ドライバー × 月の条件 */
function driverMonth(over: Partial<SimDriverMonth> = {}): SimDriverMonth {
  return { mgmtFee: 15000, adjustments: [], tax: null, ...over };
}

const NO_CHANGE: RateChange = {};

describe("単価改定シミュレーション（simulateDriverMonth）", () => {
  it("変更なしなら「変更後」は現状と一致する（calcDriverMonth と同じ）", () => {
    const entries = [entry(), entry({ qty: 3, billRate: 1200, payRate: 1000 })];
    const dm = driverMonth();
    const sim = simulateDriverMonth(entries, dm, NO_CHANGE);
    const expected = calcDriverMonth({ entries, mgmtFee: dm.mgmtFee, adjustments: [], tax: null });

    expect(sim.after).toEqual(sim.before);
    expect(sim.before).toEqual(expected);
    expect(sim.diff.bill).toBe(0);
    expect(sim.diff.profit).toBe(0);
    expect(sim.diff.payout).toBe(0);
    expect(sim.diff.profitRate).toBe(0);
    expect(hasRateChange(NO_CHANGE)).toBe(false);
  });

  it("受注単価 +500 円：売上と会社利益だけが 500 × 数量 分増える（支払は変わらない）", () => {
    const entries = [entry()]; // 20 日 × 受注 23,025 / 支払 21,780
    const sim = simulateDriverMonth(entries, driverMonth(), { billRateDelta: 500 });

    expect(sim.before.bill).toBe(460500);
    expect(sim.after.bill).toBe(470500);
    expect(sim.diff.bill).toBe(10000);
    expect(sim.after.pay).toBe(sim.before.pay);
    expect(sim.diff.pay).toBe(0);
    expect(sim.diff.profit).toBe(10000);
    expect(sim.diff.payout).toBe(0);
    expect(sim.diff.payoutIncl).toBe(0);
    expect(sim.entries[0].billRate).toBe(23525);
  });

  it("支払単価 −3%：支払・ロイヤリティ・支払額が下がり、会社利益は増える", () => {
    const entries = [entry({ royaltyRate: 0.1, roundingMode: "floor" })];
    const sim = simulateDriverMonth(entries, driverMonth(), { payRateRatio: -0.03 });

    // 21,780 × 0.97 = 21,126.6（小数 2 桁）
    expect(sim.entries[0].payRate).toBe(21126.6);
    expect(sim.before.pay).toBe(435600);
    expect(sim.after.pay).toBe(422532);
    expect(sim.diff.pay).toBe(-13068);
    // ロイヤリティは支払 × 10%（切り捨て）
    expect(sim.before.royalty).toBe(43560);
    expect(sim.after.royalty).toBe(42253);
    // 会社利益 ＝ 単価差額利益 ＋ ロイヤリティ ＋ 管理費
    expect(sim.before.driverProfit).toBe(24900 + 43560 + 15000);
    expect(sim.after.driverProfit).toBe(37968 + 42253 + 15000);
    expect(sim.diff.profit).toBe(11761);
    // ドライバーの支払額は減る
    expect(sim.diff.payout).toBeLessThan(0);
    expect(sim.after.payout).toBe(422532 - 42253 - 15000);
  });

  it("受注 +5%・支払 −500 円を同時に指定できる（率 → 円 の順に適用）", () => {
    const entries = [entry({ qty: 10, billRate: 10000, payRate: 9000, royaltyRate: 0, roundingMode: "none" })];
    const sim = simulateDriverMonth(entries, driverMonth({ mgmtFee: 0 }), { billRateRatio: 0.05, payRateDelta: -500 });

    expect(sim.entries[0].billRate).toBe(10500);
    expect(sim.entries[0].payRate).toBe(8500);
    expect(sim.after.bill).toBe(105000);
    expect(sim.after.pay).toBe(85000);
    expect(sim.diff.profit).toBe(105000 - 85000 - (100000 - 90000));
  });

  it("ロイヤリティ率を変えると会社利益とドライバーの支払額が変わる", () => {
    const entries = [entry({ qty: 10, billRate: 10000, payRate: 9000, royaltyRate: 0.1 })];
    const sim = simulateDriverMonth(entries, driverMonth({ mgmtFee: 0 }), { royaltyRate: 0.15 });

    expect(sim.before.royalty).toBe(9000);
    expect(sim.after.royalty).toBe(13500);
    expect(sim.diff.royalty).toBe(4500);
    expect(sim.diff.profit).toBe(4500);
    expect(sim.diff.payout).toBe(-4500);
    // 単価は変えていない
    expect(sim.entries[0].billRate).toBe(10000);
    expect(sim.entries[0].payRate).toBe(9000);
  });

  it("管理費を変えると会社利益が増え、ドライバーの支払額が同額減る", () => {
    const entries = [entry({ qty: 10, billRate: 10000, payRate: 9000, royaltyRate: 0 })];
    const sim = simulateDriverMonth(entries, driverMonth({ mgmtFee: 15000 }), { mgmtFee: 20000 });

    expect(sim.before.mgmtFee).toBe(15000);
    expect(sim.after.mgmtFee).toBe(20000);
    expect(sim.diff.profit).toBe(5000);
    expect(sim.diff.payout).toBe(-5000);
  });

  it("端数処理 4 種：ロイヤリティの丸めが端数処理に従う（支払単価 −3% の後）", () => {
    // 支払 = 10,000 × 0.97 = 9,700 × 3 日 = 29,100、ロイヤリティ率 12.34% → 3,590.94
    const cases: [RoundingMode, number][] = [
      ["none", 3590.94],
      ["floor", 3590],
      ["round", 3591],
      ["ceil", 3591],
    ];
    for (const [mode, expected] of cases) {
      const entries = [entry({ qty: 3, billRate: 12000, payRate: 10000, royaltyRate: 0.1234, roundingMode: mode })];
      const sim = simulateDriverMonth(entries, driverMonth({ mgmtFee: 0 }), { payRateRatio: -0.03 });
      expect(sim.after.pay).toBe(29100);
      expect(sim.after.royalty, `端数処理 ${mode}`).toBe(expected);
    }
  });

  it("複数行：行ごとに単価を変えて合計する（数量・端数処理はそのまま）", () => {
    const entries = [
      entry({ qty: 20, billRate: 23025, payRate: 21780, royaltyRate: 0.1, roundingMode: "floor" }),
      entry({ qty: 5, billRate: 1500, payRate: 1200, royaltyRate: 0.1, roundingMode: "floor" }),
      entry({ qty: 2, billRate: 800, payRate: 700, royaltyRate: 0.1, roundingMode: "floor" }),
    ];
    const sim = simulateDriverMonth(entries, driverMonth(), { billRateDelta: 100 });

    expect(sim.before.entryCount).toBe(3);
    expect(sim.after.entryCount).toBe(3);
    // 売上の増加 ＝ 100 円 × 数量の合計（20 + 5 + 2 = 27）
    expect(sim.diff.bill).toBe(2700);
    expect(sim.diff.profit).toBe(2700);
    expect(sim.entries.map((e) => e.billRate)).toEqual([23125, 1600, 900]);
  });

  it("数量 0 の行は金額に影響しない（管理費も計上されない）", () => {
    const entries = [entry({ qty: 0 })];
    const sim = simulateDriverMonth(entries, driverMonth({ mgmtFee: 15000 }), { billRateDelta: 5000, payRateDelta: -1000 });

    expect(sim.before.bill).toBe(0);
    expect(sim.after.bill).toBe(0);
    expect(sim.after.mgmtFee).toBe(0); // 数量 > 0 の行が無いので管理費は計上しない
    expect(sim.diff.profit).toBe(0);
    expect(sim.diff.payout).toBe(0);
    expect(sim.after.profitRate).toBe(0);
  });

  it("消費税：支払単価を下げるとドライバーの手取り（税込支払額）も下がる", () => {
    const entries = [entry({ qty: 10, billRate: 12000, payRate: 10000, royaltyRate: 0.1, roundingMode: "floor" })];
    const dm = driverMonth({ mgmtFee: 10000, tax: { mode: "taxable", rate: 0.1, rounding: "floor" } });
    const sim = simulateDriverMonth(entries, dm, { payRateRatio: -0.05 });

    // 今：支払 100,000 − ロイヤリティ 10,000 − 管理費 10,000 = 80,000 → 消費税 8,000
    expect(sim.before.taxBase).toBe(80000);
    expect(sim.before.tax).toBe(8000);
    expect(sim.before.payoutIncl).toBe(88000);
    // 変更後：支払 95,000 − 9,500 − 10,000 = 75,500 → 消費税 7,550
    expect(sim.after.taxBase).toBe(75500);
    expect(sim.after.tax).toBe(7550);
    expect(sim.after.payoutIncl).toBe(83050);
    expect(sim.diff.tax).toBe(-450);
    expect(sim.diff.payoutIncl).toBe(-4950);
  });

  it("非課税・免税のドライバーは消費税 0 のまま（税込 ＝ 税抜）", () => {
    const entries = [entry({ qty: 10, billRate: 12000, payRate: 10000, royaltyRate: 0 })];
    const dm = driverMonth({ mgmtFee: 0, tax: { mode: "exempt", rate: 0.1, rounding: "floor" } });
    const sim = simulateDriverMonth(entries, dm, { payRateDelta: -1000 });

    expect(sim.before.tax).toBe(0);
    expect(sim.after.tax).toBe(0);
    expect(sim.after.payoutIncl).toBe(sim.after.payout);
    expect(sim.diff.payoutIncl).toBe(-10000);
  });

  it("調整は単価改定の影響を受けない（支払額・会社利益にそのまま残る）", () => {
    const entries = [entry({ qty: 10, billRate: 10000, payRate: 9000, royaltyRate: 0 })];
    const dm = driverMonth({
      mgmtFee: 0,
      adjustments: [
        { amount: -5000, countAsProfit: true },
        { amount: 3000, countAsProfit: false },
      ],
    });
    const sim = simulateDriverMonth(entries, dm, { payRateDelta: -100 });

    expect(sim.before.adjPay).toBe(-2000);
    expect(sim.after.adjPay).toBe(-2000);
    expect(sim.before.adjProfit).toBe(5000);
    expect(sim.after.adjProfit).toBe(5000);
    expect(sim.diff.payout).toBe(-1000); // 支払単価 −100 × 10 日
    expect(sim.diff.profit).toBe(1000);
  });

  it("単価はマイナスにならない（0 で止める）", () => {
    const entries = [entry({ qty: 10, billRate: 1000, payRate: 800, royaltyRate: 0 })];
    const sim = simulateDriverMonth(entries, driverMonth({ mgmtFee: 0 }), { payRateDelta: -5000, billRateRatio: -2 });

    expect(sim.entries[0].payRate).toBe(0);
    expect(sim.entries[0].billRate).toBe(0);
    expect(sim.after.bill).toBe(0);
    expect(sim.after.pay).toBe(0);
    expect(sim.after.profitRate).toBe(0);
  });
});

describe("単価・率の丸め", () => {
  it("単価は小数 2 桁へ四捨五入し、マイナスは 0 にする", () => {
    expect(roundRate(21126.6)).toBe(21126.6);
    expect(roundRate(349.9965)).toBe(350);
    expect(roundRate(349.994)).toBe(349.99);
    expect(roundRate(-1)).toBe(0);
    expect(roundRate(Number.NaN)).toBe(0);
  });

  it("ロイヤリティ率は 0〜1 に収める", () => {
    expect(clampRoyaltyRate(0.1)).toBe(0.1);
    expect(clampRoyaltyRate(-0.5)).toBe(0);
    expect(clampRoyaltyRate(1.5)).toBe(1);
  });

  it("changedRate は率 → 円 の順に適用する", () => {
    expect(changedRate(10000, 0.05, 500)).toBe(11000); // 10,000 × 1.05 ＝ 10,500 ＋ 500
    expect(changedRate(21780, -0.03, null)).toBe(21126.6);
    expect(changedRate(1000, null, -300)).toBe(700);
    expect(changedRate(1000, null, null)).toBe(1000);
  });

  it("hasRateChange は条件が 1 つでもあれば true", () => {
    expect(hasRateChange({})).toBe(false);
    expect(hasRateChange({ billRateDelta: 0 })).toBe(false);
    expect(hasRateChange({ billRateDelta: 500 })).toBe(true);
    expect(hasRateChange({ payRateRatio: -0.03 })).toBe(true);
    expect(hasRateChange({ royaltyRate: 0 })).toBe(true); // 0% への変更も「変更あり」
    expect(hasRateChange({ mgmtFee: 0 })).toBe(true);
  });

  it("applyRateChange は数量・端数処理を変えない", () => {
    const e = entry({ qty: 7, roundingMode: "ceil" });
    const changed = applyRateChange(e, { billRateDelta: 100, payRateDelta: 100, royaltyRate: 0.2 });
    expect(changed.qty).toBe(7);
    expect(changed.roundingMode).toBe("ceil");
    expect(changed.royaltyRate).toBe(0.2);
  });
});

describe("会社 × 月のシミュレーション（simulateCompanyMonth）", () => {
  const drivers: SimDriver[] = [
    {
      driverId: "d1",
      driverName: "田中 太郎",
      entries: [entry({ qty: 20, billRate: 23025, payRate: 21780, royaltyRate: 0.1, roundingMode: "floor" })],
      driverMonth: driverMonth({ mgmtFee: 15000, tax: { mode: "taxable", rate: 0.1, rounding: "floor" } }),
    },
    {
      driverId: "d2",
      driverName: "佐藤 次郎",
      entries: [entry({ qty: 10, billRate: 12000, payRate: 10000, royaltyRate: 0.1, roundingMode: "floor" })],
      driverMonth: driverMonth({ mgmtFee: 15000, tax: { mode: "taxable", rate: 0.1, rounding: "floor" } }),
    },
  ];

  it("対象ドライバーの合計になり、ドライバーごとの結果も返す", () => {
    const sim = simulateCompanyMonth(drivers, { billRateDelta: 500 });

    expect(sim.drivers).toHaveLength(2);
    expect(sim.drivers.map((d) => d.driverId)).toEqual(["d1", "d2"]);
    expect(sim.drivers.map((d) => d.driverName)).toEqual(["田中 太郎", "佐藤 次郎"]);
    expect(sim.before.driverCount).toBe(2);
    expect(sim.before.bill).toBe(460500 + 120000);
    expect(sim.after.bill).toBe(470500 + 125000);
    expect(sim.diff.bill).toBe(15000);
    expect(sim.diff.profit).toBe(15000);
    // 各ドライバーの合計が会社の差額と一致する
    expect(sim.drivers[0].diff.bill + sim.drivers[1].diff.bill).toBe(sim.diff.bill);
  });

  it("変更なしなら会社の数字も現状と一致し、利益率の差は 0", () => {
    const sim = simulateCompanyMonth(drivers, NO_CHANGE);
    expect(sim.after).toEqual(sim.before);
    expect(sim.diff.profitRate).toBe(0);
    expect(sim.diff.payoutIncl).toBe(0);
  });

  it("対象が 0 人でも壊れない（すべて 0）", () => {
    const sim = simulateCompanyMonth([], { billRateDelta: 500 });
    expect(sim.before.bill).toBe(0);
    expect(sim.after.profit).toBe(0);
    expect(sim.diff.profitRate).toBe(0);
    expect(sim.drivers).toEqual([]);
  });

  it("支払単価 −3% で会社利益が増え、ドライバーの手取り（税込）が減る", () => {
    const sim = simulateCompanyMonth(drivers, { payRateRatio: -0.03 });
    expect(sim.diff.profit).toBeGreaterThan(0);
    expect(sim.diff.payout).toBeLessThan(0);
    expect(sim.diff.payoutIncl).toBeLessThan(0);
    expect(sim.after.profitRate).toBeGreaterThan(sim.before.profitRate);
    expect(sim.diff.profitRate).toBeCloseTo(sim.after.profitRate - sim.before.profitRate, 10);
  });
});
