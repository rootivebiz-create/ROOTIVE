import { describe, expect, it } from "vitest";
import { cx } from "@/lib/cx";
import { compactYen, groupDigits, jpDate, jpMonth, jpToday, manYen, monthLabel, rangeYen, regNoText, yenText } from "@/lib/format";
import { buildPlans, buildWeeksText, priceSummary, trialPlan } from "@/lib/plans";
import type { Plan } from "@/site.config";

describe("円の書式（lib/format）", () => {
  it("yenText・groupDigits は円に丸めてカンマ区切り", () => {
    expect(yenText(250000)).toBe("250,000円");
    expect(yenText(1234.5)).toBe("1,235円");
    expect(groupDigits(1_100_000)).toBe("1,100,000");
  });

  it("compactYen は千円単位で割り切れるときだけ万円にする", () => {
    expect(compactYen(250000)).toBe("25万円");
    expect(compactYen(18000)).toBe("1.8万円");
    expect(compactYen(12345)).toBe("12,345円");
    expect(compactYen(5000)).toBe("5,000円");
  });

  it("rangeYen は同じなら 1 つ、違えば「〜」でつなぐ", () => {
    expect(rangeYen(250000, 480000)).toBe("25万〜48万円");
    expect(rangeYen(18000, 18000)).toBe("1.8万円");
  });

  it("manYen は万円の単位", () => {
    expect(manYen(50000)).toBe("5万円");
    expect(manYen(1_000_000)).toBe("100万円");
  });

  it("regNoText は数字 13 桁なら T を付ける", () => {
    expect(regNoText("1234567890123")).toBe("T1234567890123");
    expect(regNoText("T1234567890123")).toBe("T1234567890123");
    expect(regNoText(" 1234 567890123 ")).toBe("T1234567890123");
  });
});

describe("日付の書式（lib/format）", () => {
  it("jpDate は YYYY-MM-DD を和文にし、形が違えばそのまま", () => {
    expect(jpDate("2026-10-01")).toBe("2026年10月1日");
    expect(jpDate("2026-11-30")).toBe("2026年11月30日");
    expect(jpDate("")).toBe("");
    expect(jpDate("2026/10/01")).toBe("2026/10/01");
  });

  it("jpMonth は YYYY-MM でも YYYY-MM-DD でも読む", () => {
    expect(jpMonth("2026-09")).toBe("2026年9月");
    expect(jpMonth("2026-10-01")).toBe("2026年10月");
    expect(jpMonth("?")).toBe("?");
  });

  it("monthLabel は「〇月分」", () => {
    expect(monthLabel("2026-10-31")).toBe("2026年10月分");
    expect(monthLabel("x")).toBe("x");
  });

  it("jpToday は日本時間の日付", () => {
    expect(jpToday(new Date("2026-09-22T15:30:00Z"))).toBe("2026年9月23日");
  });
});

describe("cx", () => {
  it("偽の値を飛ばしてつなぐ", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });
});

describe("料金の組み立て（lib/plans）", () => {
  const plan = (id: string, initialYen: number, monthlyYen: number): Plan => ({
    id,
    name: id,
    forWhom: "",
    initialYen,
    monthlyYen,
    weeks: "",
    includes: [],
  });
  const plans = [plan("t", 30000, 0), plan("a", 200000, 20000), plan("b", 300000, 15000)];

  it("お試しは月額 0 のもの、パックは月額のあるもの", () => {
    expect(trialPlan(plans)?.id).toBe("t");
    expect(buildPlans(plans).map((p) => p.id)).toEqual(["a", "b"]);
    expect(trialPlan([plan("a", 1, 1)])).toBeNull();
  });

  it("priceSummary は一番安い月額を出す。何も無ければ空", () => {
    expect(priceSummary(plans)).toBe("お試し3万円・月額1.5万円から（税抜）");
    expect(priceSummary([])).toBe("");
  });

  it("buildWeeksText はパックの期間の幅", () => {
    const withWeeks = [
      { ...plan("a", 1, 1), weeks: "約4週間" },
      { ...plan("b", 1, 1), weeks: "約6週間" },
      { ...plan("t", 1, 0), weeks: "約2週間" },
    ];
    expect(buildWeeksText(false, withWeeks)).toBe("4〜6週間");
    expect(buildWeeksText(true, withWeeks)).toBe("約4〜6週間");
    expect(buildWeeksText(false, [withWeeks[0]])).toBe("4週間");
    expect(buildWeeksText(false, [])).toBeUndefined();
  });
});
