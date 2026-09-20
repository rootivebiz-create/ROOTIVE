import { describe, expect, it } from "vitest";
import {
  breakEvenBillRate,
  calcCompanyMonth,
  calcDriverMonth,
  calcQuote,
  judgeQuote,
  maxPayRate,
  normalizeQuote,
  quoteSensitivity,
  targetBillRate,
  type QuoteInput,
  type RoundingMode,
} from "@/lib/calc";

/** 基本の条件（ドライバー 1 名・日給 20 日・ロイヤリティ 10%・管理費 15,000 円） */
function input(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    billRate: 23025,
    payRate: 21780,
    qty: 20,
    royaltyRate: 0.1,
    mgmtFee: 15000,
    driverCount: 1,
    vehicleCost: 0,
    otherCost: 0,
    roundingMode: "none",
    ...over,
  };
}

/** ドライバー 2 名・車両と経費つきの条件 */
function fleetInput(over: Partial<QuoteInput> = {}): QuoteInput {
  return input({ billRate: 23000, payRate: 20000, qty: 22, driverCount: 2, vehicleCost: 60000, otherCost: 20000, ...over });
}

/** 同じ条件を既存の calcDriverMonth / calcCompanyMonth で組み立てた結果 */
function viaCalc(q: QuoteInput) {
  const one = calcDriverMonth({
    entries: [{ qty: q.qty, billRate: q.billRate, payRate: q.payRate, royaltyRate: q.royaltyRate, roundingMode: q.roundingMode }],
    mgmtFee: q.mgmtFee,
    adjustments: [],
  });
  return calcCompanyMonth(Array.from({ length: q.driverCount }, () => one));
}

describe("見積の計算（calcQuote）は既存の lib/calc と一致する", () => {
  it("売上・支払・単価差・ロイヤリティ・管理費が calcCompanyMonth と同じになる", () => {
    const q = input();
    const r = calcQuote(q);
    const c = viaCalc(q);
    expect(r.bill).toBe(c.bill);
    expect(r.pay).toBe(c.pay);
    expect(r.margin).toBe(c.margin);
    expect(r.royalty).toBe(c.royalty);
    expect(r.mgmtFeeTotal).toBe(c.mgmtFee);
    expect(r.grossProfit).toBe(c.profit);
  });

  it("ドライバー 2 名・車両つきでも calcCompanyMonth と同じ会社利益になる", () => {
    const q = fleetInput();
    const r = calcQuote(q);
    const c = viaCalc(q);
    expect(r.bill).toBe(1012000);
    expect(r.pay).toBe(880000);
    expect(r.royalty).toBe(88000);
    expect(r.mgmtFeeTotal).toBe(30000);
    expect(r.grossProfit).toBe(c.profit);
    expect(r.grossProfit).toBe(250000);
  });

  it("会社利益 ＝ 単価差 ＋ ロイヤリティ ＋ 管理費", () => {
    const r = calcQuote(fleetInput());
    expect(r.grossProfit).toBe(r.margin + r.royalty + r.mgmtFeeTotal);
  });

  it("直課の費用 ＝ 車両の月額 × 人数 ＋ その他の月額", () => {
    const r = calcQuote(fleetInput());
    expect(r.directCost).toBe(60000 * 2 + 20000);
  });

  it("営業利益 ＝ 会社利益 − 直課の費用", () => {
    const r = calcQuote(fleetInput());
    expect(r.operatingProfit).toBe(250000 - 140000);
    expect(r.operatingProfit).toBe(110000);
  });

  it("営業利益率 ＝ 営業利益 ÷ 売上", () => {
    const r = calcQuote(fleetInput());
    expect(r.operatingMargin).toBeCloseTo(110000 / 1012000, 12);
  });

  it("必要売上（requiredBill）＝ 売上 − 営業利益", () => {
    const r = calcQuote(fleetInput());
    expect(r.requiredBill).toBe(902000);
    expect(r.bill - r.requiredBill).toBe(r.operatingProfit);
  });

  it("ドライバー 1 人あたりは合計を人数で割った額になる", () => {
    const r = calcQuote(fleetInput());
    expect(r.perDriver.bill).toBe(506000);
    expect(r.perDriver.grossProfit).toBe(125000);
    expect(r.perDriver.directCost).toBe(60000 + 10000);
    expect(r.perDriver.operatingProfit).toBe(55000);
    expect(r.perDriver.operatingProfit * 2).toBe(r.operatingProfit);
  });

  it("単価・数量・率は保存できる値（小数 2 桁・率は 4 桁）へ丸めてから計算する", () => {
    const r = calcQuote(input({ billRate: 23025.129, payRate: -500, qty: 20.004, royaltyRate: 1.4, driverCount: 2.6 }));
    expect(r.normalized.billRate).toBe(23025.13);
    expect(r.normalized.payRate).toBe(0);
    expect(r.normalized.qty).toBe(20);
    expect(r.normalized.royaltyRate).toBe(1);
    expect(r.normalized.driverCount).toBe(3);
  });

  it("normalizeQuote は 999 人を超えるドライバー数を丸める", () => {
    expect(normalizeQuote(input({ driverCount: 5000 })).driverCount).toBe(999);
    expect(normalizeQuote(input({ driverCount: -3 })).driverCount).toBe(0);
  });
});

