import { describe, expect, it } from "vitest";
import {
  calcInvoiceCost,
  daysBetween,
  groupDigits,
  jpDate,
  periodLabel,
  readAmount,
  shareText,
  toDateString,
  totalFromHeadcount,
} from "@/lib/tools/invoice-cost";

describe("免税ドライバーへの支払で会社が負担する消費税", () => {
  const general = calcInvoiceCost({ monthlyPaidInclTax: 1_100_000, taxMethod: "general", today: "2026-09-23" });

  it("月 110 万円（税込）の期間ごとの負担", () => {
    expect(general.rows.map((r) => r.label)).toEqual([
      "2023年10月〜2026年9月",
      "2026年10月〜2028年9月",
      "2028年10月〜2030年9月",
      "2030年10月〜2031年9月",
      "2031年10月〜",
    ]);
    expect(general.rows.map((r) => r.deductibleRate)).toEqual([0.8, 0.7, 0.5, 0.3, 0]);
    expect(general.rows.map((r) => r.burdenRate)).toEqual([0.2, 0.3, 0.5, 0.7, 1]);
    expect(general.rows.map((r) => r.monthly)).toEqual([20_000, 30_000, 50_000, 70_000, 100_000]);
    expect(general.rows.map((r) => r.yearly)).toEqual([240_000, 360_000, 600_000, 840_000, 1_200_000]);
    expect(general.creditableTax).toBe(100_000);
    expect(general.affected).toBe(true);
  });

  it("2026年9月なら今は 80%、10月から月 1 万円増える", () => {
    expect(general.current?.from).toBe("2023-10-01");
    expect(general.next?.from).toBe("2026-10-01");
    expect(general.daysUntilNext).toBe(8);
    expect(general.rows.map((r) => r.status)).toEqual(["current", "future", "future", "future", "future"]);
    expect(general.rows.map((r) => r.diffMonthly)).toEqual([0, 10_000, 30_000, 50_000, 80_000]);
  });

  it("期間の境目は仕入れた日で切りかわる", () => {
    const lastDay = calcInvoiceCost({ monthlyPaidInclTax: 1_100_000, taxMethod: "general", today: "2026-09-30" });
    expect(lastDay.current?.deductibleRate).toBe(0.8);
    expect(lastDay.daysUntilNext).toBe(1);

    const firstDay = calcInvoiceCost({ monthlyPaidInclTax: 1_100_000, taxMethod: "general", today: "2026-10-01" });
    expect(firstDay.current?.deductibleRate).toBe(0.7);
    expect(firstDay.next?.deductibleRate).toBe(0.5);
    expect(firstDay.rows.map((r) => r.status)).toEqual(["past", "current", "future", "future", "future"]);
    expect(firstDay.rows.map((r) => r.diffMonthly)).toEqual([-10_000, 0, 20_000, 40_000, 70_000]);
  });

  it("最後の期間（2031年10月から）には次が無い", () => {
    const end = calcInvoiceCost({ monthlyPaidInclTax: 1_100_000, taxMethod: "general", today: "2031-10-01" });
    expect(end.current?.monthly).toBe(100_000);
    expect(end.next).toBeNull();
    expect(end.daysUntilNext).toBeNull();
    expect(shareText(end)).toContain("全額が会社の負担");
  });

  it("経過措置の前なら今は無く、最初の期間が次", () => {
    const before = calcInvoiceCost({ monthlyPaidInclTax: 1_100_000, taxMethod: "general", today: "2023-09-30" });
    expect(before.current).toBeNull();
    expect(before.next?.from).toBe("2023-10-01");
    expect(before.rows[0].diffMonthly).toBe(20_000);
  });

  it("税込 11 万円なら 9 月まで 2,000 円、10 月から 3,000 円", () => {
    const r = calcInvoiceCost({ monthlyPaidInclTax: 110_000, taxMethod: "general", today: "2026-09-23" });
    expect(r.rows[0].monthly).toBe(2_000);
    expect(r.rows[1].monthly).toBe(3_000);
  });

  it("1 円未満は切り捨て", () => {
    const r = calcInvoiceCost({ monthlyPaidInclTax: 123_456, taxMethod: "general", today: "2026-09-23" });
    // 123,456 × 10/110 = 11,223.27… → × 20% = 2,244.65… → 2,244、× 30% = 3,366.98… → 3,366
    expect(r.rows[0].monthly).toBe(2_244);
    expect(r.rows[1].monthly).toBe(3_366);
    expect(r.rows[0].yearly).toBe(26_928);
    expect(r.creditableTax).toBe(11_223);
  });

  it("簡易課税・2割特例はすべて 0 で、説明を出す", () => {
    const r = calcInvoiceCost({ monthlyPaidInclTax: 1_100_000, taxMethod: "simplified", today: "2026-09-23" });
    expect(r.affected).toBe(false);
    expect(r.rows.every((row) => row.monthly === 0 && row.yearly === 0 && row.diffMonthly === 0)).toBe(true);
    expect(r.current?.deductibleRate).toBe(0.8);
    expect(shareText(r)).toContain("負担は増えません");
  });

  it("共有用の文章", () => {
    expect(shareText(general)).toBe(
      "免税（インボイス未登録）のドライバーへの支払が月¥1,100,000（税込）だと、控除できずに会社が負担する消費税は、いま月¥20,000（年¥240,000）。2026年10月からは月¥30,000（年¥360,000）になり、月¥10,000増えます。",
    );
  });
});

describe("入力の読み取り", () => {
  it("全角・カンマ・円・万を受け付ける", () => {
    expect(readAmount("1,100,000")).toEqual({ value: 1_100_000, error: null });
    expect(readAmount("１，１００，０００円")).toEqual({ value: 1_100_000, error: null });
    expect(readAmount("¥220000")).toEqual({ value: 220_000, error: null });
    expect(readAmount("110万")).toEqual({ value: 1_100_000, error: null });
    expect(readAmount("１１０万円")).toEqual({ value: 1_100_000, error: null });
    expect(readAmount("22.5万")).toEqual({ value: 225_000, error: null });
    expect(readAmount("1000.4")).toEqual({ value: 1_000, error: null });
  });

  it("空・数字でない・マイナス・大きすぎる", () => {
    expect(readAmount("  ")).toEqual({ value: null, error: null });
    expect(readAmount("abc").error).not.toBeNull();
    expect(readAmount("万").error).not.toBeNull();
    expect(readAmount("-5000").error).toBe("0円以上で入れてください");
    expect(readAmount("999999999999").error).not.toBeNull();
  });

  it("人数 × 1 人あたり", () => {
    expect(totalFromHeadcount("5", "220,000")).toBe(1_100_000);
    expect(totalFromHeadcount("５人", "22万")).toBe(1_100_000);
    expect(totalFromHeadcount("0", "220,000")).toBeNull();
    expect(totalFromHeadcount("2.5", "220,000")).toBeNull();
    expect(totalFromHeadcount("5", "")).toBeNull();
    expect(totalFromHeadcount("", "220000")).toBeNull();
  });

  it("書式と日付", () => {
    expect(groupDigits(1_100_000)).toBe("1,100,000");
    expect(periodLabel("2026-10-01", "2028-09-30")).toBe("2026年10月〜2028年9月");
    expect(periodLabel("2031-10-01", null)).toBe("2031年10月〜");
    expect(jpDate("2026-10-01")).toBe("2026年10月1日");
    expect(toDateString(new Date(2026, 8, 3))).toBe("2026-09-03");
    expect(daysBetween("2026-09-23", "2026-10-01")).toBe(8);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});
