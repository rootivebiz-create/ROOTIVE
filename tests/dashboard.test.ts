import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { extractFindings, normalizeFindings } from "@/lib/ai/findings";
import { buildDashboardWarnings, buildTrend } from "@/lib/db/queries-dashboard";
import { kpiDelta } from "@/components/dashboard/kpi-cards";
import { compactYen } from "@/components/dashboard/profit-trend-chart";
import type { RateDiff } from "@/lib/db/types";

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
