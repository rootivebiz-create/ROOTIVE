import { describe, expect, it } from "vitest";
import {
  calcChairRental,
  calcCommission,
  calcContractFee,
  calcFixed,
  calcGuarantee,
  calcSettlement,
  calcThreshold,
  calcTiered,
  calcUnit,
  countedMinutes,
  floorToStep,
  salesForRate,
} from "@/lib/engine/payModels";
import { buildPayout, type PayoutInput } from "@/lib/engine/statement";

describe("数量 × 単価", () => {
  it("42,000字 × 2.0円 = 84,000円", () => {
    const r = calcUnit({ qty: 42_000, rate: 2, unitLabel: "字" });
    expect(r.amount).toBe(84_000);
    expect(r.formulaText).toContain("字");
    expect(r.warnings).toEqual([]);
  });

  it("小数の単価は端数の設定どおり（既定は切り捨て）", () => {
    expect(calcUnit({ qty: 333, rate: 1.5 }).amount).toBe(499);
    expect(calcUnit({ qty: 333, rate: 1.5, rounding: "round" }).amount).toBe(500);
    expect(calcUnit({ qty: 3, rate: 0.1 }).amount).toBe(0);
    // 浮動小数の誤差で 1 円落ちない（0.1 × 3 = 0.30000000000000004、1.1 × 3 = 3.3000000000000003）
    expect(calcUnit({ qty: 3, rate: 1.1, rounding: "ceil" }).amount).toBe(4);
    expect(calcUnit({ qty: 10, rate: 0.7 }).amount).toBe(7);
  });

  it("マイナスは注意", () => {
    expect(calcUnit({ qty: -1, rate: 100 }).warnings[0].code).toBe("invalid_input");
  });
});

describe("売上 × 率", () => {
  it("美容 佐藤の例：フリー45%・指名60%・店販15% = 606,000", () => {
    const r = calcCommission({
      categories: [
        { label: "フリー", sales: 420_000, rate: 0.45 },
        { label: "指名", sales: 680_000, rate: 0.6 },
        { label: "店販", sales: 60_000, rate: 0.15 },
      ],
    });
    expect(r.amount).toBe(606_000);
    expect(r.formulaText).toContain("税抜");
  });

  it("税込で入れた売上を税抜にしてから率を掛ける", () => {
    const input = { categories: [{ label: "技術", sales: 110_000, rate: 0.5 }], salesInputIncludesTax: true, rateAppliesTo: "excl" as const };
    expect(salesForRate(110_000, input)).toBe(100_000);
    expect(calcCommission(input).amount).toBe(50_000);
    expect(calcCommission(input).formulaText).toContain("直してから");
  });

  it("税込の売上にそのまま掛ける", () => {
    const r = calcCommission({ categories: [{ label: "技術", sales: 110_000, rate: 0.5 }], salesInputIncludesTax: true });
    expect(r.amount).toBe(55_000);
    expect(r.formulaText).toContain("税込");
  });
});

describe("段階歩合", () => {
  const tiers = [
    { upTo: 500_000, rate: 0.4 },
    { upTo: 800_000, rate: 0.5 },
    { upTo: null, rate: 0.6 },
  ];

  it("超過累進：950,000 → 200,000 + 150,000 + 90,000 = 440,000", () => {
    expect(calcTiered({ sales: 950_000, tiers, mode: "progressive" }).amount).toBe(440_000);
  });

  it("全額スライド：950,000 × 60% = 570,000", () => {
    expect(calcTiered({ sales: 950_000, tiers, mode: "slide" }).amount).toBe(570_000);
  });

  it("境目の額はその段階に入る（上限を含む）", () => {
    expect(calcTiered({ sales: 500_000, tiers, mode: "slide" }).amount).toBe(200_000);
    expect(calcTiered({ sales: 500_001, tiers, mode: "slide" }).amount).toBe(250_000);
    expect(calcTiered({ sales: 500_000, tiers, mode: "progressive" }).amount).toBe(200_000);
    expect(calcTiered({ sales: 800_000, tiers, mode: "progressive" }).amount).toBe(350_000);
    expect(calcTiered({ sales: 0, tiers, mode: "progressive" }).amount).toBe(0);
  });

  it("段階の並びがおかしければ注意", () => {
    const r = calcTiered({ sales: 100, tiers: [{ upTo: 500, rate: 0.1 }], mode: "slide" });
    expect(r.amount).toBe(0);
    expect(r.warnings[0].code).toBe("invalid_input");
  });
});

