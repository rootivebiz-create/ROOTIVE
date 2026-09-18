import { describe, expect, it } from "vitest";
import { parsePortalCurrent, summarizeYears, toPortalMonthRows, type PortalMonthRow } from "@/components/driver/helpers";

const row = (month: string, status: "open" | "closed", payoutIncl: number | null, tax: number | null = 0): PortalMonthRow => ({
  month,
  status,
  payoutIncl,
  payout: payoutIncl == null ? null : payoutIncl - (tax ?? 0),
  tax,
  closedAt: status === "closed" ? "2026-10-05T00:00:00Z" : null,
});

describe("ドライバーポータル：月一覧の変換（toPortalMonthRows）", () => {
  it("月初日を稼動月に直し、数値の文字列も数値にする", () => {
    const rows = toPortalMonthRows([
      { month: "2026-09-01", status: "closed", payout: "100000", tax: "10000", payout_incl: "110000", closed_at: "2026-10-05T00:00:00Z" },
    ]);
    expect(rows).toEqual([{ month: "2026-09", status: "closed", payout: 100000, tax: 10000, payoutIncl: 110000, closedAt: "2026-10-05T00:00:00Z" }]);
  });

  it("未締め月は金額が null のまま残り、状態は open になる", () => {
    const rows = toPortalMonthRows([{ month: "2026-10-01", status: "open", payout: null, tax: null, payout_incl: null, closed_at: null }]);
    expect(rows).toEqual([{ month: "2026-10", status: "open", payout: null, tax: null, payoutIncl: null, closedAt: null }]);
  });

  it("月が無い行・配列でない入力は捨てる", () => {
    expect(toPortalMonthRows([{ status: "closed" }, null, "x", { month: "こわれた" }])).toEqual([]);
    expect(toPortalMonthRows(null)).toEqual([]);
    expect(toPortalMonthRows(undefined)).toEqual([]);
  });
});

describe("ドライバーポータル：年間サマリー（summarizeYears）", () => {
  it("年ごとにまとめ、年は降順・月は降順で並ぶ（年またぎ）", () => {
    const years = summarizeYears([row("2025-12", "closed", 100), row("2026-01", "closed", 200), row("2026-03", "closed", 300), row("2024-07", "closed", 50)]);
    expect(years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
    expect(years[0].months.map((m) => m.month)).toEqual(["2026-03", "2026-01"]);
    expect(years.map((y) => y.label)).toEqual(["2026年", "2025年", "2024年"]);
  });

  it("年の合計（税込お支払額）と締め済み月数を出す", () => {
    const years = summarizeYears([row("2026-01", "closed", 110000, 10000), row("2026-02", "closed", 220000, 20000)]);
    expect(years[0].totalPayoutIncl).toBe(330000);
    expect(years[0].totalTax).toBe(30000);
    expect(years[0].closedCount).toBe(2);
    expect(years[0].averagePayoutIncl).toBe(165000);
  });

  it("未締め月は合計にも締め済み月数にも入らないが、一覧には残る", () => {
    const years = summarizeYears([row("2026-09", "open", null), row("2026-08", "closed", 110000, 10000)]);
    expect(years[0].months).toHaveLength(2);
    expect(years[0].closedCount).toBe(1);
    expect(years[0].openCount).toBe(1);
    expect(years[0].totalPayoutIncl).toBe(110000);
  });

  it("締め済みが 0 件の年は合計も平均も 0 になる", () => {
    const years = summarizeYears([row("2026-09", "open", null), row("2026-08", "open", null)]);
    expect(years[0].closedCount).toBe(0);
    expect(years[0].totalPayoutIncl).toBe(0);
    expect(years[0].averagePayoutIncl).toBe(0);
  });

  it("締め済みでも金額が null の月は 0 として合計する", () => {
    const years = summarizeYears([row("2026-01", "closed", null), row("2026-02", "closed", 1000, 0)]);
    expect(years[0].totalPayoutIncl).toBe(1000);
    expect(years[0].closedCount).toBe(2);
  });

  it("0 件なら空配列", () => {
    expect(summarizeYears([])).toEqual([]);
  });

  it("不正な月は無視する", () => {
    expect(summarizeYears([{ ...row("2026-01", "closed", 100), month: "こわれた" }])).toEqual([]);
  });
});

describe("ドライバーポータル：当月速報（parsePortalCurrent）", () => {
  it("RPC の JSON を数値へ直す（文字列の金額も扱える）", () => {
    const cur = parsePortalCurrent({
      month: "2026-09",
      status: "open",
      entry_count: "12",
      pay: "300000",
      royalty: "30000",
      mgmt_fee: "15000",
      adj_pay: "-5000",
      payout: "250000",
      tax: "25500",
      payout_incl: "275500",
      payout_date: "2026-10-31",
      updated_at: "2026-09-18T01:00:00Z",
    });
    expect(cur).toEqual({
      month: "2026-09",
      entryCount: 12,
      pay: 300000,
      royalty: 30000,
      mgmtFee: 15000,
      adjPay: -5000,
      payout: 250000,
      tax: 25500,
      payoutIncl: 275500,
      payoutDate: "2026-10-31",
      updatedAt: "2026-09-18T01:00:00Z",
    });
  });

  it("月初日で返ってきても稼動月に直す", () => {
    expect(parsePortalCurrent({ month: "2026-09-01", payout: 100 })?.month).toBe("2026-09");
  });

  it("null・オブジェクト以外・月が不正なら null", () => {
    expect(parsePortalCurrent(null)).toBeNull();
    expect(parsePortalCurrent("x")).toBeNull();
    expect(parsePortalCurrent([])).toBeNull();
    expect(parsePortalCurrent({})).toBeNull();
    expect(parsePortalCurrent({ month: "2026-13" })).toBeNull();
  });

  it("欠けている項目は 0、payout_incl が無ければ税抜の支払額を使う", () => {
    const cur = parsePortalCurrent({ month: "2026-09", payout: 1000 });
    expect(cur?.payoutIncl).toBe(1000);
    expect(cur?.pay).toBe(0);
    expect(cur?.royalty).toBe(0);
    expect(cur?.entryCount).toBe(0);
    expect(cur?.updatedAt).toBeNull();
  });

  it("振込予定日が不正な形なら null にする", () => {
    expect(parsePortalCurrent({ month: "2026-09", payout_date: "2026/10/31" })?.payoutDate).toBeNull();
    expect(parsePortalCurrent({ month: "2026-09", payout_date: null })?.payoutDate).toBeNull();
    expect(parsePortalCurrent({ month: "2026-09", payout_date: "2026-10-31" })?.payoutDate).toBe("2026-10-31");
  });
});
