import { describe, expect, it } from "vitest";
import { addDays } from "@/components/cashflow/helpers";
import {
  calcCockpit,
  COCKPIT_PROFIT_WARN_RATE,
  MAX_COCKPIT_REASONS,
  type CockpitInput,
} from "@/lib/executive/cockpit";
import { calcRunway, type RunwayResult } from "@/lib/executive/runway";
import type { CashEvent, ExecutiveSummary, MonthPl } from "@/lib/db/types";

/* ---------------------------------------------------------------- 道具 */

const COMPANY = "55555555-5555-4555-8555-555555555555";
const FROM = "2026-09-20";

/** v_executive_summary の 1 行（既定はすべて 0＝問題なし） */
function summary(over: Partial<ExecutiveSummary> = {}): ExecutiveSummary {
  return {
    company_id: COMPANY,
    pending_approvals: 0,
    overdue_approvals: 0,
    oldest_pending_at: null,
    open_decisions: 0,
    due_reviews: 0,
    expiring_insurance: 0,
    expiring_officers: 0,
    guarantee_total: 0,
    loan_balance: 0,
    high_alerts: 0,
    officer_count: 1,
    shares_total: 100,
    has_profile: true,
    active_plans: 0,
    active_delegations: 0,
    exports_30d: 0,
    sensitive_exports_30d: 0,
    bank_account_count: 1,
    ...over,
  };
}

/** v_month_pl の 1 行（既定は目標どおりの黒字） */
function pl(over: Partial<MonthPl> = {}): MonthPl {
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    driver_count: 10,
    active_driver_count: 10,
    entry_count: 40,
    bill: 10_000_000,
    pay: 7_000_000,
    margin: 3_000_000,
    royalty: 200_000,
    mgmt_fee: 100_000,
    adj_pay: 0,
    adj_profit: 0,
    payout: 6_800_000,
    tax: 680_000,
    payout_incl: 7_480_000,
    profit: 3_300_000,
    expense_total: 2_000_000,
    expense_fixed: 1_500_000,
    expense_variable: 500_000,
    expense_count: 12,
    operating_profit: 1_300_000,
    operating_margin: 0.13,
    bill_target: 10_000_000,
    profit_target: 1_000_000,
    target_memo: null,
    status: "open",
    ...over,
  };
}

/** 資金の見込み（既定は 90 日もつ＝safe） */
function runwayOf(days = 90, events: CashEvent[] = []): RunwayResult {
  return calcRunway({ from: FROM, to: addDays(FROM, days), openingBalance: 1_000_000, events });
}

function cockpitOf(over: Partial<CockpitInput> = {}) {
  return calcCockpit({ summary: summary(), pl: pl(), runway: runwayOf(), ...over });
}

/* ---------------------------------------------------------------- good */

describe("calcCockpit：good", () => {
  it("どれにも当てはまらなければ good で理由は無い", () => {
    const c = cockpitOf();
    expect(c.signal).toBe("good");
    expect(c.headline).toBe("おおむね順調です");
    expect(c.reasons).toEqual([]);
  });

  it("入力が無くても落ちない（資金の見込みが無い月は good）", () => {
    const c = calcCockpit({ summary: null, pl: null, runway: null });
    expect(c.signal).toBe("good");
    expect(c.runwayStatus).toBeNull();
    expect(c.holdDays).toBeNull();
    expect(c.profitAchievement).toBeNull();
  });
});

/* ---------------------------------------------------------------- bad */

describe("calcCockpit：bad（すぐ手を打つ）", () => {
  it("現金が danger なら bad", () => {
    const c = cockpitOf({ runway: runwayOf(20) });
    expect(c.signal).toBe("bad");
    expect(c.reasons).toContain("資金の見込みが 20 日先までしかありません。");
  });

  it("残高がマイナスになる見込みなら bad（不足額も出す）", () => {
    const events: CashEvent[] = [
      { event_date: addDays(FROM, 10), kind: "payout", label: "相曽慧", detail: "9 月の支払", amount: -1_500_000, ref_id: COMPANY, status: "planned", month: "2026-09-01" },
    ];
    const c = cockpitOf({ runway: runwayOf(120, events) });
    expect(c.signal).toBe("bad");
    expect(c.reasons).toContain("現金があと 10 日です（不足 ¥500,000）。");
  });

  it("未対応の重大なお知らせが 1 件で bad", () => {
    const c = cockpitOf({ summary: summary({ high_alerts: 1 }) });
    expect(c.signal).toBe("bad");
    expect(c.reasons).toContain("未対応の重大なお知らせが 1 件あります。");
  });

  it("期限切れの決裁が 1 件で bad", () => {
    const c = cockpitOf({ summary: summary({ pending_approvals: 3, overdue_approvals: 1 }) });
    expect(c.signal).toBe("bad");
    expect(c.reasons[0]).toBe("決裁待ちが 3 件、うち 1 件は期限切れです。");
  });

  it("稼働のある月で営業利益がマイナスなら bad", () => {
    const c = cockpitOf({ pl: pl({ operating_profit: -200_000, entry_count: 40 }) });
    expect(c.signal).toBe("bad");
    expect(c.reasons).toContain("今月の営業利益が -¥200,000 です。");
  });

  it("稼働がまだ無い月は営業利益がマイナスでも bad にしない", () => {
    const c = cockpitOf({ pl: pl({ operating_profit: -200_000, entry_count: 0, profit_target: 0 }) });
    expect(c.signal).toBe("good");
  });
});

/* ---------------------------------------------------------------- warn */