describe("最低保証", () => {
  it("max(380,000 × 50%, 8,000 × 16日) = 190,000。労働者性の注意を出す", () => {
    const r = calcGuarantee({ commission: { categories: [{ label: "技術", sales: 380_000, rate: 0.5 }] }, dailyGuarantee: 8_000, days: 16 });
    expect(r.amount).toBe(190_000);
    expect(r.warnings.map((w) => w.code)).toEqual(["labor_risk_guarantee"]);
    expect(r.warnings[0].message).toContain("判断は専門家へ");
  });

  it("歩合が少ない月は保証の額", () => {
    const r = calcGuarantee({ commission: { categories: [{ label: "技術", sales: 200_000, rate: 0.5 }] }, dailyGuarantee: 8_000, days: 16 });
    expect(r.amount).toBe(128_000);
    expect(r.detail).toContain("保証を採用");
  });
});

describe("精算幅", () => {
  it("上下割 700,000・140〜180h・15分単位・10円未満切り捨て、実働186.5h → 3,880 × 6.5h = 25,220", () => {
    const r = calcSettlement({ mode: "updown", monthly: 700_000, lower: 140, upper: 180, actualHours: 186.5, timeUnitMinutes: 15, unitPriceStep: 10 });
    expect(r.settlement.excessUnitPrice).toBe(3_880);
    expect(r.settlement.shortUnitPrice).toBe(5_000);
    expect(r.settlement.adjustment).toBe(25_220);
    expect(r.amount).toBe(725_220);
    expect(r.formulaText).toContain("上下割");
    expect(r.formulaText).toContain("10円未満切り捨て");
  });

  it("上下割 600,000・下限140h、実働132h → 4,280 × 8h = 34,240 を控除", () => {
    const r = calcSettlement({ mode: "updown", monthly: 600_000, lower: 140, upper: 180, actualHours: 132, timeUnitMinutes: 15, unitPriceStep: 10 });
    expect(r.settlement.shortUnitPrice).toBe(4_280);
    expect(r.settlement.adjustment).toBe(-34_240);
    expect(r.amount).toBe(565_760);
  });

  it("精算幅の中なら精算なし（下限・上限ちょうども）", () => {
    for (const h of [140, 160, 180]) {
      const r = calcSettlement({ mode: "updown", monthly: 700_000, lower: 140, upper: 180, actualHours: h, unitPriceStep: 10 });
      expect(r.amount).toBe(700_000);
    }
  });

  it("中間割：単価は 月額 ÷ ((上限 + 下限) ÷ 2)", () => {
    const r = calcSettlement({ mode: "middle", monthly: 700_000, lower: 140, upper: 180, actualHours: 186.5, timeUnitMinutes: 15, unitPriceStep: 10 });
    expect(r.settlement.excessUnitPrice).toBe(4_370); // 700,000 ÷ 160 = 4,375 → 4,370
    expect(r.settlement.shortUnitPrice).toBe(4_370);
    expect(r.settlement.adjustment).toBe(28_405);
    const short = calcSettlement({ mode: "middle", monthly: 700_000, lower: 140, upper: 180, actualHours: 130, unitPriceStep: 100 });
    expect(short.settlement.shortUnitPrice).toBe(4_300);
    expect(short.amount).toBe(657_000);
  });

  it("時間の丸め：15分・30分・60分未満を切り捨て", () => {
    expect(countedMinutes(186.6, 15)).toBe(11_190); // 11,196分 → 11,190分（186.5h）
    expect(countedMinutes(186.6, 30)).toBe(11_190);
    expect(countedMinutes(186.9, 60)).toBe(11_160);
    expect(countedMinutes(186.6, 1)).toBe(11_196);
    const r = calcSettlement({ mode: "updown", monthly: 700_000, lower: 140, upper: 180, actualHours: 186.9, timeUnitMinutes: 30, unitPriceStep: 10 });
    expect(r.settlement.countedHours).toBe(186.5);
    expect(r.settlement.adjustment).toBe(25_220);
  });

  it("単価の端数：1円・10円・100円未満の切り捨て", () => {
    expect(floorToStep(3_888.888, 1)).toBe(3_888);
    expect(floorToStep(3_888.888, 10)).toBe(3_880);
    expect(floorToStep(3_888.888, 100)).toBe(3_800);
  });

  it("時間単価：4,000円 × 150.25h（15分単位）", () => {
    const r = calcSettlement({ mode: "hourly", hourlyRate: 4_000, actualHours: 150.3, timeUnitMinutes: 15 });
    expect(r.amount).toBe(601_000);
  });

  it("固定：時間に関係なく月額", () => {
    expect(calcSettlement({ mode: "fixed", monthly: 900_000, actualHours: 100 }).amount).toBe(900_000);
  });

  it("日割り：650,000 × 12/21営業日 = 371,428。精算幅も同じ比率で縮める（80〜102.86h）", () => {
    const input = {
      mode: "updown" as const,
      monthly: 650_000,
      lower: 140,
      upper: 180,
      timeUnitMinutes: 15 as const,
      unitPriceStep: 10 as const,
      proration: { workedDays: 12, businessDays: 21 },
    };
    const inRange = calcSettlement({ ...input, actualHours: 96 });
    expect(inRange.settlement.base).toBe(371_428);
    expect(inRange.settlement.lower).toBe(80);
    expect(inRange.settlement.upper).toBeCloseTo(102.857, 3);
    expect(inRange.amount).toBe(371_428);
    // 下限80hに5h足りない → 控除単価 650,000 ÷ 140 = 4,642.8 → 4,640 × 5h
    const short = calcSettlement({ ...input, actualHours: 75 });
    expect(short.settlement.adjustment).toBe(-23_200);
    expect(short.amount).toBe(348_228);
    // 縮めない場合（140h）なら大きく控除されてしまう
    expect(short.formulaText).toContain("日割り");
  });

  it("精算幅の入力がおかしければ注意", () => {
    const r = calcSettlement({ mode: "updown", monthly: 700_000, lower: 180, upper: 140, actualHours: 160 });
    expect(r.warnings[0].code).toBe("invalid_input");
  });
});