describe("判定（verdict）の境界", () => {
  it("営業利益がマイナスなら赤字（loss）と判定し、赤字額をそのまま伝える", () => {
    const r = calcQuote(input({ billRate: 18000 }), 0.15);
    expect(r.operatingProfit).toBeLessThan(0);
    expect(r.verdict.level).toBe("loss");
    expect(r.verdict.message).toContain("赤字");
    expect(r.verdict.message).toContain("受注単価を");
  });

  it("黒字でも目標利益率に届かなければ薄利（thin）", () => {
    const r = calcQuote(fleetInput(), 0.15);
    expect(r.operatingProfit).toBe(110000);
    expect(r.verdict.level).toBe("thin");
    expect(r.verdict.message).toContain("届きません");
  });

  it("目標をちょうど満たすなら良好（good）", () => {
    const r = calcQuote(input({ billRate: 23565 }), 0.2);
    expect(r.operatingMargin).toBeCloseTo(0.2, 12);
    expect(r.verdict.level).toBe("good");
  });

  it("目標をわずかに下回ると薄利（good の 1 つ手前）", () => {
    const r = calcQuote(input({ billRate: 23564.99 }), 0.2);
    expect(r.verdict.level).toBe("thin");
  });

  it("営業利益がちょうど 0 なら赤字ではない（目標 0% なら良好）", () => {
    const r = calcQuote(input({ billRate: 18852 }), 0);
    expect(r.operatingProfit).toBe(0);
    expect(r.verdict.level).toBe("good");
  });

  it("良好のときは「いくらまで下げられるか（損益分岐の受注単価）」を添える", () => {
    const r = calcQuote(input(), 0.1);
    expect(r.verdict.level).toBe("good");
    expect(r.verdict.message).toContain("¥18,852");
  });

  it("judgeQuote は calcQuote の判定と同じ", () => {
    const q = fleetInput();
    expect(judgeQuote(q, 0.15)).toEqual(calcQuote(q, 0.15).verdict);
  });

  it("赤字のときのメッセージに上げ幅と下げ幅の両方が入る", () => {
    const q = input({ billRate: 20000 });
    const r = calcQuote(q, 0.1);
    const up = r.targetBillRate.diff;
    const down = -r.maxPayRate.diff;
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    expect(r.verdict.message).toContain("支払単価を");
  });
});

describe("逆算：営業利益 0 になる受注単価（breakEvenBillRate）", () => {
  it("必要売上 ÷（数量 × 人数）で求まる", () => {
    expect(breakEvenBillRate(input())).toBe(18852);
    expect(breakEvenBillRate(fleetInput())).toBe(20500);
  });

  it("求めた単価を入れ直すと営業利益が 0 になる", () => {
    const rate = breakEvenBillRate(fleetInput());
    expect(rate).not.toBeNull();
    const r = calcQuote(fleetInput({ billRate: rate as number }));
    expect(r.operatingProfit).toBe(0);
    expect(r.operatingMargin).toBe(0);
  });

  it("数量が 0 なら求められない（null）", () => {
    expect(breakEvenBillRate(input({ qty: 0 }))).toBeNull();
  });

  it("ドライバー数が 0 なら求められない（null）", () => {
    expect(breakEvenBillRate(input({ driverCount: 0 }))).toBeNull();
  });

  it("端数が出るときは切り上げる（赤字にならない側へ寄せる）", () => {
    const q = input({ payRate: 20000, qty: 3, mgmtFee: 0 });
    // 必要売上 ＝ 60,000 − 6,000 ＝ 54,000 → 54,000 ÷ 3 ＝ 18,000
    expect(breakEvenBillRate(q)).toBe(18000);
    const odd = input({ payRate: 20000, qty: 7, mgmtFee: 0 });
    const rate = breakEvenBillRate(odd) as number;
    expect(calcQuote({ ...odd, billRate: rate }).operatingProfit).toBeGreaterThanOrEqual(0);
  });
});

