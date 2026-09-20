import { describe, expect, it } from "vitest";
import {
  compareWeeks,
  currentWeekRange,
  emptyWeeklyNumbers,
  formatRangeJa,
  inWeek,
  jstDate,
  mondayOf,
  previousWeekRange,
  shiftDate,
  textWidth,
  weekFromParam,
  weekLinkPath,
  weekMonth,
  weekMonths,
  weekRange,
  weekRangeFrom,
  weeklyDrivers,
  weeklyHighlights,
  weeklyLineText,
  weeklyNumbers,
  weeklyProjects,
  wrapJa,
  WEEKLY_LINE_WIDTH,
  type WeeklyAlertInput,
  type WeeklyEntryInput,
  type WeeklyExpenseInput,
  type WeeklyNumbers,
} from "@/lib/weekly";

/* ---------------------------------------------------------------- 道具 */

/** 先週（2026-09-14 月 〜 2026-09-20 日）を基準にする */
const LAST_WEEK = weekRangeFrom("2026-09-14");

function entry(over: Partial<WeeklyEntryInput> = {}): WeeklyEntryInput {
  return {
    workDate: "2026-09-15",
    driverId: "d1",
    driverName: "山田 太郎",
    projectName: "A 案件",
    itemName: "宅配",
    qty: 1,
    billRate: 20_000,
    payRate: 15_000,
    royaltyRate: 0.1,
    roundingMode: "floor",
    taxMode: "taxable",
    ...over,
  };
}

function expense(over: Partial<WeeklyExpenseInput> = {}): WeeklyExpenseInput {
  return { category: "燃料費", kind: "variable", amount: 10_000, ...over };
}

const TAX = { rate: 0.1, rounding: "floor" as const };

function numbersOf(entries: WeeklyEntryInput[], over: { expenses?: WeeklyExpenseInput[]; alerts?: WeeklyAlertInput[]; tax?: typeof TAX | null } = {}): WeeklyNumbers {
  return weeklyNumbers({
    range: LAST_WEEK,
    entries,
    expenses: over.expenses ?? [],
    alerts: over.alerts ?? [],
    tax: over.tax === undefined ? TAX : over.tax,
  });
}

/* ---------------------------------------------------------------- 週の範囲 */

describe("週の範囲（weekRange）", () => {
  it("月曜の朝に呼ぶと、先週の月曜から日曜までを返す", () => {
    const r = weekRange("2026-09-21"); // 月曜
    expect(r.from).toBe("2026-09-14");
    expect(r.to).toBe("2026-09-20");
  });

  it("日曜に呼んでも、その週ではなく先週を返す", () => {
    const r = weekRange("2026-09-20"); // 日曜
    expect(r.from).toBe("2026-09-07");
    expect(r.to).toBe("2026-09-13");
  });

  it("週の途中（水曜）に呼んでも同じ先週を返す", () => {
    expect(weekRange("2026-09-23").from).toBe("2026-09-14");
    expect(weekRange("2026-09-23").to).toBe("2026-09-20");
  });

  it("ラベルは「2026年9月14日〜9月20日」の形になる", () => {
    expect(weekRange("2026-09-21").label).toBe("2026年9月14日〜9月20日");
  });

  it("月をまたぐ週は、月曜が属する月を稼動月にする", () => {
    const r = weekRange("2026-10-05"); // 月曜
    expect(r.from).toBe("2026-09-28");
    expect(r.to).toBe("2026-10-04");
    expect(weekMonth(r)).toBe("2026-09");
    expect(weekMonths(r)).toEqual(["2026-09", "2026-10"]);
  });

  it("年をまたぐ週は、ラベルに両方の年を出す", () => {
    const r = weekRange("2026-01-05"); // 月曜
    expect(r.from).toBe("2025-12-29");
    expect(r.to).toBe("2026-01-04");
    expect(r.label).toBe("2025年12月29日〜2026年1月4日");
    expect(weekMonth(r)).toBe("2025-12");
  });

  it("Date で渡しても文字列で渡しても同じ結果になる", () => {
    const byDate = weekRange(new Date("2026-09-21T00:00:00+09:00"));
    expect(byDate).toEqual(weekRange("2026-09-21"));
  });

  it("日本時間で判定する（UTC の日曜 15:30 は日本では月曜）", () => {
    expect(weekRange(new Date("2026-09-20T15:30:00Z")).from).toBe("2026-09-14"); // JST 9/21 0:30（月）
    expect(weekRange(new Date("2026-09-20T14:30:00Z")).from).toBe("2026-09-07"); // JST 9/20 23:30（日）
  });

  it("jstDate は日本時間の日付を返す", () => {
    expect(jstDate(new Date("2026-09-20T15:00:00Z"))).toBe("2026-09-21");
    expect(jstDate(new Date("2026-09-20T14:59:59Z"))).toBe("2026-09-20");
  });
});

