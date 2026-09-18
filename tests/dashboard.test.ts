import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { extractFindings, normalizeFindings } from "@/lib/ai/findings";
import { buildDashboardWarnings, buildTrend } from "@/lib/db/queries-dashboard";
import { kpiDelta } from "@/components/dashboard/kpi-cards";
import { compactYen } from "@/components/dashboard/profit-trend-chart";
import { expenseBreakdown, hasTarget, needsExpenseWarning, targetProgress } from "@/components/dashboard/helpers";
import type { ExpenseSummaryRow, RateDiff } from "@/lib/db/types";

describe("ダッシュボードの純関数（所見の正規化・推移・警告）", () => {
  it("所見の正規化・抽出、12 か月推移、警告判定が仕様どおり", () => {

    // --- findings ---
    assert.deepEqual(normalizeFindings(["a", " b ", ""]), [{ title: "a", detail: "" }, { title: "b", detail: "" }]);
    assert.deepEqual(normalizeFindings([{ title: "T", detail: "D" }, { detail: "only" }, { foo: 1 }]), [
      { title: "T", detail: "D" },
      { title: "only", detail: "" },
    ]);
    assert.deepEqual(normalizeFindings({ findings: ["x"] }), [{ title: "x", detail: "" }]);
    assert.deepEqual(normalizeFindings("nope"), []);
    assert.deepEqual(extractFindings('```json\n[{"title":"A","detail":"B"}]\n```'), [{ title: "A", detail: "B" }]);
    assert.deepEqual(extractFindings('以下が所見です。\n[{"title":"A","detail":"B"}]\n以上'), [{ title: "A", detail: "B" }]);
    assert.deepEqual(extractFindings("ただの文章"), [{ title: "分析結果", detail: "ただの文章" }]);
    assert.equal(extractFindings(JSON.stringify(["1", "2", "3", "4", "5", "6", "7"])).length, 5);
    assert.deepEqual(extractFindings(""), []);

    // --- trend ---
    const trend = buildTrend([{ month: "2026-09-01", bill: 100, profit: -5, payout: 90, profit_rate: -0.05 }, { month: "2025-12-01", bill: 10, profit: 1, payout: 9, profit_rate: 0.1 }], "2026-09");
    assert.equal(trend.length, 12);
    assert.equal(trend[0].month, "2025-10");
    assert.equal(trend[11].month, "2026-09");
    assert.equal(trend[11].isCurrent, true);
    assert.equal(trend[11].profit, -5);
    assert.equal(trend[2].month, "2025-12");
    assert.equal(trend[2].hasData, true);
    assert.equal(trend[3].hasData, false);
    assert.equal(trend[3].bill, 0);

    // --- warnings ---
    const rateDiff = (over: Partial<RateDiff> = {}): RateDiff => ({
      entry_id: "e1", driver_id: "d1", driver_name: "相曽慧", project_id: "p1", project_item_id: "i1", project_name: "三郷Amazon", item_name: "標準", qty: 21,
      bill_rate: 23025, pay_rate: 21780, royalty_rate: 0.1, rounding_mode: "none",
      master_bill_rate: 23025, master_pay_rate: 21780, master_royalty_rate: 0.1, master_rounding_mode: "none", ...over,
    });
    const driver = (over: Record<string, unknown>) => ({
      company_id: "c", month: "2026-09-01", driver_id: "d", driver_name: "D", driver_sort_order: 0, driver_is_active: true, driver_default_mgmt_fee: 15000, driver_month_id: "dm", memo: "",
      entry_count: 1, active_entry_count: 1, bill: 0, pay: 0, margin: 0, royalty: 0, mgmt_fee_setting: 15000, mgmt_fee: 15000, adjustment_count: 0, adj_pay: 0, adj_profit: 0, payout: 0, driver_profit: 0, is_closed: false, tax_mode: "taxable" as const, tax_rate: 0.1, tax_rounding: "floor" as const, tax_base: 0, tax: 0, payout_incl: 0, ...over,
    });
    const w = buildDashboardWarnings({
      month: "2026-09", isClosed: false, isFuture: false, entryCount: 3,
      entries: [
        { id: "e1", driver_id: "d1", driver_name: "相曽慧", project_name: "三郷Amazon", item_name: "標準", qty: 21, bill_rate: 23025, pay_rate: 21780 },
        { id: "e2", driver_id: "d2", driver_name: "X", project_name: "P", item_name: "標準", qty: 1, bill_rate: 100, pay_rate: 120 },
        { id: "e3", driver_id: "d9", driver_name: "川島幹太", project_name: "三郷Amazon", item_name: "標準", qty: 8, bill_rate: 23025, pay_rate: 0 },
        { id: "e4", driver_id: "d3", driver_name: "Z", project_name: "P", item_name: "標準", qty: 0, bill_rate: 100, pay_rate: 90 },
      ],
      drivers: [
        driver({ driver_id: "d1", driver_name: "相曽慧", mgmt_fee_setting: 14999, driver_default_mgmt_fee: 15000 }),
        driver({ driver_id: "d2", driver_name: "X" }),
        driver({ driver_id: "d9", driver_name: "川島幹太", mgmt_fee_setting: 0, driver_default_mgmt_fee: 0 }),
        driver({ driver_id: "d3", driver_name: "Z", active_entry_count: 0, mgmt_fee_setting: 1, driver_default_mgmt_fee: 2 }),
      ],
      activeDrivers: [{ id: "d1", name: "相曽慧" }, { id: "d2", name: "X" }, { id: "d3", name: "Z" }, { id: "d5", name: "高森豪介" }],
      openMonths: ["2026-08", "2026-07", "2026-09", "2026-10"],
      pastThreshold: "2026-09",
      rateDiffs: [
        rateDiff({ entry_id: "e1", driver_id: "d1", driver_name: "相曽慧", master_bill_rate: 23500, master_pay_rate: 21960 }),
        rateDiff({ entry_id: "e3", driver_id: "d9", driver_name: "川島幹太", pay_rate: 0, master_pay_rate: 21780, royalty_rate: 0, master_royalty_rate: 0.1, rounding_mode: "none", master_rounding_mode: "round" }),
      ],
    });
    assert.deepEqual(w.lossEntries.map((e) => e.id), ["e2"]); // 川島（支払 0）は該当しない
    assert.deepEqual(w.mgmtFeeMismatches.map((m) => [m.driverName, m.setting, m.defaultFee]), [["相曽慧", 14999, 15000]]); // Z は稼働ゼロなので除外
    assert.deepEqual(w.idleDrivers.map((d) => d.driverName), ["Z", "高森豪介"]);
    assert.deepEqual(w.zeroQtyEntries.map((e) => e.id), ["e4"]);
    assert.deepEqual(w.openPastMonths, ["2026-07", "2026-08"]);
    // 単価・率の差分：変わる項目だけが整形される（稼働入力の describeRateDiff と同じ文言）
    assert.deepEqual(w.rateDiffs, [
      { entryId: "e1", driverId: "d1", driverName: "相曽慧", projectName: "三郷Amazon", itemName: "標準", changes: ["受注 ¥23,025 → ¥23,500", "支払 ¥21,780 → ¥21,960"] },
      { entryId: "e3", driverId: "d9", driverName: "川島幹太", projectName: "三郷Amazon", itemName: "標準", changes: ["支払 ¥0 → ¥21,780", "ロイヤリティ率 0.0% → 10.0%", "端数処理 丸めない → 四捨五入"] },
    ]);

    // 未来月：稼働ゼロ・数量 0 は警告しない
    const wf = buildDashboardWarnings({ month: "2026-12", isClosed: false, isFuture: true, entryCount: 1, entries: [{ id: "e", driver_id: "d", driver_name: "D", project_name: "P", item_name: "標準", qty: 0, bill_rate: 1, pay_rate: 0 }], drivers: [], activeDrivers: [{ id: "d", name: "D" }], openMonths: [], pastThreshold: "2026-09", rateDiffs: [rateDiff({ master_bill_rate: 23500 })] });
    assert.equal(wf.idleDrivers.length, 0);
    assert.equal(wf.zeroQtyEntries.length, 0);
    assert.equal(wf.rateDiffs.length, 1); // 未来月でも単価の差分は出す
    // データが無い月：稼働ゼロ警告なし
    const we = buildDashboardWarnings({ month: "2026-09", isClosed: false, isFuture: false, entryCount: 0, entries: [], drivers: [], activeDrivers: [{ id: "d", name: "D" }], openMonths: [], pastThreshold: "2026-09", rateDiffs: [] });
    assert.equal(we.idleDrivers.length, 0);
    assert.deepEqual(we.rateDiffs, []);
    // 締め済み月：単価の差分は出ない（スナップショットが確定値）
    const wc = buildDashboardWarnings({ month: "2026-08", isClosed: true, isFuture: false, entryCount: 1, entries: [], drivers: [], activeDrivers: [], openMonths: [], pastThreshold: "2026-09", rateDiffs: [rateDiff({ master_bill_rate: 23500 })] });
    assert.deepEqual(wc.rateDiffs, []);

    // --- kpi delta ---
    assert.equal(kpiDelta("money", 100, null), null);
    assert.deepEqual(kpiDelta("money", 110, 100), { amount: "+¥10", ratio: "+10.0%", direction: 1 });
    assert.deepEqual(kpiDelta("money", 90, 100), { amount: "-¥10", ratio: "-10.0%", direction: -1 });
    assert.deepEqual(kpiDelta("money", 90, 0), { amount: "+¥90", ratio: "—", direction: 1 });
    assert.deepEqual(kpiDelta("rate", 0.25, 0.2), { amount: "+5.0pt", ratio: null, direction: 1 });
    assert.equal(kpiDelta("rate", 0.2, 0.25)?.amount, "-5.0pt");
    assert.equal(kpiDelta("rate", 0.2, 0.2)?.direction, 0);

    // --- compactYen ---
    assert.equal(compactYen(600000), "60万");
    assert.equal(compactYen(-125000), "-13万");
    assert.equal(compactYen(5000), "5000");
    assert.equal(compactYen(150000000), "1.5億");
    console.log("all dashboard checks passed");

  });
});

