import { describe, expect, it } from "vitest";
import {
  WITHHOLDING_CATEGORIES,
  WITHHOLDING_CATEGORY_ORDER,
  WITHHOLDING_RATES,
  applyBp,
  calcPaymentWithholding,
  calcWithholding,
  paymentReportRequired,
  withholdingBaseRule,
  withholdingPaymentDue,
  withholdingRateFor,
} from "@/lib/engine/withholding";

describe("1号・2号（士業）の源泉税", () => {
  it.each([
    [84_000, 8_576],
    [1, 0],
    [9, 0],
    [10, 1],
    [50_000, 5_105],
    [999_999, 102_099],
    [1_000_000, 102_100],
    [1_000_001, 102_100],
    [1_000_005, 102_101],
    [1_500_000, 204_200],
    [2_000_000, 306_300],
  ])("元 %i 円 → %i 円", (base, tax) => {
    expect(calcWithholding("ko1", base).tax).toBe(tax);
    expect(calcWithholding("ko2_shigyo", base).tax).toBe(tax);
  });

  it("1円未満は切り捨て（四捨五入しない）。84,000 × 10.21% = 8,576.4 → 8,576", () => {
    const r = calcWithholding("ko1", 84_000);
    expect(r.tax).toBe(8_576);
    expect(r.formulaText).toContain("1円未満切り捨て");
    // 8,576.6 になる元でも切り上げない
    expect(calcWithholding("ko1", 84_002).tax).toBe(8_576);
  });

  it("浮動小数（× 0.1021）だとずれる境目でも、整数の万分率で正しく出す", () => {
    for (let a = 0; a <= 1_000_000; a += 997) {
      expect(calcWithholding("ko1", a).tax).toBe(Math.floor((a * 1021) / 10000));
    }
    expect(applyBp(84_000, 1021)).toBe(8_576);
  });

  it("100万円を超える部分だけ20.42%。段階を2つに分けて示す", () => {
    const r = calcWithholding("ko1", 1_500_000);
    expect(r.steps).toEqual([
      expect.objectContaining({ amount: 1_000_000, bp: 1021, tax: 102_100 }),
      expect.objectContaining({ amount: 500_000, bp: 2042, tax: 102_100 }),
    ]);
    expect(r.formulaText).toContain("20.42%");
  });

  it("100万円ちょうどは10.21%だけ", () => {
    const r = calcWithholding("ko1", 1_000_000);
    expect(r.steps).toHaveLength(1);
    expect(r.formulaText).not.toContain("20.42%");
  });
});

describe("司法書士・土地家屋調査士・海事代理士", () => {
  it.each([
    [5_000, 0],
    [10_000, 0],
    [10_001, 0],
    [10_010, 1],
    [50_000, 4_084],
    [2_010_000, 204_200],
  ])("1回の支払 %i 円 → %i 円（20.42%の段階は無い）", (base, tax) => {
    expect(calcWithholding("ko2_shihoshoshi", base).tax).toBe(tax);
  });

  it("1万円以下は0円で、理由を返す", () => {
    const r = calcWithholding("ko2_shihoshoshi", 10_000);
    expect(r.tax).toBe(0);
    expect(r.zeroReason).toContain("10,000円以下");
  });
});

