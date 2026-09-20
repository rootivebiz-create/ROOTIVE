import { describe, expect, it } from "vitest";
import { addDays } from "@/components/cashflow/helpers";
import {
  executiveBrief,
  BRIEF_EMPTY_TEXT,
  BRIEF_MAX_LENGTH,
  type BriefForecast,
  type ExecutiveBriefInput,
} from "@/lib/executive/brief";
import type { CockpitResult } from "@/lib/executive/cockpit";
import { calcRunway, type RunwayResult } from "@/lib/executive/runway";
import { explainVariance, type VarianceItem } from "@/lib/executive/variance";
import type { CashEvent } from "@/lib/db/types";

/* ---------------------------------------------------------------- 道具 */

const DATE = "2026-09-20";
const COMPANY = "55555555-5555-4555-8555-555555555555";

/** 信号（既定は good で言うことなし） */
function cockpit(over: Partial<CockpitResult> = {}): CockpitResult {
  return {
    signal: "good",
    headline: "おおむね順調です",
    reasons: [],
    pendingApprovals: 0,
    overdueApprovals: 0,
    highAlerts: 0,
    companyTasks: 0,
    runwayStatus: "safe",
    holdDays: 90,
    operatingProfit: 1_300_000,
    profitTarget: 1_000_000,
    profitAchievement: 1.3,
    ...over,
  };
}

const payout = (day: number, amount: number): CashEvent => ({
  event_date: addDays(DATE, day),
  kind: "payout",
  label: "相曽慧",
  detail: "2026年09月の支払",
  amount: -Math.abs(amount),
  ref_id: COMPANY,
  status: "planned",
  month: "2026-09-01",
});

/** 余裕のある資金（safe） */
const safeRunway = (): RunwayResult => calcRunway({ from: DATE, to: addDays(DATE, 90), openingBalance: 1_000_000, events: [] });
/** 10 日後に 50 万円足りなくなる資金 */
const shortRunway = (): RunwayResult =>
  calcRunway({ from: DATE, to: addDays(DATE, 90), openingBalance: 1_000_000, events: [payout(10, 1_500_000)] });

const forecast = (over: Partial<BriefForecast> = {}): BriefForecast => ({
  month: "2026-09",
  billForecast: 9_500_000,
  operatingProfitForecast: 450_000,
  profitTargetRate: 0.45,
  ...over,
});

/** 人数の差がいちばん大きい予実（受注単価 −20 万・人数 −30 万） */
function variance(): VarianceItem[] {
  return explainVariance(
    { bill: 10_000_000, operatingProfit: 1_000_000, expense: 2_000_000, driverCount: 10 },
    { bill: 9_000_000, margin: 2_200_000, profit: 2_500_000, expenseTotal: 2_100_000, operatingProfit: 400_000, activeDriverCount: 9 },
  );
}

function briefOf(over: Partial<ExecutiveBriefInput> = {}): string {
  return executiveBrief({ date: DATE, cockpit: cockpit(), ...over });
}

const bodyOf = (text: string): string => text.split("\n").slice(1).join("");

/* ---------------------------------------------------------------- 1 行目 */

describe("executiveBrief：1 行目", () => {
  it("日付と信号の一言を出す", () => {
    expect(briefOf().split("\n")[0]).toBe("9月20日 ― おおむね順調です");
  });

  it("基準日は引数で受け取る（今日に依存しない）", () => {
    expect(briefOf({ date: "2026-01-05" }).split("\n")[0]).toBe("1月5日 ― おおむね順調です");
    expect(briefOf({ date: "2026-12-31" }).split("\n")[0]).toBe("12月31日 ― おおむね順調です");
  });

  it("信号の一言をそのまま使う", () => {
    const text = briefOf({ cockpit: cockpit({ signal: "bad", headline: "決裁と資金繰りを見てください" }) });
    expect(text.split("\n")[0]).toBe("9月20日 ― 決裁と資金繰りを見てください");
  });
});

/* ---------------------------------------------------------------- 何も無いとき */

describe("executiveBrief：何も無いとき", () => {
  it("「今日は特にありません。」で終える", () => {
    expect(briefOf()).toBe(`9月20日 ― おおむね順調です\n${BRIEF_EMPTY_TEXT}`);
  });

  it("資金に余裕があるだけなら何も言わない", () => {
    expect(bodyOf(briefOf({ runway: safeRunway(), variance: [] }))).toBe(BRIEF_EMPTY_TEXT);
  });

  it("予実の差がすべて 0 なら触れない", () => {
    const zero = explainVariance(
      { bill: 10_000_000, operatingProfit: 1_000_000, expense: 2_000_000, driverCount: 10 },
      { bill: 10_000_000, margin: 2_800_000, profit: 3_000_000, expenseTotal: 2_000_000, operatingProfit: 1_000_000, activeDriverCount: 10 },
    );
    expect(bodyOf(briefOf({ variance: zero }))).toBe(BRIEF_EMPTY_TEXT);
  });
});