describe("逆算：目標を満たす最低の受注単価（targetBillRate）", () => {
  it("式で解いた単価を入れ直すと、ちょうど目標の利益率になる（往復）", () => {
    const sol = targetBillRate(input(), 0.2);
    expect(sol.rate).toBe(23565);
    const r = calcQuote(input({ billRate: sol.rate as number }), 0.2);
    expect(r.operatingMargin).toBeCloseTo(0.2, 12);
    expect(r.verdict.level).toBe("good");
  });

  it("端数が出る条件でも、入れ直すと目標以上になる（往復）", () => {
    const q = fleetInput();
    const sol = targetBillRate(q, 0.15);
    expect(sol.rate).toBe(24117.65);
    const r = calcQuote(fleetInput({ billRate: sol.rate as number }), 0.15);
    expect(r.operatingMargin).toBeGreaterThanOrEqual(0.15);
    expect(r.operatingMargin).toBeCloseTo(0.15, 6);
    expect(r.verdict.level).toBe("good");
  });

  it("1 円安いと目標に届かない（最低の単価であること）", () => {
    const q = fleetInput();
    const sol = targetBillRate(q, 0.15);
    const r = calcQuote(fleetInput({ billRate: (sol.rate as number) - 0.01 }), 0.15);
    expect(r.verdict.level).toBe("thin");
  });

  it("目標 0% は損益分岐の受注単価と同じ", () => {
    expect(targetBillRate(fleetInput(), 0).rate).toBe(breakEvenBillRate(fleetInput()));
  });

  it("今の単価との差（diff）は「あといくら上げればよいか」", () => {
    const sol = targetBillRate(input(), 0.2);
    expect(sol.diff).toBe(23565 - 23025);
    expect(sol.diff).toBe(540);
  });

  it("目標利益率が 100% だと解なし（null）で理由を返す", () => {
    const sol = targetBillRate(input(), 1);
    expect(sol.rate).toBeNull();
    expect(sol.reason).toContain("100%");
  });

  it("数量が 0 だと解なし（null）で理由を返す", () => {
    const sol = targetBillRate(input({ qty: 0 }), 0.2);
    expect(sol.rate).toBeNull();
    expect(sol.reason).toContain("数量");
  });

  it("支払より管理費などの収入が多いときは受注単価 0 でも目標を満たす", () => {
    const sol = targetBillRate(input({ payRate: 0, mgmtFee: 30000, vehicleCost: 0, otherCost: 0 }), 0.2);
    expect(sol.rate).toBe(0);
    expect(sol.reason).toContain("目標を満たします");
  });
});