describe("4号のモデル料など（外交員を除く）", () => {
  it("1号と同じ出し方：10.21%、1回の支払で100万円を超える部分は20.42%。12万円は引かない", () => {
    expect(calcWithholding("ko4_standard", 50_000).tax).toBe(5_105);
    expect(calcWithholding("ko4_standard", 100_000).tax).toBe(10_210);
    expect(calcWithholding("ko4_standard", 1_000_000).tax).toBe(102_100);
    expect(calcWithholding("ko4_standard", 1_500_000).tax).toBe(204_200);
    for (const base of [1, 99_999, 120_000, 1_000_000, 1_000_001, 2_345_678]) {
      expect(calcWithholding("ko4_standard", base).tax).toBe(calcWithholding("ko1", base).tax);
    }
    expect(calcWithholding("ko4_standard", 100_000, { monthlySalaryForGaikoin: 50_000 }).tax).toBe(10_210);
    expect(calcWithholding("ko4_standard", 100_000).deduction).toBe(0);
  });

  it("外交員とは別の区分（外交員は12万円を引き、段階が無い）", () => {
    expect(calcWithholding("ko4_gaikoin", 100_000).tax).toBe(0);
    expect(calcWithholding("ko4_standard", 100_000).tax).toBe(10_210);
    expect(WITHHOLDING_CATEGORIES.ko4_standard.label).toBe("4号（モデル料など）");
    expect(WITHHOLDING_CATEGORY_ORDER.indexOf("ko4_standard")).toBeLessThan(WITHHOLDING_CATEGORY_ORDER.indexOf("ko4_gaikoin"));
  });

  it("支払調書は年5万円超（外交員の50万円ではない）。法人なら0", () => {
    expect(paymentReportRequired("ko4_standard", 50_000)).toBe(false);
    expect(paymentReportRequired("ko4_standard", 50_001)).toBe(true);
    expect(calcWithholding("ko4_standard", 100_000, { payeeIsCorporation: true }).tax).toBe(0);
  });

  it("1回の支払でモデル料の行をまとめてから段階を当てる（1号の行とは別に）", () => {
    const pw = calcPaymentWithholding(
      [
        { category: "ko4_standard", amount: 600_000 },
        { category: "ko4_standard", amount: 600_000 },
        { category: "ko1", amount: 100_000 },
      ],
      { taxShownSeparately: true },
    );
    expect(pw.groups.map((g) => [g.category, g.base, g.tax])).toEqual([
      ["ko1", 100_000, 10_210],
      ["ko4_standard", 1_200_000, 102_100 + 40_840],
    ]);
  });
});

describe("外交員（4号）", () => {
  it("給与が無ければ 12万円を引いてから10.21%", () => {
    expect(calcWithholding("ko4_gaikoin", 300_000).tax).toBe(18_378);
    expect(calcWithholding("ko4_gaikoin", 120_000).tax).toBe(0);
    expect(calcWithholding("ko4_gaikoin", 100_000).tax).toBe(0);
  });

  it("同じ月の給与があれば、控除額は 12万円 − 給与（0 未満にしない）", () => {
    expect(calcWithholding("ko4_gaikoin", 300_000, { monthlySalaryForGaikoin: 50_000 }).tax).toBe(23_483);
    expect(calcWithholding("ko4_gaikoin", 300_000, { monthlySalaryForGaikoin: 200_000 }).tax).toBe(30_630);
  });

  it("100万円を超えても20.42%にしない", () => {
    expect(calcWithholding("ko4_gaikoin", 2_120_000).tax).toBe(204_200);
  });

  it("計算期間が2か月なら 24万円を引く", () => {
    expect(calcWithholding("ko4_gaikoin", 300_000, { gaikoinMonths: 2 }).tax).toBe(6_126);
  });
});

describe("法人・区分なし", () => {
  it("支払先が法人なら区分にかかわらず0", () => {
    for (const c of ["ko1", "ko2_shigyo", "ko2_shihoshoshi", "ko4_gaikoin"] as const) {
      const r = calcWithholding(c, 1_500_000, { payeeIsCorporation: true });
      expect(r.tax).toBe(0);
      expect(r.zeroReason).toContain("法人");
    }
  });

  it("none は0", () => {
    expect(calcWithholding("none", 1_000_000).tax).toBe(0);
  });

  it("マイナス・0・NaN の元は0", () => {
    expect(calcWithholding("ko1", -5_000).tax).toBe(0);
    expect(calcWithholding("ko1", 0).tax).toBe(0);
    expect(calcWithholding("ko1", Number.NaN).tax).toBe(0);
  });
});