describe("calcCockpit：warn（気にかける）", () => {
  it("現金が watch なら warn", () => {
    const c = cockpitOf({ runway: runwayOf(45) });
    expect(c.signal).toBe("warn");
    expect(c.reasons).toContain("現金があと 45 日です。");
  });

  it("決裁待ちが 1 件で warn", () => {
    const c = cockpitOf({ summary: summary({ pending_approvals: 2 }) });
    expect(c.signal).toBe("warn");
    expect(c.reasons).toContain("決裁待ちが 2 件です。");
  });

  it("期限の近い会社の手続きがあれば warn", () => {
    const c = cockpitOf({ summary: summary({ due_reviews: 1, expiring_insurance: 1, expiring_officers: 1 }) });
    expect(c.signal).toBe("warn");
    expect(c.companyTasks).toBe(3);
    expect(c.reasons).toContain("期限の近い会社の手続きが 3 件あります。");
  });

  it("営業利益が目標の 80% 未満で warn（80% ちょうどは good）", () => {
    const under = cockpitOf({ pl: pl({ operating_profit: 799_999, profit_target: 1_000_000 }) });
    expect(under.signal).toBe("warn");
    expect(under.reasons).toContain("営業利益が目標の 80.0% です。");

    const just = cockpitOf({ pl: pl({ operating_profit: 800_000, profit_target: 1_000_000 }) });
    expect(just.signal).toBe("good");
    expect(just.profitAchievement).toBe(COCKPIT_PROFIT_WARN_RATE);
  });

  it("営業利益の目標が無ければ達成率では判定しない", () => {
    const c = cockpitOf({ pl: pl({ operating_profit: 1, profit_target: 0 }) });
    expect(c.profitAchievement).toBeNull();
    expect(c.signal).toBe("good");
  });
});

/* ---------------------------------------------------------------- 理由と見出し */

describe("calcCockpit：理由と見出し", () => {
  it("理由は決裁 → 資金繰り → お知らせ → 利益 → 会社の手続き の順", () => {
    const c = calcCockpit({
      summary: summary({ pending_approvals: 3, overdue_approvals: 1, high_alerts: 2, due_reviews: 1 }),
      pl: pl({ operating_profit: 500_000, profit_target: 1_000_000 }),
      runway: runwayOf(45),
    });
    expect(c.reasons).toEqual([
      "決裁待ちが 3 件、うち 1 件は期限切れです。",
      "現金があと 45 日です。",
      "未対応の重大なお知らせが 2 件あります。",
      "営業利益が目標の 50.0% です。",
    ]);
  });

  it("理由は多くても 4 つ", () => {
    const c = calcCockpit({
      summary: summary({ pending_approvals: 1, high_alerts: 1, due_reviews: 5 }),
      pl: pl({ operating_profit: 100_000, profit_target: 1_000_000 }),
      runway: runwayOf(10),
    });
    expect(c.reasons).toHaveLength(MAX_COCKPIT_REASONS);
    expect(c.reasons.some((r) => r.includes("会社の手続き"))).toBe(false);
  });

  it("見出しは見るべきところを 2 つまで並べる", () => {
    const c = calcCockpit({ summary: summary({ pending_approvals: 3, overdue_approvals: 1 }), pl: pl(), runway: runwayOf(45) });
    expect(c.headline).toBe("決裁と資金繰りを見てください");
  });

  it("見るべきところが 1 つならそれだけを出す", () => {
    const c = cockpitOf({ summary: summary({ pending_approvals: 1 }) });
    expect(c.headline).toBe("決裁を見てください");
  });

  it("決裁待ちが 0 でも期限切れがあれば理由に出す", () => {
    const c = cockpitOf({ summary: summary({ pending_approvals: 0, overdue_approvals: 2 }) });
    expect(c.reasons).toContain("期限切れの決裁が 2 件あります。");
  });

  it("現金に余裕があるときは資金繰りに触れない", () => {
    const c = cockpitOf({ summary: summary({ pending_approvals: 1 }), runway: runwayOf(90) });
    expect(c.runwayStatus).toBe("safe");
    expect(c.reasons.some((r) => r.includes("現金"))).toBe(false);
  });
});

/* ---------------------------------------------------------------- 数字 */

describe("calcCockpit：判定に使った数字", () => {
  it("そのまま持ち出せる", () => {
    const c = calcCockpit({
      summary: summary({ pending_approvals: 3, overdue_approvals: 1, high_alerts: 2, due_reviews: 1, expiring_insurance: 2 }),
      pl: pl({ operating_profit: 500_000, profit_target: 1_000_000 }),
      runway: runwayOf(45),
    });
    expect(c.pendingApprovals).toBe(3);
    expect(c.overdueApprovals).toBe(1);
    expect(c.highAlerts).toBe(2);
    expect(c.companyTasks).toBe(3);
    expect(c.runwayStatus).toBe("watch");
    expect(c.holdDays).toBe(45);
    expect(c.operatingProfit).toBe(500_000);
    expect(c.profitTarget).toBe(1_000_000);
    expect(c.profitAchievement).toBe(0.5);
  });

  it("null の列は 0 として扱う", () => {
    const c = calcCockpit({ summary: summary({ pending_approvals: null, high_alerts: null }), pl: pl({ operating_profit: null, profit_target: null }), runway: null });
    expect(c.pendingApprovals).toBe(0);
    expect(c.highAlerts).toBe(0);
    expect(c.operatingProfit).toBe(0);
    expect(c.profitAchievement).toBeNull();
  });
});
