import { describe, expect, it } from "vitest";
import { subMoney } from "@/lib/calc/money";
import {
  biggestVariance,
  explainVariance,
  sortVarianceByImpact,
  varianceTotal,
  VARIANCE_KEYS,
  VARIANCE_LABELS,
  type VarianceActual,
  type VarianceItem,
  type VariancePlan,
} from "@/lib/executive/variance";

/* ---------------------------------------------------------------- 道具 */

/** 目標：売上 1,000 万・営業利益 100 万・経費 200 万・10 名（＝ 目標の会社利益率 30%） */
function plan(over: Partial<VariancePlan> = {}): VariancePlan {
  return { bill: 10_000_000, operatingProfit: 1_000_000, expense: 2_000_000, driverCount: 10, ...over };
}

/** 実績：売上 900 万・粗利 220 万・会社利益 250 万・経費 210 万・9 名 */
function actual(over: Partial<VarianceActual> = {}): VarianceActual {
  return {
    bill: 9_000_000,
    margin: 2_200_000,
    profit: 2_500_000,
    expenseTotal: 2_100_000,
    operatingProfit: 400_000,
    activeDriverCount: 9,
    ...over,
  };
}

function byKey(items: VarianceItem[]): Record<string, number> {
  return Object.fromEntries(items.map((i) => [i.key, i.amount]));
}

/* ---------------------------------------------------------------- 形 */