describe("月次目標の進捗と経費内訳の純関数", () => {
  const expense = (over: Partial<ExpenseSummaryRow> = {}): ExpenseSummaryRow => ({
    company_id: "c", month: "2026-09-01", category_id: "c1", category_name: "燃料費", kind: "variable", category_sort_order: 0,
    expense_count: 1, amount: 0, taxable_amount: 0, ...over,
  });

  it("達成率・残り金額・バーの幅", () => {
    // 目標未設定（0）は達成率 null
    assert.deepEqual(targetProgress(500000, 0), { target: 0, actual: 500000, rate: null, remaining: 0, achieved: false, barRatio: 0 });
    assert.equal(targetProgress(0, 0).rate, null);
    assert.equal(hasTarget(0, 0), false);
    assert.equal(hasTarget(0, 300000), true);
    assert.equal(hasTarget(2600000, 0), true);

    // 未達：残りは目標 − 実績、バーは達成率そのまま
    const p = targetProgress(1_300_000, 2_600_000);
    assert.equal(p.rate, 0.5);
    assert.equal(p.remaining, 1_300_000);
    assert.equal(p.achieved, false);
    assert.equal(p.barRatio, 0.5);

    // 小数の残り（金額は誤差なく引く）
    assert.equal(targetProgress(452490.3, 500000).remaining, 47509.7);

    // 達成：残り 0、バーは 100% で頭打ち
    const done = targetProgress(3_000_000, 2_600_000);
    assert.equal(done.achieved, true);
    assert.equal(done.remaining, 0);
    assert.equal(done.barRatio, 1);
    assert.ok(done.rate != null && done.rate > 1);
    assert.equal(targetProgress(2_600_000, 2_600_000).achieved, true);

    // 実績がマイナス（赤字）でもバーは 0 以上
    const loss = targetProgress(-100_000, 500_000);
    assert.equal(loss.barRatio, 0);
    assert.equal(loss.achieved, false);
    assert.equal(loss.remaining, 600_000);
  });

  it("経費内訳は上位 5 件 ＋ その他、合計はカテゴリの合計", () => {
    const rows = [
      expense({ category_id: "c1", category_name: "燃料費", amount: 60000 }),
      expense({ category_id: "c1", category_name: "燃料費", amount: 40000.5, expense_count: 2 }),
      expense({ category_id: "c2", category_name: "地代家賃", kind: "fixed", amount: 150000 }),
      expense({ category_id: "c3", category_name: "通信費", kind: "fixed", amount: 9500 }),
      expense({ category_id: "c4", category_name: "保険料", kind: "fixed", amount: 8000 }),
      expense({ category_id: "c5", category_name: "リース料", kind: "fixed", amount: 7000 }),
      expense({ category_id: "c6", category_name: "消耗品費", amount: 6000 }),
      expense({ category_id: "c7", category_name: "雑費", amount: 5000 }),
    ];
    const b = expenseBreakdown(rows);
    assert.deepEqual(b.rows.map((r) => r.categoryName), ["地代家賃", "燃料費", "通信費", "保険料", "リース料"]);
    assert.equal(b.rows[1].amount, 100000.5);
    assert.equal(b.rows[1].expenseCount, 3);
    assert.equal(b.othersCount, 2);
    assert.equal(b.othersAmount, 11000);
    assert.equal(b.total, 285500.5);
    assert.ok(Math.abs(b.rows[0].share - 150000 / 285500.5) < 1e-12);

    // 上位件数を変えられる／経費が無い月
    assert.equal(expenseBreakdown(rows, 2).rows.length, 2);
    assert.equal(expenseBreakdown(rows, 2).othersCount, 5);
    assert.deepEqual(expenseBreakdown([]), { rows: [], othersAmount: 0, othersCount: 0, total: 0 });
  });

  it("「経費が 1 件も登録されていません」は未締め月かつ稼働行があるときだけ", () => {
    assert.equal(needsExpenseWarning({ isClosed: false, entryCount: 12, expenseCount: 0 }), true);
    assert.equal(needsExpenseWarning({ isClosed: false, entryCount: 12, expenseCount: 3 }), false);
    assert.equal(needsExpenseWarning({ isClosed: true, entryCount: 12, expenseCount: 0 }), false);
    assert.equal(needsExpenseWarning({ isClosed: false, entryCount: 0, expenseCount: 0 }), false);
  });
});
