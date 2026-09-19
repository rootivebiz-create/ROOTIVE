import { describe, expect, it } from "vitest";
import {
  achievementTone,
  breakEvenRatioOf,
  buildKpiMetrics,
  droppedFromPrev,
  judgeBreakEvenRatio,
  judgeContributionRate,
  judgeOperatingMargin,
  judgePayoutRate,
  kpiAlerts,
  kpiChange,
  kpiHeadline,
  toKpiValues,
} from "@/lib/kpi/metrics";
import { hasKpiTrendData, kpiTrendSummary, toKpiTrendRows } from "@/lib/kpi/trend";
import type { MonthKpi } from "@/lib/db/types";
import { accountHolderKanaSchema, bankCodeSchema, branchCodeSchema, accountNumberSchema, isBankAccountFilled, toHalfWidthKana } from "@/lib/schemas/drivers";

/** v_month_kpi の 1 行（必要な列だけ埋める） */
function kpiRow(over: Partial<MonthKpi> = {}): MonthKpi {
  return {
    company_id: "c1",
    month: "2026-09-01",
    status: "open",
    bill: 2_600_000,
    pay: 1_900_000,
    royalty: 190_000,
    margin: 700_000,
    mgmt_fee: 45_000,
    adj_profit: 0,
    payout: 1_665_000,
    payout_incl: 1_831_500,
    profit: 935_000,
    expense_total: 500_000,
    expense_fixed: 400_000,
    expense_variable: 100_000,
    operating_profit: 435_000,
    operating_margin: 0.1673,
    bill_target: 3_000_000,
    profit_target: 500_000,
    entry_count: 42,
    active_driver_count: 5,
    driver_count: 6,
    expense_target: 450_000,
    driver_target: 6,
    work_day_count: 100,
    contribution: 790_000,
    net_fixed_cost: 355_000,
    contribution_rate: 0.3038,
    payout_rate: 0.6404,
    break_even_bill: 1_168_000,
    break_even_ratio: 2.226,
    bill_per_driver: 520_000,
    profit_per_driver: 187_000,
    bill_per_work_day: 26_000,
    expense_achievement: 1.1111,
    bill_achievement: 0.8667,
    profit_achievement: 0.87,
    ...over,
  } as MonthKpi;
}

describe("toKpiValues", () => {
  it("ビューの行を画面用の数値にする（月は YYYY-MM）", () => {
    const v = toKpiValues(kpiRow());
    expect(v.month).toBe("2026-09");
    expect(v.bill).toBe(2_600_000);
    expect(v.contributionRate).toBeCloseTo(0.3038, 4);
    expect(v.hasData).toBe(true);
  });

  it("行が無ければ 0 埋め（hasData=false）", () => {
    const v = toKpiValues(null);
    expect(v.bill).toBe(0);
    expect(v.breakEvenRatio).toBeNull();
    expect(v.hasData).toBe(false);
  });

  it("numeric が文字列で来ても数値にする", () => {
    const v = toKpiValues(kpiRow({ bill: "1000" as unknown as number, contribution: "250" as unknown as number, break_even_bill: "800" as unknown as number }));
    expect(v.bill).toBe(1000);
    expect(v.breakEvenRatio).toBeCloseTo(0.8, 6);
  });
});

describe("breakEvenRatioOf（損益分岐点比率 ＝ 損益分岐点売上高 ÷ 売上）", () => {
  it("ビューの break_even_ratio（売上 ÷ 損益分岐点）とは逆の向きで返す", () => {
    expect(breakEvenRatioOf({ bill: 2_000_000, contribution: 600_000, breakEvenBill: 1_600_000 })).toBeCloseTo(0.8, 6);
  });

  it("売上が無い月・限界利益がマイナスの月は計算しない", () => {
    expect(breakEvenRatioOf({ bill: 0, contribution: 100, breakEvenBill: 0 })).toBeNull();
    expect(breakEvenRatioOf({ bill: 1_000_000, contribution: -50_000, breakEvenBill: 0 })).toBeNull();
  });

  it("固定費がマイナス（管理費が固定費より大きい）なら 0%", () => {
    expect(breakEvenRatioOf({ bill: 1_000_000, contribution: 300_000, breakEvenBill: -20_000 })).toBe(0);
  });
});