describe("税率の表", () => {
  it("2027年以降も10.21%（見込みとしてデータで持つ）", () => {
    expect(withholdingRateFor("2026-12-31").basicBp).toBe(1021);
    const next = withholdingRateFor("2027-01-01");
    expect(next.basicBp).toBe(1021);
    expect(next.upperBp).toBe(2042);
    expect(next.status).toBe("expected");
    expect(WITHHOLDING_RATES.every((r) => r.stepThreshold === 1_000_000)).toBe(true);
    expect(calcWithholding("ko1", 84_000, { date: "2027-02-10" }).tax).toBe(8_576);
  });

  it("2027年の行：内訳の改正は成立済み、合計10.21%は見込み（「確定」とは書かない）", () => {
    const next = withholdingRateFor("2027-01-01");
    expect(next.note).toContain("防衛特別所得税（1%）");
    expect(next.note).toContain("1.1%");
    expect(next.note).toContain("成立済み");
    expect(next.note).toContain("10.21%のまま変わらない見込み");
    expect(next.note).not.toContain("確定");
  });

  it("日付が無ければ施行済みの率", () => {
    expect(withholdingRateFor().status).toBe("enacted");
  });
});

describe("源泉の元（税抜か税込か）と1回の支払のまとめ", () => {
  it("消費税がはっきり分けて書いてあるときだけ税抜。分からなければ税込", () => {
    expect(withholdingBaseRule(true)).toBe("excl_tax_separated");
    expect(withholdingBaseRule(false)).toBe("incl_tax");
    expect(withholdingBaseRule(undefined)).toBe("incl_tax");
  });

  it("税抜 84,000 と税込 92,400 で源泉が変わる", () => {
    const item = { category: "ko1" as const, amount: 84_000, tax: 8_400 };
    expect(calcPaymentWithholding([item], { taxShownSeparately: true }).tax).toBe(8_576);
    expect(calcPaymentWithholding([item], { taxShownSeparately: false }).tax).toBe(9_434);
  });

  it("同じ区分の行を合計してから100万円の段階を当てる（行ごとに当てない）", () => {
    const items = [
      { category: "ko1" as const, amount: 800_000 },
      { category: "ko1" as const, amount: 700_000 },
    ];
    const r = calcPaymentWithholding(items, { taxShownSeparately: true });
    expect(r.base).toBe(1_500_000);
    expect(r.tax).toBe(204_200);
    // 行ごとに当てると 81,680 + 71,470 = 153,150 になってしまう
    expect(r.tax).not.toBe(81_680 + 71_470);
  });

  it("区分が違う行は別々に。none は源泉の元に入れない", () => {
    const r = calcPaymentWithholding(
      [
        { category: "none", amount: 500_000 },
        { category: "ko1", amount: 200_000 },
        { category: "ko2_shihoshoshi", amount: 30_000 },
      ],
      { taxShownSeparately: true },
    );
    expect(r.groups.map((g) => [g.category, g.base, g.tax])).toEqual([
      ["ko1", 200_000, 20_420],
      ["ko2_shihoshoshi", 30_000, 2_042],
    ]);
    expect(r.tax).toBe(22_462);
  });
});

describe("支払調書・納付期限", () => {
  it("1号・2号は年5万円超、外交員は50万円超", () => {
    expect(paymentReportRequired("ko1", 50_000)).toBe(false);
    expect(paymentReportRequired("ko1", 50_001)).toBe(true);
    expect(paymentReportRequired("ko2_shihoshoshi", 60_000)).toBe(true);
    expect(paymentReportRequired("ko4_gaikoin", 500_000)).toBe(false);
    expect(paymentReportRequired("ko4_gaikoin", 500_001)).toBe(true);
    expect(paymentReportRequired("none", 10_000_000)).toBe(false);
  });

  it("源泉税は支払った月の翌月10日まで（12月は翌年1月）", () => {
    expect(withholdingPaymentDue("2026-11-30")).toBe("2026-12-10");
    expect(withholdingPaymentDue("2026-12-25")).toBe("2027-01-10");
  });
});