describe("週のユーティリティ", () => {
  it("mondayOf は日曜を 6 日戻し、月曜はそのままにする", () => {
    expect(mondayOf("2026-09-20")).toBe("2026-09-14"); // 日曜
    expect(mondayOf("2026-09-14")).toBe("2026-09-14"); // 月曜
    expect(mondayOf("2026-09-15")).toBe("2026-09-14"); // 火曜
  });

  it("weekRangeFrom は月曜以外を渡してもその週の月曜に丸める", () => {
    expect(weekRangeFrom("2026-09-17")).toEqual(weekRangeFrom("2026-09-14"));
  });

  it("previousWeekRange はちょうど 7 日前の週を返す", () => {
    const prev = previousWeekRange(LAST_WEEK);
    expect(prev.from).toBe("2026-09-07");
    expect(prev.to).toBe("2026-09-13");
  });

  it("currentWeekRange は今日が属する週を返す", () => {
    expect(currentWeekRange("2026-09-20").from).toBe("2026-09-14");
  });

  it("shiftDate は月・年をまたいでも正しく動く", () => {
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29"); // うるう年
  });

  it("inWeek は両端を含み、範囲外や不正な日付は false になる", () => {
    expect(inWeek(LAST_WEEK, "2026-09-14")).toBe(true);
    expect(inWeek(LAST_WEEK, "2026-09-20")).toBe(true);
    expect(inWeek(LAST_WEEK, "2026-09-21")).toBe(false);
    expect(inWeek(LAST_WEEK, "2026-09-13")).toBe(false);
    expect(inWeek(LAST_WEEK, null)).toBe(false);
    expect(inWeek(LAST_WEEK, "2026-9-14")).toBe(false);
  });

  it("weekFromParam は ?w= が不正なら先週を返す", () => {
    expect(weekFromParam("2026-09-14").from).toBe("2026-09-14");
    expect(weekFromParam(["2026-09-14"]).from).toBe("2026-09-14");
    expect(weekFromParam(undefined, "2026-09-21").from).toBe("2026-09-14");
    expect(weekFromParam("こわれた値", "2026-09-21").from).toBe("2026-09-14");
  });

  it("weekLinkPath は稼動月と週を引き継ぐリンクを作る", () => {
    expect(weekLinkPath(LAST_WEEK)).toBe("/ai?tab=weekly&m=2026-09&w=2026-09-14");
  });

  it("formatRangeJa は同じ年なら年を 1 回だけ出す", () => {
    expect(formatRangeJa("2026-09-14", "2026-09-20")).toBe("2026年9月14日〜9月20日");
    expect(formatRangeJa("2025-12-29", "2026-01-04")).toBe("2025年12月29日〜2026年1月4日");
  });
});

/* ---------------------------------------------------------------- 数字 */

