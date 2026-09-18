import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { forecastMonth, forecastReliability, type ForecastActual } from "@/lib/calc";

/**
 * 今月の着地見込み（lib/calc/forecast.ts）
 * 2026-09 は 30 日なので、18 日時点の経過率はちょうど 0.6、6 日時点はちょうど 0.2。
 */

/** 日本時間の日付から Date を作る（JST は UTC+9） */
function jst(dateTime: string): Date {
  return new Date(`${dateTime}+09:00`);
}

/** 実績の雛形（税抜。経過率 0.6 のとき売上見込み ¥2,000,000 になるように置いた値） */
function actual(over: Partial<ForecastActual> = {}): ForecastActual {
  return {
    bill: 1_200_000,
    payout: 570_000,
    profit: 330_000,
    mgmtFee: 30_000,
    expenseTotal: 160_000,
    expenseFixed: 100_000,
    expenseVariable: 60_000,
    operatingProfit: 170_000,
    entryCount: 5,
    billTarget: 0,
    profitTarget: 0,
    ...over,
  };
}

describe("今月の着地見込み（forecastMonth）", () => {
  it("月初（1 日）は経過率 1/30、按分で大きな見込みになり参考値（low）", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-01T09:00:00"), actual: actual({ bill: 40_000, payout: 19_000, profit: 11_000, expenseVariable: 2_000, expenseTotal: 102_000, operatingProfit: -91_000 }) });
    assert.equal(f.days, 30);
    assert.equal(f.elapsedDays, 1);
    assert.equal(f.progress, 1 / 30);
    assert.equal(f.basis, "prorated");
    assert.equal(f.reliability, "low");
    assert.equal(f.asOfDate, "2026-09-01");
    assert.equal(f.billForecast, 1_200_000);
    // 会社利益：(11,000 − 30,000) ÷ (1/30) + 30,000 = −570,000 + 30,000
    assert.equal(f.profitForecast, -540_000);
  });

  it("月中（18 日）は経過率 0.6 で按分し、売上・利益・支払の見込みを返す", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:34:00"), actual: actual() });
    assert.equal(f.elapsedDays, 18);
    assert.equal(f.progress, 0.6);
    assert.equal(f.basis, "prorated");
    assert.equal(f.billForecast, 2_000_000);
    // 会社利益：(330,000 − 30,000) ÷ 0.6 + 30,000
    assert.equal(f.profitForecast, 530_000);
    // 支払：(570,000 + 30,000) ÷ 0.6 − 30,000
    assert.equal(f.payoutForecast, 970_000);
    // 実績はそのまま持ち回る
    assert.equal(f.bill, 1_200_000);
    assert.equal(f.operatingProfit, 170_000);
  });

  it("月末（30 日）は経過率 1 で、見込みは実績と一致する", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-30T23:30:00"), actual: actual() });
    assert.equal(f.elapsedDays, 30);
    assert.equal(f.progress, 1);
    assert.equal(f.basis, "prorated");
    assert.equal(f.billForecast, 1_200_000);
    assert.equal(f.profitForecast, 330_000);
    assert.equal(f.payoutForecast, 570_000);
    assert.equal(f.operatingProfitForecast, 170_000);
    assert.equal(f.reliability, "high");
  });

  it("過去月は予測せず実績をそのまま返す（progress 1・basis actual）", () => {
    const f = forecastMonth({ month: "2026-08", now: jst("2026-09-18T12:00:00"), actual: actual() });
    assert.equal(f.progress, 1);
    assert.equal(f.basis, "actual");
    assert.equal(f.reliability, "high");
    assert.equal(f.asOfDate, null);
    assert.equal(f.billForecast, 1_200_000);
    assert.equal(f.operatingProfitForecast, 170_000);
    assert.equal(f.expenseForecast, 160_000);
  });

  it("未来月は経過率 0・basis none で、見込みは実績のまま", () => {
    const f = forecastMonth({ month: "2026-10", now: jst("2026-09-18T12:00:00"), actual: actual({ bill: 0, payout: 0, profit: 0, mgmtFee: 0, expenseTotal: 0, expenseFixed: 0, expenseVariable: 0, operatingProfit: 0, entryCount: 0 }) });
    assert.equal(f.elapsedDays, 0);
    assert.equal(f.progress, 0);
    assert.equal(f.basis, "none");
    assert.equal(f.asOfDate, null);
    assert.equal(f.billForecast, 0);
    assert.equal(f.operatingProfitForecast, 0);
  });

  it("締め済みの当月は予測せず実績をそのまま返す（basis actual）", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), isClosed: true, actual: actual() });
    assert.equal(f.basis, "actual");
    assert.equal(f.reliability, "high");
    assert.equal(f.billForecast, 1_200_000);
    assert.equal(f.payoutForecast, 570_000);
    assert.equal(f.operatingProfitForecast, 170_000);
    // 経過率は暦どおり（画面の「○% 経過」表示に使う）
    assert.equal(f.progress, 0.6);
  });

  it("稼働が 1 件も無い月は予測できない（basis none、按分しない）", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual({ bill: 0, payout: 0, profit: 0, mgmtFee: 0, entryCount: 0, expenseTotal: 100_000, expenseFixed: 100_000, expenseVariable: 0, operatingProfit: -100_000 }) });
    assert.equal(f.basis, "none");
    assert.equal(f.billForecast, 0);
    assert.equal(f.expenseForecast, 100_000);
    assert.equal(f.operatingProfitForecast, -100_000);
  });

  it("固定費は按分せず、変動費だけ按分する", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual() });
    // 固定費 100,000（そのまま） + 変動費 60,000 ÷ 0.6
    assert.equal(f.expenseForecast, 200_000);
  });

  it("管理費は按分しない（会社利益・支払の見込みに影響する）", () => {
    const withFee = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual() });
    const noFee = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual({ mgmtFee: 0 }) });
    // 管理費 30,000 を按分していれば利益見込みは 330,000 ÷ 0.6 = 550,000 になるが、按分しないので 530,000
    assert.equal(withFee.profitForecast, 530_000);
    assert.equal(noFee.profitForecast, 550_000);
    assert.equal(noFee.payoutForecast, 950_000);
    assert.equal(withFee.payoutForecast, 970_000);
  });

  it("営業利益の見込み ＝ 会社利益の見込み − 経費の見込み", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual() });
    assert.equal(f.operatingProfitForecast, f.profitForecast - f.expenseForecast);
    assert.equal(f.operatingProfitForecast, 330_000);
  });

  it("目標がある月は見込みベースの達成率を返す（未設定は null）", () => {
    const f = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual({ billTarget: 2_500_000, profitTarget: 300_000 }) });
    // 売上見込み 2,000,000 ÷ 目標 2,500,000、営業利益見込み 330,000 ÷ 目標 300,000
    assert.equal(f.billTargetRate, 0.8);
    assert.equal(f.profitTargetRate, 1.1);
    const none = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual() });
    assert.equal(none.billTargetRate, null);
    assert.equal(none.profitTargetRate, null);
  });

  it("確からしさの境界：0.2 未満は low、0.2 ちょうどは medium", () => {
    const low = forecastMonth({ month: "2026-09", now: jst("2026-09-05T12:00:00"), actual: actual() });
    assert.equal(low.progress, 5 / 30);
    assert.equal(low.reliability, "low");
    const medium = forecastMonth({ month: "2026-09", now: jst("2026-09-06T12:00:00"), actual: actual() });
    assert.equal(medium.progress, 0.2);
    assert.equal(medium.reliability, "medium");
  });

  it("確からしさの境界：0.6 ちょうどは high、その手前は medium", () => {
    const medium = forecastMonth({ month: "2026-09", now: jst("2026-09-17T12:00:00"), actual: actual() });
    assert.equal(medium.reliability, "medium");
    const high = forecastMonth({ month: "2026-09", now: jst("2026-09-18T12:00:00"), actual: actual() });
    assert.equal(high.progress, 0.6);
    assert.equal(high.reliability, "high");
    assert.equal(forecastReliability(0.199), "low");
    assert.equal(forecastReliability(0.2), "medium");
    assert.equal(forecastReliability(0.599), "medium");
    assert.equal(forecastReliability(0.6), "high");
  });

  it("日本時間で判定する（UTC の 9/17 15:00 は JST の 9/18）", () => {
    const utcEvening = forecastMonth({ month: "2026-09", now: new Date("2026-09-17T15:00:00Z"), actual: actual() });
    assert.equal(utcEvening.elapsedDays, 18);
    assert.equal(utcEvening.asOfDate, "2026-09-18");
    const justBefore = forecastMonth({ month: "2026-09", now: new Date("2026-09-17T14:59:00Z"), actual: actual() });
    assert.equal(justBefore.elapsedDays, 17);
    assert.equal(justBefore.asOfDate, "2026-09-17");
    // 月末 23:30 JST（UTC では翌月 1 日）でも当月扱い
    const monthEnd = forecastMonth({ month: "2026-09", now: new Date("2026-09-30T14:30:00Z"), actual: actual() });
    assert.equal(monthEnd.elapsedDays, 30);
    assert.equal(monthEnd.progress, 1);
  });

  it("2 月（28 日）など月の日数が違っても経過率は月の日数で割る", () => {
    const f = forecastMonth({ month: "2026-02", now: jst("2026-02-14T10:00:00"), actual: actual() });
    assert.equal(f.days, 28);
    assert.equal(f.elapsedDays, 14);
    assert.equal(f.progress, 0.5);
    assert.equal(f.billForecast, 2_400_000);
  });
});