describe("境目の追加（レビューで足した）", () => {
  it("司法書士など：10,009円は0円、20,000円は1,021円、100万円を超えても20.42%にしない", () => {
    expect(calcWithholding("ko2_shihoshoshi", 10_009).tax).toBe(0);
    expect(calcWithholding("ko2_shihoshoshi", 20_000).tax).toBe(1_021);
    // (1,510,000 − 10,000) × 10.21% = 153,150（20.42%の段階があれば 204,200 になる）
    expect(calcWithholding("ko2_shihoshoshi", 1_510_000).tax).toBe(153_150);
    expect(calcWithholding("ko2_shihoshoshi", 1_510_000).steps).toHaveLength(1);
  });

  it("外交員：給与がちょうど12万円なら控除0。報酬ちょうど12万円（給与なし）は0円", () => {
    expect(calcWithholding("ko4_gaikoin", 120_000, { monthlySalaryForGaikoin: 120_000 }).tax).toBe(12_252);
    expect(calcWithholding("ko4_gaikoin", 120_001).tax).toBe(0); // 1 × 10.21% = 0.1021 → 0
    expect(calcWithholding("ko4_gaikoin", 120_010).tax).toBe(1);
    const r = calcWithholding("ko4_gaikoin", 1_120_001);
    expect(r.tax).toBe(102_100);
    expect(r.formulaText).not.toContain("20.42%");
  });

  it("式の文は「1回の支払」で、年の合計とは書かない。四捨五入とも書かない", () => {
    for (const base of [84_000, 1_500_000]) {
      const t = calcWithholding("ko1", base).formulaText;
      expect(t).not.toContain("年");
      expect(t).not.toContain("四捨五入");
    }
    expect(calcWithholding("ko1", 1_500_000).formulaText).toContain("1回の支払");
  });

  it("税率は表から引く（表を書き換えると計算も変わる＝コードに率を直書きしていない）", () => {
    const row = WITHHOLDING_RATES[1];
    const saved = { ...row };
    try {
      row.basicBp = 1_000;
      row.upperBp = 2_000;
      row.stepThreshold = 2_000_000;
      row.shihoshoshiDeduction = 20_000;
      row.gaikoinMonthlyDeduction = 100_000;
      const d = { date: "2027-03-10" };
      expect(calcWithholding("ko1", 84_000, d).tax).toBe(8_400);
      expect(calcWithholding("ko1", 1_500_000, d).tax).toBe(150_000);
      expect(calcWithholding("ko1", 2_500_000, d).tax).toBe(200_000 + 100_000);
      expect(calcWithholding("ko2_shihoshoshi", 30_000, d).tax).toBe(1_000);
      expect(calcWithholding("ko4_gaikoin", 300_000, d).tax).toBe(20_000);
      // 2026年の支払は元の表のまま
      expect(calcWithholding("ko1", 84_000, { date: "2026-12-31" }).tax).toBe(8_576);
    } finally {
      Object.assign(row, saved);
    }
  });

  it("税率の表は日付がすき間なく続き、重ならない", () => {
    for (let i = 1; i < WITHHOLDING_RATES.length; i++) {
      const prev = WITHHOLDING_RATES[i - 1];
      expect(prev.to).not.toBeNull();
      const next = new Date(`${prev.to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      expect(next.toISOString().slice(0, 10)).toBe(WITHHOLDING_RATES[i].from);
    }
    expect(WITHHOLDING_RATES[WITHHOLDING_RATES.length - 1].to).toBeNull();
  });

  it("税込を元にすると100万円を超えることがある（950,000 ＋ 消費税 95,000）", () => {
    const item = { category: "ko1" as const, amount: 950_000, tax: 95_000 };
    expect(calcPaymentWithholding([item], { taxShownSeparately: true }).tax).toBe(96_995);
    // (1,045,000 − 1,000,000) × 20.42% + 102,100 = 9,189 + 102,100
    expect(calcPaymentWithholding([item], { taxShownSeparately: false }).tax).toBe(111_289);
  });

  it("1回の支払：100万円ちょうどの行 ＋ 10円の行 → 102,102（行ごとに当てると 102,100 + 1 = 102,101）", () => {
    const r = calcPaymentWithholding(
      [
        { category: "ko1", amount: 1_000_000 },
        { category: "ko1", amount: 10 },
      ],
      { taxShownSeparately: true },
    );
    expect(r.base).toBe(1_000_010);
    expect(r.tax).toBe(102_102); // 10 × 20.42% = 2.042 → 2
  });

  it("法人なら1回の支払のまとめでも0", () => {
    const r = calcPaymentWithholding([{ category: "ko1", amount: 1_500_000 }], { payeeIsCorporation: true, taxShownSeparately: true });
    expect(r.tax).toBe(0);
    expect(r.groups[0].zeroReason).toContain("法人");
  });
});