describe("週の数字（weeklyNumbers）", () => {
  it("稼働 1 行から売上・支払・利益・消費税を計算する", () => {
    const n = numbersOf([entry({ qty: 2 })]);
    expect(n.bill).toBe(40_000);
    expect(n.pay).toBe(30_000);
    expect(n.margin).toBe(10_000);
    expect(n.royalty).toBe(3_000);
    expect(n.profit).toBe(13_000);
    expect(n.profitRate).toBeCloseTo(0.325, 6);
    expect(n.payout).toBe(27_000);
    expect(n.tax).toBe(2_700);
    expect(n.payoutIncl).toBe(29_700);
  });

  it("データが 1 件も無い週は、すべて 0 になる", () => {
    const n = emptyWeeklyNumbers(LAST_WEEK);
    expect(n.entryCount).toBe(0);
    expect(n.workDayCount).toBe(0);
    expect(n.driverCount).toBe(0);
    expect(n.bill).toBe(0);
    expect(n.profit).toBe(0);
    expect(n.profitRate).toBe(0);
    expect(n.operatingMargin).toBe(0);
    expect(n.payoutIncl).toBe(0);
    expect(n.cash).toBeNull();
    expect(n.label).toBe(LAST_WEEK.label);
  });

  it("数量 0 の行は稼働日数・ドライバー数に数えない（件数には入る）", () => {
    const n = numbersOf([entry({ qty: 0 }), entry({ qty: 0, driverId: "d2" })]);
    expect(n.entryCount).toBe(2);
    expect(n.activeEntryCount).toBe(0);
    expect(n.workDayCount).toBe(0);
    expect(n.driverCount).toBe(0);
    expect(n.bill).toBe(0);
  });

  it("稼働日数とドライバー数は重複を除いて数える", () => {
    const n = numbersOf([
      entry({ workDate: "2026-09-15", driverId: "d1" }),
      entry({ workDate: "2026-09-15", driverId: "d2" }),
      entry({ workDate: "2026-09-16", driverId: "d1" }),
    ]);
    expect(n.entryCount).toBe(3);
    expect(n.workDayCount).toBe(2);
    expect(n.driverCount).toBe(2);
    expect(n.qtyTotal).toBe(3);
  });

  it("経費を引いて営業利益になる（固定費・変動費の内訳も出る）", () => {
    const n = numbersOf([entry({ qty: 2 })], {
      expenses: [expense({ amount: 4_000 }), expense({ kind: "fixed", category: "家賃", amount: 6_000 })],
    });
    expect(n.expenseTotal).toBe(10_000);
    expect(n.expenseFixed).toBe(6_000);
    expect(n.expenseVariable).toBe(4_000);
    expect(n.expenseCount).toBe(2);
    expect(n.operatingProfit).toBe(3_000); // 会社利益 13,000 − 経費 10,000
  });

  it("経費が利益を上回るとマイナスの営業利益になる", () => {
    const n = numbersOf([entry({ qty: 1 })], { expenses: [expense({ kind: "fixed", amount: 30_000 })] });
    expect(n.profit).toBe(6_500);
    expect(n.operatingProfit).toBe(-23_500);
    expect(n.operatingMargin).toBeCloseTo(-23_500 / 20_000, 6);
  });

  it("課税区分が exempt のドライバーには消費税を付けない", () => {
    const n = numbersOf([entry({ driverId: "d1" }), entry({ driverId: "d2", driverName: "免税 次郎", taxMode: "exempt" })]);
    // 課税の d1 だけ：税抜小計 15,000 − 1,500 = 13,500 → 税 1,350
    expect(n.tax).toBe(1_350);
    expect(n.payout).toBe(27_000);
    expect(n.payoutIncl).toBe(28_350);
  });

  it("消費税の設定が無ければ税は 0 で、税込 ＝ 税抜になる", () => {
    const n = numbersOf([entry({ qty: 2 })], { tax: null });
    expect(n.tax).toBe(0);
    expect(n.payoutIncl).toBe(n.payout);
  });

  it("消費税はドライバーごとの合計にかける（行ごとに丸めない）", () => {
    // pay 10,000 × 3 行、ロイヤリティ率 0 → 税抜小計 30,000 → 税 3,000
    const rows = [1, 2, 3].map(() => entry({ payRate: 10_000, royaltyRate: 0, billRate: 12_000 }));
    expect(numbersOf(rows).tax).toBe(3_000);
  });

  it("端数処理はロイヤリティに効く（切り捨て・四捨五入・丸めない）", () => {
    const base = { qty: 1, payRate: 15_005, royaltyRate: 0.1, billRate: 20_000 };
    expect(numbersOf([entry({ ...base, roundingMode: "floor" })]).royalty).toBe(1_500);
    expect(numbersOf([entry({ ...base, roundingMode: "round" })]).royalty).toBe(1_501);
    expect(numbersOf([entry({ ...base, roundingMode: "ceil" })]).royalty).toBe(1_501);
    expect(numbersOf([entry({ ...base, roundingMode: "none" })]).royalty).toBeCloseTo(1_500.5, 6);
  });

  it("未対応のアラートは件数と重大な件数を数える", () => {
    const alerts: WeeklyAlertInput[] = [
      { title: "書類の期限切れ", severity: "high" },
      { title: "点呼の未実施", severity: "high" },
      { title: "経費が未入力", severity: "low" },
    ];
    const n = numbersOf([entry()], { alerts });
    expect(n.openAlertCount).toBe(3);
    expect(n.highAlertCount).toBe(2);
  });

  it("資金の見込みは入金 ＋／支払 − を集計し、起点の残高から着地を出す", () => {
    const n = weeklyNumbers({
      range: LAST_WEEK,
      entries: [],
      cash: {
        from: "2026-09-21",
        to: "2026-10-21",
        events: [{ amount: 500_000 }, { amount: -300_000 }, { amount: -50_000 }, { amount: null }],
        balance: 1_000_000,
      },
    });
    expect(n.cash?.inflow).toBe(500_000);
    expect(n.cash?.outflow).toBe(350_000);
    expect(n.cash?.net).toBe(150_000);
    expect(n.cash?.endingBalance).toBe(1_150_000);
    expect(n.cash?.eventCount).toBe(4);
  });

  it("起点の残高が未登録なら、着地の見込みは null になる", () => {
    const n = weeklyNumbers({
      range: LAST_WEEK,
      entries: [],
      cash: { from: "2026-09-21", to: "2026-10-21", events: [{ amount: 100 }], balance: null },
    });
    expect(n.cash?.balance).toBeNull();
    expect(n.cash?.endingBalance).toBeNull();
  });
});