describe("しきい値つきの加算・定額・差し引き・面貸し", () => {
  it("回ごとに基準の10人を超えた人数 × 300円（合計20人分 = 6,000円）", () => {
    const r = calcThreshold({ counts: [12, 12, 11, 10, 13, 12, 11, 12, 14, 10, 12, 11], base: 10, unitPrice: 300 });
    expect(r.amount).toBe(6_000);
    expect(calcThreshold({ counts: 8, base: 10, unitPrice: 300 }).amount).toBe(0);
    expect(calcThreshold({ counts: 30, base: 10, unitPrice: 300 }).amount).toBe(6_000);
  });

  it("固定給のような定額には労働者性の注意", () => {
    expect(calcFixed({ amount: 150_000 }).warnings).toEqual([]);
    expect(calcFixed({ amount: 150_000, fixedSalaryLike: true }).warnings[0].code).toBe("labor_risk_fixed_pay");
  });

  it("契約で決めた差し引きはマイナスの行。合意が無ければ減額のおそれ", () => {
    const r = calcContractFee({ mode: "rate", base: 360_000, rate: 0.1, agreedInWriting: true });
    expect(r.amount).toBe(-36_000);
    expect(r.warnings).toEqual([]);
    const bad = calcContractFee({ mode: "fixed", amount: 5_000, agreedInWriting: false });
    expect(bad.amount).toBe(-5_000);
    expect(bad.warnings[0].code).toBe("reduction_risk");
    expect(bad.warnings[0].message).toContain("フリーランス法5条");
  });

  it("面貸し：750,000 − 場所代40% 300,000 − カード手数料 12,960 = 437,040（報酬ではなく精算）", () => {
    const r = calcChairRental({ salesCollected: 750_000, rent: { mode: "rate", rate: 0.4 }, cardFee: { mode: "fixed", amount: 12_960 } });
    expect(r.amount).toBe(437_040);
    expect(r.notes[0]).toContain("精算");
    expect(r.notes[0]).toContain("判断しません");
    const byRate = calcChairRental({ salesCollected: 750_000, rent: { mode: "rate", rate: 0.4 }, cardFee: { mode: "rate", rate: 0.01728 } });
    expect(byRate.amount).toBe(437_040);
  });
});