describe("explainVariance：返す形", () => {
  it("いつも 5 項目を決まった順に返す", () => {
    const items = explainVariance(plan(), actual());
    expect(items.map((i) => i.key)).toEqual(VARIANCE_KEYS);
    expect(items.map((i) => i.label)).toEqual(["人数", "稼働量", "受注単価", "支払単価", "経費"]);
  });

  it("各項目に日本語の見出しと向きと説明が入る", () => {
    for (const i of explainVariance(plan(), actual())) {
      expect(i.label).toBe(VARIANCE_LABELS[i.key]);
      expect(i.direction).toBe(i.amount < 0 ? "minus" : "plus");
      expect(i.detail.length).toBeGreaterThan(0);
      expect(i.detail.endsWith("。")).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------- 合計の一致 */

describe("explainVariance：合計は必ず実際の差と一致する", () => {
  it("目標より少ない月", () => {
    const items = explainVariance(plan(), actual());
    expect(varianceTotal(items)).toBe(subMoney(400_000, 1_000_000));
    expect(varianceTotal(items)).toBe(-600_000);
  });

  it("内訳は 人数 −30 万・稼働量 0・受注単価 −20 万・支払単価 0・経費 −10 万", () => {
    expect(byKey(explainVariance(plan(), actual()))).toEqual({
      drivers: -300_000,
      volume: 0,
      billRate: -200_000,
      payRate: 0,
      expense: -100_000,
    });
  });

  it("経費の項目は「目標の経費 − 実績の経費」になる（端数もここが吸収する）", () => {
    // 営業利益 ＝ 会社利益 − 経費 を保って経費だけ増やす
    const items = explainVariance(plan({ expense: 2_000_000 }), actual({ expenseTotal: 2_345_678, operatingProfit: 154_322 }));
    const expense = items.find((i) => i.key === "expense");
    expect(expense?.amount).toBe(subMoney(2_000_000, 2_345_678));
  });

  it("割り切れない率でも合計はぴったり合う", () => {
    const p = plan({ bill: 3_333_333, operatingProfit: 333_333, expense: 777_777, driverCount: 7 });
    const a = actual({ bill: 2_777_777, margin: 777_771, profit: 888_881, expenseTotal: 666_663, operatingProfit: 222_218, activeDriverCount: 6 });
    const items = explainVariance(p, a);
    expect(varianceTotal(items)).toBe(subMoney(222_218, 333_333));
  });

  it("目標を上回った月もぴったり合う", () => {
    const a = actual({ bill: 12_000_000, margin: 3_600_000, profit: 4_000_000, expenseTotal: 1_900_000, operatingProfit: 2_100_000, activeDriverCount: 12 });
    const items = explainVariance(plan(), a);
    expect(varianceTotal(items)).toBe(1_100_000);
    expect(items.every((i) => i.amount >= 0)).toBe(true);
  });
});

/* ---------------------------------------------------------------- 差が 0 のとき */

describe("explainVariance：差が 0 のとき", () => {
  it("目標どおりなら 5 項目とも 0", () => {
    const a = actual({ bill: 10_000_000, margin: 2_800_000, profit: 3_000_000, expenseTotal: 2_000_000, operatingProfit: 1_000_000, activeDriverCount: 10 });
    const items = explainVariance(plan(), a);
    expect(items.every((i) => i.amount === 0)).toBe(true);
    expect(varianceTotal(items)).toBe(0);
    expect(items.every((i) => i.direction === "plus")).toBe(true);
  });

  it("差が 0 なら「いちばん大きい項目」は無い", () => {
    const a = actual({ bill: 10_000_000, margin: 2_800_000, profit: 3_000_000, expenseTotal: 2_000_000, operatingProfit: 1_000_000, activeDriverCount: 10 });
    expect(biggestVariance(explainVariance(plan(), a))).toBeNull();
  });
});

/* ---------------------------------------------------------------- 目標が 0 のとき */

describe("explainVariance：目標が 0 のとき", () => {
  it("売上の目標が 0（未設定）なら空配列", () => {
    expect(explainVariance(plan({ bill: 0 }), actual())).toEqual([]);
  });

  it("売上の目標がマイナス・未設定でも空配列", () => {
    expect(explainVariance(plan({ bill: -1 }), actual())).toEqual([]);
    expect(explainVariance({ bill: Number.NaN, operatingProfit: 0 }, actual())).toEqual([]);
  });

  it("空配列なら合計も 0、いちばん大きい項目も無い", () => {
    const items = explainVariance(plan({ bill: 0 }), actual());
    expect(varianceTotal(items)).toBe(0);
    expect(biggestVariance(items)).toBeNull();
  });
});

/* ---------------------------------------------------------------- 目標に無い数字の補い方 */

describe("explainVariance：目標に無い数字は実績で補う", () => {
  it("人数の目標が無ければ人数の差は 0（売上の差はすべて稼働量へ）", () => {
    const items = explainVariance(plan({ driverCount: 0 }), actual());
    const m = byKey(items);
    expect(m.drivers).toBe(0);
    expect(m.volume).toBe(-300_000);
    expect(varianceTotal(items)).toBe(-600_000);
  });

  it("経費の目標が無ければ経費の差は 0", () => {
    const items = explainVariance(plan({ expense: 0 }), actual());
    expect(byKey(items).expense).toBe(0);
  });

  it("粗利率の目標を渡すと受注単価と支払単価に分かれる", () => {
    const items = explainVariance(plan({ marginRate: 0.25 }), actual());
    const m = byKey(items);
    expect(m.billRate).toBe(-50_000);
    expect(m.payRate).toBe(-150_000);
    // 分け方を変えても合計は動かない
    expect(varianceTotal(items)).toBe(-600_000);
    expect(m.billRate + m.payRate).toBe(-200_000);
  });

  it("粗利率の目標が無いときは支払単価が 0 で「目標どおり」と書く", () => {
    const pay = explainVariance(plan(), actual()).find((i) => i.key === "payRate");
    expect(pay?.amount).toBe(0);
    expect(pay?.detail).toBe("支払（ロイヤリティ・管理費を含む）の比率は目標どおりです。");
  });
});

/* ---------------------------------------------------------------- 並べ替えと注目点 */

describe("biggestVariance / sortVarianceByImpact", () => {
  it("効き目（絶対値）がいちばん大きい項目を返す", () => {
    expect(biggestVariance(explainVariance(plan(), actual()))?.key).toBe("drivers");
  });

  it("押し上げた項目でも効き目が大きければ選ぶ", () => {
    const items: VarianceItem[] = [
      { key: "drivers", label: "人数", amount: -100, direction: "minus", detail: "" },
      { key: "expense", label: "経費", amount: 500, direction: "plus", detail: "" },
    ];
    expect(biggestVariance(items)?.key).toBe("expense");
  });

  it("押し下げた順に並べ替える", () => {
    expect(sortVarianceByImpact(explainVariance(plan(), actual())).map((i) => i.key)).toEqual([
      "drivers",
      "billRate",
      "expense",
      "volume",
      "payRate",
    ]);
  });

  it("並べ替えても元の配列は変わらない", () => {
    const items = explainVariance(plan(), actual());
    const before = items.map((i) => i.key);
    sortVarianceByImpact(items);
    expect(items.map((i) => i.key)).toEqual(before);
  });
});

/* ---------------------------------------------------------------- 説明文 */

describe("explainVariance：説明文", () => {
  it("人数・1 人当たり売上・粗利率・経費を日本語で書く", () => {
    const items = explainVariance(plan(), actual());
    const m = Object.fromEntries(items.map((i) => [i.key, i.detail]));
    expect(m.drivers).toBe("稼働ドライバーは 9 名（目標 10 名）で、1 名少ないです。");
    expect(m.volume).toBe("1 人当たりの売上は ¥1,000,000（目標 ¥1,000,000）で、目標どおりです。");
    expect(m.billRate).toBe("粗利率は 24.4%（目標 26.7%）で、2.2% 低いです。");
    expect(m.expense).toBe("経費は ¥2,100,000（目標 ¥2,000,000）で、¥100,000 多いです。");
  });
});