describe("内訳（ドライバー別・案件別）", () => {
  it("ドライバー別は売上の多い順に並び、上限で切り詰める", () => {
    const rows = weeklyDrivers(
      [
        entry({ driverId: "d1", driverName: "山田", qty: 1 }),
        entry({ driverId: "d2", driverName: "鈴木", qty: 3 }),
        entry({ driverId: "d3", driverName: "佐藤", qty: 2 }),
      ],
      2,
    );
    expect(rows.map((r) => r.name)).toEqual(["鈴木", "佐藤"]);
    expect(rows[0].bill).toBe(60_000);
    expect(rows[0].profitRate).toBeCloseTo(19_500 / 60_000, 6);
  });

  it("案件別は「案件名 内容名」でまとめる", () => {
    const rows = weeklyProjects([
      entry({ projectName: "A 案件", itemName: "宅配", qty: 1 }),
      entry({ projectName: "A 案件", itemName: "宅配", qty: 2 }),
      entry({ projectName: "B 案件", itemName: "スポット", qty: 1 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("A 案件 宅配");
    expect(rows[0].entryCount).toBe(2);
    expect(rows[0].qty).toBe(3);
  });
});

/* ---------------------------------------------------------------- 前週比 */

describe("前週比（compareWeeks）", () => {
  const current = numbersOf([entry({ qty: 3 })], { expenses: [expense({ amount: 5_000 })] });
  const previous = numbersOf([entry({ qty: 2 })], { expenses: [expense({ amount: 10_000 })] });

  it("増減額・増減率・向きを返す", () => {
    const c = compareWeeks(current, previous);
    expect(c.hasPrevious).toBe(true);
    expect(c.byKey.bill.current).toBe(60_000);
    expect(c.byKey.bill.previous).toBe(40_000);
    expect(c.byKey.bill.diff).toBe(20_000);
    expect(c.byKey.bill.rate).toBeCloseTo(0.5, 6);
    expect(c.byKey.bill.direction).toBe("up");
    expect(c.byKey.bill.isGood).toBe(true);
  });

  it("経費は減ったほうが良い向きになる", () => {
    const c = compareWeeks(current, previous);
    expect(c.byKey.expenseTotal.diff).toBe(-5_000);
    expect(c.byKey.expenseTotal.direction).toBe("down");
    expect(c.byKey.expenseTotal.isGood).toBe(true);
  });

  it("前週が 0 のときは増減率を出さない（null）", () => {
    const c = compareWeeks(current, emptyWeeklyNumbers(previousWeekRange(LAST_WEEK)));
    expect(c.byKey.bill.rate).toBeNull();
    expect(c.byKey.bill.diff).toBe(60_000);
  });

  it("前週の数字が無い（null）ときは hasPrevious が false になる", () => {
    const c = compareWeeks(current, null);
    expect(c.hasPrevious).toBe(false);
    expect(c.byKey.profit.previous).toBe(0);
    expect(c.byKey.profit.rate).toBeNull();
  });

  it("前週がマイナスでも増減率の符号が逆にならない", () => {
    const minus = numbersOf([entry({ qty: 1 })], { expenses: [expense({ amount: 30_000 })] }); // 営業利益 −23,500
    const plus = numbersOf([entry({ qty: 3 })], { expenses: [expense({ amount: 1_000 })] }); // 営業利益 +18,500
    const c = compareWeeks(plus, minus);
    expect(c.byKey.operatingProfit.diff).toBe(42_000);
    expect(c.byKey.operatingProfit.rate).toBeGreaterThan(0);
    expect(c.byKey.operatingProfit.direction).toBe("up");
  });

  it("変化が無い項目は flat になる", () => {
    const c = compareWeeks(current, current);
    expect(c.byKey.bill.direction).toBe("flat");
    expect(c.byKey.bill.diff).toBe(0);
    expect(c.byKey.bill.isGood).toBe(true);
  });

  it("件数の項目は金額として扱わない", () => {
    const c = compareWeeks(current, previous);
    expect(c.byKey.entryCount.isMoney).toBe(false);
    expect(c.byKey.bill.isMoney).toBe(true);
    expect(c.items).toHaveLength(8);
  });
});

/* ---------------------------------------------------------------- 要点 */

describe("いちばん大事なこと（weeklyHighlights）", () => {
  it("稼働が 1 件も無い週でも必ず 1 件は返す", () => {
    const out = weeklyHighlights(emptyWeeklyNumbers(LAST_WEEK), []);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain("稼働の記録がありません");
  });

  it("営業利益がマイナスの週はその事実を伝える", () => {
    const n = numbersOf([entry({ qty: 1 })], { expenses: [expense({ amount: 30_000 })] });
    const out = weeklyHighlights(n, []);
    expect(out.some((t) => t.includes("営業利益は -¥23,500"))).toBe(true);
  });

  it("重大な未対応があれば件数と見出しを出す", () => {
    const alerts: WeeklyAlertInput[] = [{ title: "車検の期限切れ", severity: "high" }];
    const out = weeklyHighlights(numbersOf([entry()], { alerts }), alerts);
    expect(out.some((t) => t.includes("重大な未対応が 1 件") && t.includes("車検の期限切れ"))).toBe(true);
  });

  it("多くても 3 件までしか返さない", () => {
    const alerts: WeeklyAlertInput[] = [
      { title: "車検の期限切れ", severity: "high" },
      { title: "点呼の未実施", severity: "high" },
    ];
    const n = numbersOf([entry({ qty: 1 })], { expenses: [expense({ amount: 30_000 })], alerts });
    expect(weeklyHighlights(n, alerts).length).toBe(3);
  });

  it("ふつうの週は売上と営業利益、稼働の規模を伝える", () => {
    const n = numbersOf([entry({ qty: 2 })], { expenses: [expense({ amount: 1_000 })] });
    const out = weeklyHighlights(n, []);
    expect(out[0]).toContain("先週の売上は ¥40,000");
    expect(out[1]).toContain("稼働は 1 件・1 日");
  });

  it("売上が前週より 10% 以上動いたときは前週比に触れる", () => {
    const current = numbersOf([entry({ qty: 3 })]);
    const previous = numbersOf([entry({ qty: 1 })]);
    const out = weeklyHighlights(current, [], compareWeeks(current, previous));
    expect(out.some((t) => t.includes("売上は前週より") && t.includes("増えました"))).toBe(true);
  });

  it("資金の見込みがマイナスなら注意を促す", () => {
    const n = weeklyNumbers({
      range: LAST_WEEK,
      entries: [entry()],
      cash: { from: "2026-09-21", to: "2026-10-21", events: [{ amount: -900_000 }], balance: 100_000 },
    });
    expect(weeklyHighlights(n, []).some((t) => t.includes("資金は -¥800,000"))).toBe(true);
  });
});

/* ---------------------------------------------------------------- LINE の本文 */

describe("LINE の本文（weeklyLineText）", () => {
  const numbers = numbersOf([entry({ qty: 2 }), entry({ qty: 1, driverId: "d2", workDate: "2026-09-16" })], { expenses: [expense({ amount: 5_000 })] });
  const text = weeklyLineText({
    companyName: "株式会社ROOTIVE",
    numbers,
    summary: "先週は売上・利益ともに前週を上回りました。",
    highlights: ["売上は前週より ¥20,000（50.0%）増えました。", "経費は 5,000 円でした。"],
    url: "https://example.com/ai?tab=weekly&w=2026-09-14",
  });

  it("先頭に会社名と期間が入る", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("【株式会社ROOTIVE】先週の経営サマリー");
    expect(lines[1]).toBe("2026年9月14日〜9月20日");
  });

  it("売上・稼働・支払の 3 行が入る", () => {
    expect(text).toContain("売上 ¥60,000");
    expect(text).toContain("営業利益 ¥14,500");
    expect(text).toContain("稼働 2 件・2 日");
    expect(text).toContain("ドライバー 2 名");
    expect(text).toContain("経費 ¥5,000");
  });

  it("最後は「続きはアプリで」と URL で終わる", () => {
    const lines = text.trim().split("\n");
    expect(lines[lines.length - 2]).toBe("続きはアプリで");
    expect(lines[lines.length - 1]).toBe("https://example.com/ai?tab=weekly&w=2026-09-14");
  });

  it("絵文字を使わない", () => {
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it("URL 以外の行は全角 40 文字を超えない", () => {
    for (const line of text.split("\n")) {
      if (line.startsWith("http")) continue;
      expect(textWidth(line)).toBeLessThanOrEqual(WEEKLY_LINE_WIDTH);
    }
  });

  it("URL は途中で折り返さない", () => {
    const long = "https://rootive.example.com/ai?tab=weekly&m=2026-09&w=2026-09-14";
    const out = weeklyLineText({ companyName: "ROOTIVE", numbers, url: long });
    expect(out).toContain(long);
  });

  it("要点や総括が無くても本文ができる", () => {
    const out = weeklyLineText({ companyName: "", numbers: emptyWeeklyNumbers(LAST_WEEK), url: null });
    expect(out.split("\n")[0]).toBe("先週の経営サマリー");
    expect(out).toContain("続きはアプリで");
    expect(out).toContain("売上 ¥0");
  });

  it("要点は番号付きで並ぶ", () => {
    expect(text).toContain("気になる点");
    expect(text).toContain("1. 売上は前週より");
    expect(text).toContain("2. 経費は 5,000 円でした。");
  });

  it("wrapJa は日本語を幅で折り返し、金額を途中で切らない", () => {
    const lines = wrapJa("先週の売上は ¥1,234,567 でした。営業利益は ¥234,567（19.0%）で、前の週より増えています。", 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(20 + 1);
    expect(lines.join("")).toContain("¥1,234,567");
    expect(lines.some((l) => l.endsWith("¥"))).toBe(false);
  });

  it("textWidth は半角を 0.5、全角を 1 と数える", () => {
    expect(textWidth("abcd")).toBe(2);
    expect(textWidth("あいう")).toBe(3);
    expect(textWidth("")).toBe(0);
  });

  it("句読点は行頭に落とさない", () => {
    const lines = wrapJa("あいうえおかきくけこさしすせそ、たちつてと。", 15);
    expect(lines.some((l) => l.startsWith("、") || l.startsWith("。"))).toBe(false);
  });
});

describe("AI が無いときの本文", () => {
  it("総括と同じ文は「気になる点」に重ねて出さない", () => {
    const numbers = numbersOf([entry({ qty: 2 })]);
    const points = weeklyHighlights(numbers, []);
    const out = weeklyLineText({ companyName: "ROOTIVE", numbers, summary: points[0], highlights: points, url: null });
    const first = points[0];
    expect(out.split(first).length - 1).toBe(1);
    expect(out).toContain(points[1]);
  });

  it("要点が総括だけのときは「気になる点」の見出しを出さない", () => {
    const numbers = emptyWeeklyNumbers(LAST_WEEK);
    const points = weeklyHighlights(numbers, []);
    const out = weeklyLineText({ companyName: "ROOTIVE", numbers, summary: points[0], highlights: [points[0]], url: null });
    expect(out).not.toContain("気になる点");
  });
});
