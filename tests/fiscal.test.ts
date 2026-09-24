import { describe, expect, it } from "vitest";
import {
  fiscalPeriod,
  fiscalPeriodOfMonth,
  fiscalSettingsOf,
  isBeforeEstablishment,
  normalizeFiscalMonth,
  parsePeriodYear,
  periodDateRange,
  periodEndYearOf,
  periodOptions,
  periodTitle,
  summarizePeriod,
} from "@/lib/fiscal";
import { yenCompact } from "@/lib/format";
import { planRangeLabel, planYearLabel, planYearOptions } from "@/components/executive/helpers";

/** 期（事業年度。0030）：決算月で区切り、設立日から第N期と数える */
describe("期の区切り（決算月）", () => {
  it("9 月決算：10月〜翌9月 が 1 つの期。期は決算の年で表す", () => {
    expect(periodEndYearOf("2026-09", 9)).toBe(2026);
    expect(periodEndYearOf("2026-10", 9)).toBe(2027);
    expect(periodEndYearOf("2026-01", 9)).toBe(2026);
    const p = fiscalPeriodOfMonth("2026-03", { fiscalMonth: 9, establishedOn: null });
    expect(p.startMonth).toBe("2025-10");
    expect(p.endMonth).toBe("2026-09");
    expect(p.months).toHaveLength(12);
    expect(p.rangeLabel).toBe("2025年10月〜2026年9月");
  });

  it("12 月決算は暦年と同じ、3 月決算は 4月〜翌3月", () => {
    const dec = fiscalPeriodOfMonth("2026-05", { fiscalMonth: 12, establishedOn: null });
    expect([dec.startMonth, dec.endMonth]).toEqual(["2026-01", "2026-12"]);
    const mar = fiscalPeriodOfMonth("2026-05", { fiscalMonth: 3, establishedOn: null });
    expect([mar.startMonth, mar.endMonth]).toEqual(["2026-04", "2027-03"]);
  });

  it("設立日が無ければ「2026年9月期」と呼ぶ", () => {
    const p = fiscalPeriod(2026, { fiscalMonth: 9, establishedOn: null });
    expect(p.number).toBeNull();
    expect(p.label).toBe("2026年9月期");
    expect(periodTitle(p)).toBe("2026年9月期（2025年10月〜2026年9月）");
  });

  it("決算月が読めないときは 3 月", () => {
    expect(normalizeFiscalMonth(null)).toBe(3);
    expect(normalizeFiscalMonth(13)).toBe(3);
    expect(normalizeFiscalMonth("9")).toBe(9);
  });
});

describe("第N期（設立日から数える）", () => {
  const settings = { fiscalMonth: 9, establishedOn: "2024-04-15" };

  it("第1期は設立の月から最初の決算月まで（12 か月より短いことがある）", () => {
    const p1 = fiscalPeriodOfMonth("2024-06", settings);
    expect(p1.number).toBe(1);
    expect(p1.label).toBe("第1期");
    expect(p1.startMonth).toBe("2024-04");
    expect(p1.months).toEqual(["2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09"]);
  });

  it("以後は 12 か月ずつ", () => {
    const p3 = fiscalPeriodOfMonth("2026-09", settings);
    expect(p3.number).toBe(3);
    expect(periodTitle(p3)).toBe("第3期（2025年10月〜2026年9月）");
    expect(fiscalPeriodOfMonth("2026-10", settings).label).toBe("第4期");
  });

  it("決算月の翌月に設立したら第1期は 12 か月", () => {
    const p = fiscalPeriodOfMonth("2025-01", { fiscalMonth: 9, establishedOn: "2024-10-01" });
    expect(p.number).toBe(1);
    expect(p.months).toHaveLength(12);
  });

  it("期の最初の日と最後の日（第1期は設立の月の 1 日から）", () => {
    expect(periodDateRange(fiscalPeriod(2026, settings))).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(periodDateRange(fiscalPeriod(2024, settings))).toEqual({ from: "2024-04-01", to: "2024-09-30" });
    expect(periodDateRange(fiscalPeriod(2028, { fiscalMonth: 2, establishedOn: null }))).toEqual({ from: "2027-03-01", to: "2028-02-29" });
  });

  it("設立前の期は番号を付けない", () => {
    const before = fiscalPeriod(2023, settings);
    expect(before.number).toBeNull();
    expect(before.label).toBe("2023年9月期");
    expect(isBeforeEstablishment(before, settings)).toBe(true);
    expect(isBeforeEstablishment(fiscalPeriod(2023, { fiscalMonth: 9, establishedOn: null }), { fiscalMonth: 9, establishedOn: null })).toBe(false);
  });

  it("companies の行から設定を作る", () => {
    expect(fiscalSettingsOf({ fiscal_month: 9, established_on: "2024-04-15" })).toEqual({ fiscalMonth: 9, establishedOn: "2024-04-15" });
    expect(fiscalSettingsOf({ fiscal_month: "12", established_on: "" })).toEqual({ fiscalMonth: 12, establishedOn: null });
    expect(fiscalSettingsOf(null)).toEqual({ fiscalMonth: 3, establishedOn: null });
  });
});