describe("明細（buildPayout）の順序と注意", () => {
  const base: PayoutInput = {
    payee: { name: "テスト（架空）", invoiceRegistered: true, isCorporation: false, paysTaxOnTop: true },
    lines: [{ label: "原稿料", model: "unit", input: { qty: 42_000, rate: 2, unitLabel: "字" }, withholding: "ko1" }],
    serviceDate: "2026-10-31",
    orderSideTaxMethod: "general",
  };

  it("ライターA：84,000 → 消費税 8,400 → 源泉 8,576 → 振込 83,824", () => {
    const r = buildPayout(base);
    expect([r.subtotal, r.tax, r.withholdingBase, r.withholding, r.payout]).toEqual([84_000, 8_400, 84_000, 8_576, 83_824]);
    expect(r.withholdingRule).toBe("excl_tax_separated");
    expect(r.warnings).toEqual([]);
    expect(r.explanation[0]).toContain("84,000円");
    expect(r.explanation.some((s) => s.includes("8,576円"))).toBe(true);
    expect(r.explanation.some((s) => s.includes("83,824円"))).toBe(true);
  });

  it("消費税が分けて書かれていなければ税込を元にする（92,400 → 9,434）", () => {
    const r = buildPayout({ ...base, taxShownSeparately: false });
    expect(r.withholdingRule).toBe("incl_tax");
    expect(r.withholdingBase).toBe(92_400);
    expect(r.withholding).toBe(9_434);
    expect(r.payout).toBe(84_000 + 8_400 - 9_434);
  });

  it("控除は源泉の元を減らさない", () => {
    const r = buildPayout({ ...base, deductions: [{ label: "教室の使用料", amount: 5_000, agreedInWriting: true }] });
    expect(r.withholdingBase).toBe(84_000);
    expect(r.withholding).toBe(8_576);
    expect(r.payout).toBe(83_824 - 5_000);
    expect(r.warnings).toEqual([]);
  });

  it("合意の無い控除・罰金・振込手数料には注意", () => {
    const r = buildPayout({
      ...base,
      deductions: [
        { label: "備品代", amount: 1_000, agreedInWriting: false },
        { label: "罰金", amount: 1_000, agreedInWriting: true, kind: "penalty" },
        { label: "振込手数料", amount: 440, agreedInWriting: true, kind: "transfer_fee" },
      ],
    });
    expect(r.warnings.map((w) => [w.code, w.source])).toEqual([
      ["reduction_risk", "備品代"],
      ["reduction_risk", "罰金"],
      ["labor_risk_penalty", "罰金"],
      ["transfer_fee_deducted", "振込手数料"],
    ]);
  });

  it("行ごとに源泉の区分を持つ（開発は none、デザインは 1号）。同じ区分を合計してから段階を当てる", () => {
    const r = buildPayout({
      ...base,
      lines: [
        { label: "コーディング", model: "fixed", input: { amount: 400_000 } },
        { label: "デザイン", model: "fixed", input: { amount: 700_000 }, withholding: "ko1" },
        { label: "デザイン（追加）", model: "fixed", input: { amount: 500_000 }, withholding: "ko1" },
      ],
    });
    expect(r.subtotal).toBe(1_600_000);
    expect(r.withholdingGroups.map((g) => [g.category, g.base])).toEqual([["ko1", 1_200_000]]);
    expect(r.withholding).toBe(102_100 + 40_840);
  });

  it("法人なら源泉0", () => {
    const r = buildPayout({ ...base, payee: { ...base.payee, isCorporation: true } });
    expect(r.withholding).toBe(0);
    expect(r.payout).toBe(92_400);
    expect(r.explanation.some((s) => s.includes("法人"))).toBe(true);
  });

  it("報酬と一緒に払う立替は源泉の元に入る。直接払ったものは入らない（振込額にも入らない）", () => {
    const r = buildPayout({
      ...base,
      lines: [{ label: "撮影料", model: "unit", input: { qty: 2, rate: 50_000 }, withholding: "ko1" }],
      reimbursements: [
        { label: "交通費", amount: 4_800, paidWithFee: true },
        { label: "ホテル（直接払い）", amount: 12_000, paidWithFee: false },
      ],
    });
    expect(r.withholdingBase).toBe(104_800);
    expect(r.withholding).toBe(10_700);
    expect(r.reimbursementsPaid).toBe(4_800);
    expect(r.reimbursementsDirect).toBe(12_000);
    expect(r.tax).toBe(10_000); // 立替には消費税をかけない
    expect(r.payout).toBe(100_000 + 10_000 + 4_800 - 10_700);
  });

  it("免税の方への支払：原則課税なら控除できない負担、簡易課税なら0", () => {
    const exempt = { ...base.payee, invoiceRegistered: false, paysTaxOnTop: true };
    const general = buildPayout({ ...base, payee: exempt });
    expect(general.invoiceBurden).toBe(2_520); // 92,400 × 10/110 × 30%
    expect(general.deductibleRate).toBe(0.7);
    expect(buildPayout({ ...base, payee: exempt, serviceDate: "2026-09-30" }).invoiceBurden).toBe(1_680);
    expect(buildPayout({ ...base, payee: exempt, orderSideTaxMethod: "simplified" }).invoiceBurden).toBe(0);
    expect(buildPayout({ ...base, payee: exempt, orderSideTaxMethod: "exempt" }).invoiceBurden).toBe(0);
    expect(buildPayout(base).invoiceBurden).toBe(0);
  });

  it("免税の方に消費税相当額を上乗せしないと注意（下げるよう勧めない）", () => {
    const r = buildPayout({ ...base, payee: { ...base.payee, invoiceRegistered: false, paysTaxOnTop: false } });
    const w = r.warnings.find((x) => x.code === "exempt_no_tax_equivalent");
    expect(w?.level).toBe("caution");
    expect(w?.message).toContain("一方的に下げると");
    expect(r.tax).toBe(0);
    expect(r.withholding).toBe(8_576);
  });

  it("支払期日：60日を超えると注意。月単位の締めは2か月として数える", () => {
    const ok = buildPayout({ ...base, paymentTerms: { receivedOn: "2026-10-01", payOn: "2026-11-29" } });
    expect(ok.warnings).toEqual([]);
    const over = buildPayout({ ...base, paymentTerms: { receivedOn: "2026-10-01", payOn: "2026-11-30" } });
    expect(over.warnings.map((w) => w.code)).toEqual(["over_60_days"]);
    const monthly = buildPayout({ ...base, paymentTerms: { receivedOn: "2026-10-31", payOn: "2026-11-30", monthlyClosing: true } });
    expect(monthly.warnings).toEqual([]);
    expect(monthly.withholdingDue).toBe("2026-12-10");
  });

  it("外交員：同じ月の給与を渡すと控除額が減り、注意（info）を出す", () => {
    const r = buildPayout({
      ...base,
      lines: [{ label: "外交員報酬", model: "fixed", input: { amount: 300_000 }, withholding: "ko4_gaikoin" }],
      gaikoinMonthlySalary: 50_000,
    });
    expect(r.withholding).toBe(23_483);
    expect(r.warnings.map((w) => w.code)).toEqual(["gaikoin_salary_part"]);
  });

  it("振込額がマイナスなら注意", () => {
    const r = buildPayout({ ...base, deductions: [{ label: "精算", amount: 200_000, agreedInWriting: true }] });
    expect(r.payout).toBeLessThan(0);
    expect(r.warnings.map((w) => w.code)).toContain("negative_payout");
  });
});