describe("判定（健全・ふつう・注意・危険）", () => {
  it("限界利益率は 20% 以上で健全、12% 未満は危険", () => {
    expect(judgeContributionRate(0.25).tone).toBe("good");
    expect(judgeContributionRate(0.2).tone).toBe("good");
    expect(judgeContributionRate(0.15).tone).toBe("warn");
    expect(judgeContributionRate(0.05).tone).toBe("bad");
    expect(judgeContributionRate(null).tone).toBe("info");
  });

  it("損益分岐点比率は 80% 未満で健全、90〜100% は注意、100% 以上は赤字", () => {
    expect(judgeBreakEvenRatio(0.7).tone).toBe("good");
    expect(judgeBreakEvenRatio(0.85).tone).toBe("ok");
    expect(judgeBreakEvenRatio(0.95).tone).toBe("warn");
    expect(judgeBreakEvenRatio(1).tone).toBe("bad");
    expect(judgeBreakEvenRatio(1.2).advice).toContain("赤字");
  });

  it("支払比率は 75% 以下で健全、85% 超は危険", () => {
    expect(judgePayoutRate(0.7).tone).toBe("good");
    expect(judgePayoutRate(0.8).tone).toBe("warn");
    expect(judgePayoutRate(0.9).tone).toBe("bad");
  });

  it("営業利益率はマイナスで危険、10% 以上で健全", () => {
    expect(judgeOperatingMargin(-0.01).tone).toBe("bad");
    expect(judgeOperatingMargin(0.03).tone).toBe("warn");
    expect(judgeOperatingMargin(0.07).tone).toBe("ok");
    expect(judgeOperatingMargin(0.2).tone).toBe("good");
  });

  it("良い数字には助言を付けない", () => {
    expect(judgeContributionRate(0.3).advice).toBeNull();
    expect(judgePayoutRate(0.6).advice).toBeNull();
  });
});

describe("達成率のバッジ色", () => {
  it("売上・利益は 100% 以上で健全、90% 未満は危険", () => {
    expect(achievementTone(1.05, true)).toBe("good");
    expect(achievementTone(0.95, true)).toBe("warn");
    expect(achievementTone(0.5, true)).toBe("bad");
  });

  it("経費は 100% 以下で健全、110% 超は危険", () => {
    expect(achievementTone(0.9, false)).toBe("good");
    expect(achievementTone(1.05, false)).toBe("warn");
    expect(achievementTone(1.3, false)).toBe("bad");
    expect(achievementTone(null, false)).toBe("info");
  });
});

describe("前月比", () => {
  it("金額は差額と増減率、率はポイントで返す", () => {
    const money = kpiChange("money", 120_000, 100_000, true);
    expect(money?.text).toBe("+¥20,000");
    expect(money?.ratio).toBeCloseTo(0.2, 6);
    expect(money?.tone).toBe("good");

    const rate = kpiChange("rate", 0.25, 0.3, true);
    expect(rate?.text).toBe("-5.0pt");
    expect(rate?.tone).toBe("bad");
  });

  it("前月のデータが無ければ null", () => {
    expect(kpiChange("money", 100, null)).toBeNull();
    expect(kpiChange("money", null, 100)).toBeNull();
  });

  it("支払比率のように「増えると悪い」指標は色が反転する", () => {
    expect(kpiChange("rate", 0.8, 0.7, false)?.tone).toBe("bad");
    expect(kpiChange("rate", 0.6, 0.7, false)?.tone).toBe("good");
  });

  it("droppedFromPrev は 5% を超える下落だけを拾う", () => {
    expect(droppedFromPrev(94, 100)).toBe(true);
    expect(droppedFromPrev(96, 100)).toBe(false);
    expect(droppedFromPrev(100, null)).toBe(false);
  });
});

describe("buildKpiMetrics", () => {
  const current = toKpiValues(kpiRow());

  it("7 つの指標に説明と判定が付く", () => {
    const metrics = buildKpiMetrics(current, null);
    expect(metrics.map((m) => m.key)).toEqual([
      "contribution_rate",
      "break_even_bill",
      "break_even_ratio",
      "payout_rate",
      "bill_per_driver",
      "profit_per_driver",
      "bill_per_work_day",
    ]);
    for (const m of metrics) {
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }
    expect(metrics[0].text).toBe("30.4%");
    expect(metrics[0].tone).toBe("good");
  });

  it("赤字の月は損益分岐点の指標が危険になり「あと何円」を出す", () => {
    const bad = toKpiValues(
      kpiRow({ bill: 1_000_000, contribution: 200_000, contribution_rate: 0.2, net_fixed_cost: 400_000, break_even_bill: 2_000_000, operating_profit: -200_000, operating_margin: -0.2 }),
    );
    const metrics = buildKpiMetrics(bad, null);
    const ratio = metrics.find((m) => m.key === "break_even_ratio");
    expect(ratio?.value).toBeCloseTo(2, 6);
    expect(ratio?.tone).toBe("bad");
    expect(ratio?.advice).toContain("¥1,000,000");
    expect(kpiAlerts(metrics).length).toBeGreaterThan(0);
  });

  it("前月より 1 人当たりが下がると注意と助言が出る", () => {
    const prev = toKpiValues(kpiRow({ bill_per_driver: 700_000 }));
    const metrics = buildKpiMetrics(current, prev);
    const perDriver = metrics.find((m) => m.key === "bill_per_driver");
    expect(perDriver?.tone).toBe("warn");
    expect(perDriver?.advice).toContain("前月より下がっています");
    expect(perDriver?.change?.text).toBe("-¥180,000");
  });

  it("稼働日が 0 の月は 1 日当たりを出さず、登録を促す", () => {
    const noDays = toKpiValues(kpiRow({ work_day_count: 0, bill_per_work_day: 0 }));
    const perDay = buildKpiMetrics(noDays, null).find((m) => m.key === "bill_per_work_day");
    expect(perDay?.text).toBe("—");
    expect(perDay?.advice).toContain("今日の報告");
  });
});