describe("逆算：支払単価の上限（maxPayRate）", () => {
  it("上限を入れ直すと、ちょうど目標の利益率になる（往復）", () => {
    const sol = maxPayRate(input({ billRate: 23565 }), 0.2);
    expect(sol.rate).toBe(21780);
    const r = calcQuote(input({ billRate: 23565, payRate: sol.rate as number }), 0.2);
    expect(r.operatingMargin).toBeCloseTo(0.2, 12);
    expect(r.verdict.level).toBe("good");
  });

  it("端数が出る条件でも、入れ直すと目標以上になる（往復）", () => {
    const sol = maxPayRate(fleetInput(), 0.15);
    expect(sol.rate).toBe(18944.44);
    const r = calcQuote(fleetInput({ payRate: sol.rate as number }), 0.15);
    expect(r.operatingMargin).toBeGreaterThanOrEqual(0.15);
    expect(r.verdict.level).toBe("good");
  });

  it("1 円高いと目標に届かない（上限であること）", () => {
    const sol = maxPayRate(fleetInput(), 0.15);
    const r = calcQuote(fleetInput({ payRate: (sol.rate as number) + 0.01 }), 0.15);
    expect(r.verdict.level).toBe("thin");
  });

  it("今の単価との差（diff）は「あといくら下げればよいか」（マイナス）", () => {
    const sol = maxPayRate(fleetInput(), 0.15);
    expect(sol.diff).toBeLessThan(0);
    expect(sol.diff).toBeCloseTo(18944.44 - 20000, 6);
  });

  it("支払単価を 0 にしても届かないときは解なし（null）で理由を返す", () => {
    const sol = maxPayRate(input({ billRate: 5000, otherCost: 300000 }), 0.2);
    expect(sol.rate).toBeNull();
    expect(sol.reason).toContain("0 にしても");
  });

  it("ロイヤリティ率 100% なら支払単価を変えても手残りが変わらないので解なし", () => {
    const sol = maxPayRate(input({ royaltyRate: 1 }), 0.1);
    expect(sol.rate).toBeNull();
    expect(sol.reason).toContain("ロイヤリティ");
  });

  it("数量が 0 だと解なし（null）", () => {
    expect(maxPayRate(input({ qty: 0 }), 0.2).rate).toBeNull();
  });

  it("ロイヤリティを切り上げる条件でも目標を割らない（端数処理のずれを検算で吸収）", () => {
    const q = fleetInput({ roundingMode: "ceil", payRate: 20003.33 });
    const sol = maxPayRate(q, 0.12);
    expect(sol.rate).not.toBeNull();
    const r = calcQuote({ ...q, payRate: sol.rate as number }, 0.12);
    expect(r.operatingMargin).toBeGreaterThanOrEqual(0.12);
  });

  it("ロイヤリティを切り捨てる条件でも目標を割らない", () => {
    const q = fleetInput({ roundingMode: "floor", payRate: 20003.33 });
    const sol = maxPayRate(q, 0.12);
    const r = calcQuote({ ...q, payRate: sol.rate as number }, 0.12);
    expect(r.operatingMargin).toBeGreaterThanOrEqual(0.12);
  });
});

describe("端数処理の 4 モード", () => {
  const base = input({ billRate: 1500, payRate: 1234.56, qty: 3, royaltyRate: 0.1, mgmtFee: 0, driverCount: 1 });
  const cases: Array<[RoundingMode, number]> = [
    ["none", 370.368],
    ["floor", 370],
    ["round", 370],
    ["ceil", 371],
  ];

  for (const [mode, expected] of cases) {
    it(`${mode}：ロイヤリティが ${expected} になる（calcDriverMonth と同じ）`, () => {
      const q = { ...base, roundingMode: mode };
      const r = calcQuote(q);
      expect(r.royalty).toBe(expected);
      expect(r.royalty).toBe(viaCalc(q).royalty);
    });
  }

  it("端数処理を変えると営業利益も同じだけ変わる", () => {
    const none = calcQuote({ ...base, roundingMode: "none" });
    const ceil = calcQuote({ ...base, roundingMode: "ceil" });
    expect(ceil.operatingProfit - none.operatingProfit).toBeCloseTo(371 - 370.368, 6);
  });

  it("端数処理は損益分岐の受注単価にも反映される", () => {
    const floor = breakEvenBillRate({ ...base, roundingMode: "floor" }) as number;
    const ceil = breakEvenBillRate({ ...base, roundingMode: "ceil" }) as number;
    expect(floor).toBeGreaterThan(ceil);
  });
});