describe("選べる期", () => {
  it("データのある月・今月を含む期と、その間を新しい順に", () => {
    const opts = periodOptions(["2025-02-01", "2026-09-01"], { fiscalMonth: 9, establishedOn: null }, ["2026-11"]);
    expect(opts.map((p) => p.endYear)).toEqual([2027, 2026, 2025]);
  });

  it("設立前の期は、データが無ければ出さない", () => {
    const settings = { fiscalMonth: 9, establishedOn: "2024-04-15" };
    expect(periodOptions(["2024-05", "2026-09"], settings).map((p) => p.label)).toEqual(["第3期", "第2期", "第1期"]);
  });

  it("?fy= は西暦 4 桁だけ", () => {
    expect(parsePeriodYear("2026")).toBe(2026);
    expect(parsePeriodYear(["2025"])).toBe(2025);
    expect(parsePeriodYear("26")).toBeNull();
    expect(parsePeriodYear(undefined)).toBeNull();
  });
});

describe("月の切り替えの表", () => {
  it("期のまとめは、その期の月だけを数える", () => {
    const p = fiscalPeriod(2026, { fiscalMonth: 9, establishedOn: null });
    const s = summarizePeriod(p, [
      { month: "2025-09", status: "closed", bill: 999, entry_count: 3 },
      { month: "2025-10", status: "closed", bill: 1_000_000, entry_count: 10 },
      { month: "2026-09", status: "open", bill: 500_000, entry_count: 8 },
      { month: "2026-10", status: "open", bill: 1, entry_count: 1 },
    ]);
    expect(s).toEqual({ bill: 1_500_000, closed: 1, withData: 2, total: 12 });
  });

  it("小さな場所の金額は万・億でまとめる", () => {
    expect(yenCompact(2_559_573)).toBe("255万");
    expect(yenCompact(123_456_789)).toBe("1.2億");
    expect(yenCompact(100_000_000)).toBe("1億");
    expect(yenCompact(9_999)).toBe("¥9,999");
    expect(yenCompact(-50_000)).toBe("-5万");
    expect(yenCompact(null)).toBe("¥0");
  });
});

describe("中期計画の期（0031）", () => {
  const settings = { fiscalMonth: 9, establishedOn: "2024-04-15" };

  it("計画の年は期の決算の年として見出しを付ける", () => {
    expect(planYearLabel(2026, settings)).toEqual({ label: "第3期", range: "2025年10月〜2026年9月" });
    expect(planYearLabel(2024, settings)).toEqual({ label: "第1期", range: "2024年4月〜2024年9月" });
    // 設立日が無ければ「2026年9月期」、12 月決算は暦年と同じなので「2026年」
    expect(planYearLabel(2026, { fiscalMonth: 9, establishedOn: null }).label).toBe("2026年9月期");
    expect(planYearLabel(2026, { fiscalMonth: 12, establishedOn: null })).toEqual({ label: "2026年", range: "2026年1月〜2026年12月" });
  });

  it("計画の期間は最初の期の始まりから最後の期の決算月まで", () => {
    expect(planRangeLabel(2026, 2028, settings)).toEqual({ label: "第3期〜第5期", range: "2025年10月〜2028年9月" });
    expect(planRangeLabel(2026, 2026, settings).label).toBe("第3期");
  });

  it("選べる期は今期の 3 期前〜10 期先と、いま入っている期（古い順）", () => {
    const opts = planYearOptions(2026, settings, [2020]);
    expect(opts[0]).toEqual({ value: 2020, label: "2020年9月期（2019年10月〜2020年9月）" });
    expect(opts.find((o) => o.value === 2026)?.label).toBe("第3期（2025年10月〜2026年9月）");
    expect(opts[opts.length - 1].value).toBe(2036);
  });
});