describe("kpiHeadline", () => {
  it("データが無ければその旨を出す", () => {
    expect(kpiHeadline(toKpiValues(null)).tone).toBe("info");
  });

  it("黒字で余裕があれば健全", () => {
    const h = kpiHeadline(toKpiValues(kpiRow()));
    expect(h.tone).toBe("good");
    expect(h.text).toContain("黒字");
  });

  it("営業赤字なら危険", () => {
    const h = kpiHeadline(toKpiValues(kpiRow({ operating_profit: -100_000 })));
    expect(h.tone).toBe("bad");
    expect(h.text).toContain("営業赤字");
  });

  it("損益分岐点ぎりぎりなら注意", () => {
    const h = kpiHeadline(toKpiValues(kpiRow({ bill: 1_000_000, contribution: 300_000, break_even_bill: 950_000, operating_profit: 15_000 })));
    expect(h.tone).toBe("warn");
  });
});

describe("推移（12 か月）", () => {
  const rows = toKpiTrendRows([kpiRow({ month: "2026-03-01" }), kpiRow({ month: "2026-09-01", operating_profit: -50_000, break_even_bill: 3_000_000 })], 2026);

  it("データが無い月も 12 か月ぶん並ぶ", () => {
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe("2026-01");
    expect(rows[0].hasData).toBe(false);
    expect(rows[2].hasData).toBe(true);
    expect(rows[8].label).toBe("9月");
  });

  it("年間の平均と苦しかった月を返す", () => {
    const summary = kpiTrendSummary(rows);
    expect(summary.monthCount).toBe(2);
    expect(summary.contributionRate).toBeCloseTo(790_000 / 2_600_000, 6);
    expect(summary.belowBreakEvenCount).toBe(1);
    expect(summary.worst?.month).toBe("2026-09");
    expect(summary.best?.month).toBe("2026-03");
    expect(hasKpiTrendData(rows)).toBe(true);
  });

  it("データがまったく無い年は false", () => {
    expect(hasKpiTrendData(toKpiTrendRows([], 2025))).toBe(false);
    expect(kpiTrendSummary(toKpiTrendRows([], 2025)).monthCount).toBe(0);
  });
});

describe("振込先口座の入力（zod）", () => {
  it("全角カナ・ひらがなを半角カナへ寄せる", () => {
    expect(toHalfWidthKana("ヤマダ タロウ")).toBe("ﾔﾏﾀﾞ ﾀﾛｳ");
    expect(toHalfWidthKana("やまだ　たろう")).toBe("ﾔﾏﾀﾞ ﾀﾛｳ");
    expect(toHalfWidthKana("カ）ルーティブ")).toBe("ｶ)ﾙｰﾃｨﾌﾞ");
    expect(toHalfWidthKana("ｱﾍﾞ ｹﾝ")).toBe("ｱﾍﾞ ｹﾝ");
  });

  it("銀行コード・支店コード・口座番号は桁数を見る（空欄は未入力として通す）", () => {
    expect(bankCodeSchema.parse("0001")).toBe("0001");
    expect(bankCodeSchema.parse("０００１")).toBe("0001");
    expect(bankCodeSchema.parse("")).toBe("");
    expect(bankCodeSchema.safeParse("12345").success).toBe(false);
    expect(branchCodeSchema.parse("001")).toBe("001");
    expect(branchCodeSchema.safeParse("1").success).toBe(false);
    expect(accountNumberSchema.parse("1234567")).toBe("1234567");
    expect(accountNumberSchema.safeParse("12345678").success).toBe(false);
  });

  it("口座名義は半角カナへ変換してから検証する（漢字は拒否）", () => {
    expect(accountHolderKanaSchema.parse(" ヤマダ タロウ ")).toBe("ﾔﾏﾀﾞ ﾀﾛｳ");
    expect(accountHolderKanaSchema.parse("")).toBe("");
    expect(accountHolderKanaSchema.safeParse("山田太郎").success).toBe(false);
  });

  it("振込に必要な 4 項目がそろって初めて「登録済み」", () => {
    expect(isBankAccountFilled({ bank_code: "0001", branch_code: "001", account_number: "1234567", account_holder_kana: "ﾔﾏﾀﾞ" })).toBe(true);
    expect(isBankAccountFilled({ bank_code: "0001", branch_code: "", account_number: "1234567", account_holder_kana: "ﾔﾏﾀﾞ" })).toBe(false);
    expect(isBankAccountFilled({})).toBe(false);
  });
});