/* ---------------------------------------------------------------- 中身と順番 */

describe("executiveBrief：中身と順番", () => {
  it("決裁待ち → 現金 → 今月の着地 → いちばん大きい予実の差 の順に並べる", () => {
    const body = bodyOf(
      briefOf({
        cockpit: cockpit({ signal: "bad", headline: "決裁と資金繰りを見てください", pendingApprovals: 3, overdueApprovals: 1 }),
        runway: shortRunway(),
        forecast: forecast(),
        variance: variance(),
      }),
    );
    expect(body).toBe(
      "決裁待ちが 3 件、うち 1 件は期限切れです。" +
        "現金はあと 10 日で、9月30日に ¥500,000 足りなくなる見込みです。" +
        "2026年9月の着地は売上 ¥9,500,000・営業利益 ¥450,000（目標の 45.0%）の見込みです。" +
        "予実の差は人数がいちばん大きく、営業利益を ¥300,000 押し下げています。",
    );
  });

  it("決裁待ちが無くても期限切れがあれば書く", () => {
    const body = bodyOf(briefOf({ cockpit: cockpit({ pendingApprovals: 0, overdueApprovals: 2 }) }));
    expect(body).toBe("期限切れの決裁が 2 件あります。");
  });

  it("期限切れが無ければ件数だけ書く", () => {
    expect(bodyOf(briefOf({ cockpit: cockpit({ pendingApprovals: 2 }) }))).toBe("決裁待ちが 2 件です。");
  });

  it("現金に余裕があるときは触れない", () => {
    const body = bodyOf(briefOf({ runway: safeRunway(), forecast: forecast() }));
    expect(body.includes("現金")).toBe(false);
    expect(body.startsWith("2026年9月の着地")).toBe(true);
  });

  it("マイナスにならないが日数が足りないときは日数だけ書く", () => {
    const watch = calcRunway({ from: DATE, to: addDays(DATE, 45), openingBalance: 1_000_000, events: [payout(10, 100_000)] });
    expect(bodyOf(briefOf({ runway: watch }))).toBe("現金はあと 45 日です。");
  });

  it("目標が無い月は着地から達成率を外す", () => {
    const body = bodyOf(briefOf({ forecast: forecast({ profitTargetRate: null }) }));
    expect(body).toBe("2026年9月の着地は売上 ¥9,500,000・営業利益 ¥450,000の見込みです。");
  });

  it("予実の差が利益を押し上げているときは「押し上げています」と書く", () => {
    const up = explainVariance(
      { bill: 10_000_000, operatingProfit: 1_000_000, expense: 2_000_000, driverCount: 10 },
      { bill: 12_000_000, margin: 3_600_000, profit: 4_000_000, expenseTotal: 1_900_000, operatingProfit: 2_100_000, activeDriverCount: 12 },
    );
    expect(bodyOf(briefOf({ variance: up }))).toBe("予実の差は人数がいちばん大きく、営業利益を ¥600,000 押し上げています。");
  });
});

/* ---------------------------------------------------------------- 長さと折り返し */

describe("executiveBrief：長さと折り返し", () => {
  const full = () =>
    briefOf({
      cockpit: cockpit({ signal: "bad", headline: "決裁と資金繰りを見てください", pendingApprovals: 3, overdueApprovals: 1 }),
      runway: shortRunway(),
      forecast: forecast(),
      variance: variance(),
    });

  it("200 字程度に収まり、上限を超えない", () => {
    const text = full();
    expect([...text].length).toBeLessThanOrEqual(BRIEF_MAX_LENGTH);
    expect([...text].length).toBeGreaterThan(100);
  });

  it("文の途中では切らない（本文は必ず「。」で終わる）", () => {
    expect(bodyOf(full()).endsWith("。")).toBe(true);
  });

  it("幅を渡すと LINE 用に折り返す", () => {
    const wrapped = executiveBrief({
      date: DATE,
      cockpit: cockpit({ signal: "bad", headline: "決裁と資金繰りを見てください", pendingApprovals: 3, overdueApprovals: 1 }),
      runway: shortRunway(),
      forecast: forecast(),
      variance: variance(),
      width: 40,
    });
    expect(wrapped.split("\n").length).toBeGreaterThan(2);
    // 折り返しても中身は変わらない
    expect(wrapped.replace(/\n/g, "")).toBe(full().replace(/\n/g, ""));
  });

  it("幅を渡さなければ折り返さない（1 行目＋本文の 2 行）", () => {
    expect(full().split("\n")).toHaveLength(2);
  });
});