describe("例外的な条件", () => {
  it("数量 0：売上も管理費も 0（管理費は数量 > 0 の月だけ計上する）", () => {
    const r = calcQuote(input({ qty: 0, vehicleCost: 30000 }), 0.1);
    expect(r.bill).toBe(0);
    expect(r.mgmtFeeTotal).toBe(0);
    expect(r.grossProfit).toBe(0);
    expect(r.directCost).toBe(30000);
    expect(r.operatingProfit).toBe(-30000);
    expect(r.verdict.level).toBe("loss");
    expect(r.breakEvenBillRate).toBeNull();
  });

  it("ドライバー 0 人：案件全体にかかる費用だけが残る", () => {
    const r = calcQuote(input({ driverCount: 0, vehicleCost: 60000, otherCost: 20000 }));
    expect(r.bill).toBe(0);
    expect(r.pay).toBe(0);
    expect(r.directCost).toBe(20000);
    expect(r.operatingProfit).toBe(-20000);
    expect(r.perDriver.bill).toBe(0);
    expect(r.perDriver.operatingProfit).toBe(0);
  });

  it("ロイヤリティ率 0・管理費 0（オーナー本人のケース）：会社利益は単価差だけ", () => {
    const r = calcQuote(input({ payRate: 0, royaltyRate: 0, mgmtFee: 0 }), 0.2);
    expect(r.pay).toBe(0);
    expect(r.royalty).toBe(0);
    expect(r.mgmtFeeTotal).toBe(0);
    expect(r.grossProfit).toBe(r.margin);
    expect(r.grossProfit).toBe(460500);
    expect(r.operatingMargin).toBe(1);
    expect(r.verdict.level).toBe("good");
  });

  it("オーナー本人でも損益分岐の受注単価は 0（費用が無ければ赤字にならない）", () => {
    expect(breakEvenBillRate(input({ payRate: 0, royaltyRate: 0, mgmtFee: 0 }))).toBe(0);
  });

  it("受注単価 0：売上 0・営業利益は支払と費用のぶんマイナス", () => {
    const r = calcQuote(input({ billRate: 0 }), 0.1);
    expect(r.bill).toBe(0);
    expect(r.operatingMargin).toBe(0);
    expect(r.operatingProfit).toBe(-(435600 - 43560 - 15000));
    expect(r.verdict.level).toBe("loss");
  });

  it("すべて 0 の条件でも落ちない", () => {
    const r = calcQuote({ billRate: 0, payRate: 0, qty: 0, royaltyRate: 0, mgmtFee: 0, driverCount: 0, vehicleCost: 0, otherCost: 0, roundingMode: "none" }, 0.1);
    expect(r.operatingProfit).toBe(0);
    expect(r.verdict.level).toBe("thin");
    expect(r.verdict.message).toContain("入力すると試算できます");
    expect(r.breakEvenBillRate).toBeNull();
  });
});

describe("感度の表（quoteSensitivity）", () => {
  it("受注単価を −5% 〜 +5% で振った 5 行を返す", () => {
    const rows = quoteSensitivity(fleetInput(), 0.15, "billRate");
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.ratio)).toEqual([-0.05, -0.025, 0, 0.025, 0.05]);
    expect(rows[2].current).toBe(true);
    expect(rows[2].value).toBe(23000);
  });

  it("「現在」の行は calcQuote の結果と一致する", () => {
    const q = fleetInput();
    const rows = quoteSensitivity(q, 0.15, "billRate");
    const r = calcQuote(q, 0.15);
    expect(rows[2].operatingProfit).toBe(r.operatingProfit);
    expect(rows[2].bill).toBe(r.bill);
    expect(rows[2].level).toBe(r.verdict.level);
  });

  it("受注単価を上げるほど営業利益が増える", () => {
    const rows = quoteSensitivity(fleetInput(), 0.15, "billRate");
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].operatingProfit).toBeGreaterThan(rows[i - 1].operatingProfit);
  });

  it("支払単価を上げるほど営業利益は減る", () => {
    const rows = quoteSensitivity(fleetInput(), 0.15, "payRate");
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].operatingProfit).toBeLessThan(rows[i - 1].operatingProfit);
  });

  it("数量を振ると売上も数量に比例して動く", () => {
    const rows = quoteSensitivity(fleetInput(), 0.15, "qty");
    expect(rows[0].value).toBe(20.9);
    expect(rows[4].value).toBe(23.1);
    expect(rows[0].bill).toBeLessThan(rows[4].bill);
  });

  it("振れ幅は自由に渡せる（−10% / 現在 / +10%）", () => {
    const rows = quoteSensitivity(fleetInput(), 0.15, "billRate", [-0.1, 0, 0.1]);
    expect(rows).toHaveLength(3);
    expect(rows[0].value).toBe(20700);
    expect(rows[2].value).toBe(25300);
  });

  it("赤字になる行は loss、目標を満たす行は good と判定する", () => {
    const rows = quoteSensitivity(input({ billRate: 18852 }), 0, "billRate");
    expect(rows[0].level).toBe("loss");
    expect(rows[2].level).toBe("good");
    expect(rows[4].level).toBe("good");
  });
});
