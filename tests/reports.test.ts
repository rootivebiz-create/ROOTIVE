import { describe, expect, it } from "vitest";
import {
  MONTH_STATUS_LABELS,
  availableYears,
  compareYears,
  driverRanking,
  expenseKindTotals,
  expenseRanking,
  hasReportData,
  monthsOfYear,
  parseYear,
  projectLabel,
  projectRanking,
  resolveReportYear,
  sumReport,
  toReportRows,
  yearDelta,
  yearOfMonth,
  yearRange,
} from "@/components/reports/helpers";
import { REPORT_CSV_HEADERS, reportCsvFilename, reportToCsvRow, toReportCsv, toReportCsvRows } from "@/lib/exports/report-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import type { DriverMonthSummary, ExpenseSummaryRow, MonthPl, ProjectSummary } from "@/lib/db/types";

const COMPANY = "00000000-0000-0000-0000-000000000001";

/** v_month_pl の 1 行（指定しない列は 0） */
function pl(month: string, over: Partial<MonthPl> = {}): MonthPl {
  return {
    company_id: COMPANY,
    month: `${month}-01`,
    driver_count: 0,
    active_driver_count: 0,
    entry_count: 0,
    bill: 0,
    pay: 0,
    margin: 0,
    royalty: 0,
    mgmt_fee: 0,
    adj_pay: 0,
    adj_profit: 0,
    payout: 0,
    tax: 0,
    payout_incl: 0,
    profit: 0,
    expense_total: 0,
    expense_fixed: 0,
    expense_variable: 0,
    expense_count: 0,
    operating_profit: 0,
    operating_margin: 0,
    bill_target: 0,
    profit_target: 0,
    target_memo: "",
    status: "open",
    ...over,
  };
}

function driverMonth(over: Partial<DriverMonthSummary> = {}): DriverMonthSummary {
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    driver_id: "d1",
    driver_name: "相曽慧",
    driver_sort_order: 0,
    driver_is_active: true,
    driver_default_mgmt_fee: 15000,
    driver_month_id: "dm",
    memo: "",
    entry_count: 1,
    active_entry_count: 1,
    bill: 0,
    pay: 0,
    margin: 0,
    royalty: 0,
    mgmt_fee_setting: 15000,
    mgmt_fee: 15000,
    adjustment_count: 0,
    adj_pay: 0,
    adj_profit: 0,
    payout: 0,
    driver_profit: 0,
    is_closed: false,
    tax_mode: "taxable",
    tax_rate: 0.1,
    tax_rounding: "floor",
    tax_base: 0,
    tax: 0,
    payout_incl: 0,
    ...over,
  };
}

function projectMonth(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    project_id: "p1",
    project_item_id: "i1",
    project_name: "三郷Amazon",
    client_name: "アマゾンジャパン",
    item_name: "標準",
    unit: "day",
    project_sort_order: 0,
    item_sort_order: 0,
    entry_count: 1,
    driver_count: 1,
    qty_total: 0,
    bill: 0,
    pay: 0,
    margin: 0,
    royalty: 0,
    entry_profit: 0,
    profit_rate: 0,
    ...over,
  };
}

function expenseRow(over: Partial<ExpenseSummaryRow> = {}): ExpenseSummaryRow {
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    category_id: "c1",
    category_name: "燃料費",
    kind: "variable",
    category_sort_order: 0,
    expense_count: 1,
    amount: 0,
    taxable_amount: 0,
    ...over,
  };
}

/** 2026 年：9 月と 10 月にデータ、10 月は締め済み */
const YEAR_2026: MonthPl[] = [
  pl("2026-09", {
    entry_count: 3,
    active_driver_count: 8,
    bill: 2559573,
    pay: 1907083,
    margin: 400000.5,
    royalty: 120000,
    mgmt_fee: 132489.8,
    adj_pay: -5000,
    adj_profit: 0,
    payout: 1700000,
    tax: 170000,
    payout_incl: 1870000,
    profit: 652490.3,
    expense_total: 200000.3,
    expense_fixed: 150000,
    expense_variable: 50000.3,
    expense_count: 4,
    operating_profit: 452490,
    operating_margin: 0.176788,
    bill_target: 2600000,
    profit_target: 500000,
    target_memo: "新案件込み",
  }),
  pl("2026-10", {
    entry_count: 2,
    active_driver_count: 9,
    bill: 1000000,
    pay: 800000,
    margin: 150000,
    royalty: 50000,
    mgmt_fee: 30000,
    payout: 700000,
    tax: 70000,
    payout_incl: 770000,
    profit: 230000,
    expense_total: 100000,
    expense_fixed: 80000,
    expense_variable: 20000,
    expense_count: 2,
    operating_profit: 130000,
    operating_margin: 0.13,
    status: "closed",
  }),
];

describe("年の解決と選択肢", () => {
  it("?y= は西暦 4 桁のみ受け付け、無ければ稼動月の年になる", () => {
    expect(parseYear("2026")).toBe(2026);
    expect(parseYear(["2025"])).toBe(2025);
    expect(parseYear("26")).toBeNull();
    expect(parseYear("1999")).toBeNull();
    expect(parseYear(undefined)).toBeNull();
    expect(resolveReportYear("2024", "2026-09")).toBe(2024);
    expect(resolveReportYear(undefined, "2026-09")).toBe(2026);
    expect(resolveReportYear("abcd", "2025-01")).toBe(2025);
    expect(yearOfMonth("2026-09")).toBe(2026);
  });

  it("年の範囲と 12 か月、年セレクタの選択肢（降順・重複なし）", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01", to: "2026-12" });
    expect(monthsOfYear(2026)).toHaveLength(12);
    expect(monthsOfYear(2026)[0]).toBe("2026-01");
    expect(monthsOfYear(2026)[11]).toBe("2026-12");
    expect(availableYears(["2026-09-01", "2025-12-01", "2026-01-01", null], [2026, 2027])).toEqual([2027, 2026, 2025]);
    expect(availableYears([], [2026])).toEqual([2026]);
  });
});

describe("月次推移と年間合計", () => {
  it("12 か月に 0 埋めし、データのある月だけ hasData になる", () => {
    const rows = toReportRows(YEAR_2026, 2026);
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe("2026-01");
    expect(rows[0].hasData).toBe(false);
    expect(rows[0].bill).toBe(0);
    expect(rows[0].status).toBe("open");
    expect(rows[8].month).toBe("2026-09");
    expect(rows[8].hasData).toBe(true);
    expect(rows[8].bill).toBe(2559573);
    expect(rows[8].billTarget).toBe(2600000);
    expect(rows[9].status).toBe("closed");
    // 別の年の行は混ざらない
    expect(toReportRows([...YEAR_2026, pl("2025-09", { bill: 999 })], 2026).every((r) => r.month.startsWith("2026"))).toBe(true);
  });

  it("年間合計は月の値の単純合計、営業利益率は合計どうしの比", () => {
    const t = sumReport(toReportRows(YEAR_2026, 2026));
    expect(t.bill).toBe(3559573);
    expect(t.profit).toBe(882490.3);
    expect(t.expenseTotal).toBe(300000.3);
    expect(t.expenseFixed).toBe(230000);
    expect(t.expenseVariable).toBe(70000.3);
    expect(t.operatingProfit).toBe(582490);
    expect(t.operatingMargin).toBeCloseTo(582490 / 3559573, 10);
    expect(t.payout).toBe(2400000);
    expect(t.payoutIncl).toBe(2640000);
    expect(t.tax).toBe(240000);
    expect(t.entryCount).toBe(5);
    expect(t.expenseCount).toBe(6);
    expect(t.peakActiveDriverCount).toBe(9);
    expect(t.dataMonthCount).toBe(2);
    expect(t.billTarget).toBe(2600000);
  });

  it("売上 0 の年は営業利益率 0、データの有無を判定できる", () => {
    const empty = toReportRows([], 2020);
    expect(hasReportData(empty)).toBe(false);
    expect(sumReport(empty).operatingMargin).toBe(0);
    // 目標だけ登録された月でも「データあり」とみなす
    expect(hasReportData(toReportRows([pl("2026-03", { bill_target: 100000 })], 2026))).toBe(true);
    // 経費だけの月も「データあり」
    expect(hasReportData(toReportRows([pl("2026-04", { expense_count: 1, expense_total: 5000, operating_profit: -5000 })], 2026))).toBe(true);
  });
});

describe("前年比", () => {
  it("増減額と増減率（前年 0 なら増減率は null、前年マイナスでも符号は増減額に合わせる）", () => {
    expect(yearDelta(110, 100)).toEqual({ diff: 10, ratio: 0.1 });
    expect(yearDelta(90, 100)).toEqual({ diff: -10, ratio: -0.1 });
    expect(yearDelta(50, 0)).toEqual({ diff: 50, ratio: null });
    expect(yearDelta(100, -50)).toEqual({ diff: 150, ratio: 3 });
    expect(yearDelta(0.3, 0.1).diff).toBeCloseTo(0.2, 10);
  });

  it("前年データが無ければ null、あれば 4 指標を比較する", () => {
    const current = sumReport(toReportRows(YEAR_2026, 2026));
    const previous = sumReport(toReportRows([pl("2025-09", { bill: 1000000, profit: 300000, expense_total: 100000, operating_profit: 200000, entry_count: 1 })], 2025));
    expect(compareYears(current, null, 2025)).toBeNull();
    const cmp = compareYears(current, previous, 2025);
    expect(cmp?.previousYear).toBe(2025);
    expect(cmp?.bill.diff).toBe(2559573);
    expect(cmp?.bill.ratio).toBeCloseTo(2.559573, 10);
    expect(cmp?.profit.diff).toBe(582490.3);
    expect(cmp?.expenseTotal.diff).toBe(200000.3);
    expect(cmp?.operatingProfit.diff).toBe(382490);
  });
});

describe("ランキング", () => {
  it("ドライバー別：月をまたいで合計し、会社利益の降順（同額は売上の降順 → 名前順）", () => {
    const rows = driverRanking([
      driverMonth({ driver_id: "d1", driver_name: "相曽慧", month: "2026-09-01", bill: 483525, driver_profit: 50000, payout: 400000, payout_incl: 440000, entry_count: 2 }),
      driverMonth({ driver_id: "d1", driver_name: "相曽慧", month: "2026-10-01", bill: 500000, driver_profit: 60000.5, payout: 410000, payout_incl: 451000, entry_count: 1 }),
      driverMonth({ driver_id: "d2", driver_name: "金島幸太", bill: 300000, driver_profit: 200000, payout: 100000, payout_incl: 110000, entry_count: 1 }),
      driverMonth({ driver_id: "d3", driver_name: "川島幹太", bill: 200000, driver_profit: 200000, payout: 0, payout_incl: 0, entry_count: 1, driver_is_active: false }),
      driverMonth({ driver_id: "d4", driver_name: "沼田基", bill: 100000, driver_profit: 0, payout: 90000, payout_incl: 99000, entry_count: 0 }),
    ]);
    expect(rows.map((r) => r.driverName)).toEqual(["金島幸太", "川島幹太", "相曽慧", "沼田基"]);
    const aiso = rows.find((r) => r.driverId === "d1");
    expect(aiso?.bill).toBe(983525);
    expect(aiso?.profit).toBe(110000.5);
    expect(aiso?.payout).toBe(810000);
    expect(aiso?.payoutIncl).toBe(891000);
    expect(aiso?.entryCount).toBe(3);
    expect(aiso?.monthCount).toBe(2);
    expect(aiso?.profitRate).toBeCloseTo(110000.5 / 983525, 10);
    expect(rows.find((r) => r.driverId === "d3")?.isActive).toBe(false);
    expect(rows.find((r) => r.driverId === "d4")?.monthCount).toBe(0);
    expect(rows.find((r) => r.driverId === "d4")?.profitRate).toBe(0);
  });

  it("案件別：案件内容ごとに合計し、利益の降順。内容「標準」は案件名だけ表示", () => {
    const rows = projectRanking([
      projectMonth({ project_item_id: "i1", month: "2026-09-01", bill: 483525, pay: 457380, entry_profit: 26145, qty_total: 21, entry_count: 2 }),
      projectMonth({ project_item_id: "i1", month: "2026-10-01", bill: 400000, pay: 380000, entry_profit: 20000, qty_total: 18, entry_count: 1 }),
      projectMonth({ project_item_id: "i2", project_name: "越谷ヤマト", item_name: "スポット", client_name: "", bill: 100000, pay: 60000, entry_profit: 40000, qty_total: 5, entry_count: 1 }),
      projectMonth({ project_item_id: null, project_id: "p9", item_name: "旧内容", project_name: "旧案件", bill: 1000, pay: 900, entry_profit: 100, entry_count: 1 }),
    ]);
    expect(rows.map((r) => projectLabel(r))).toEqual(["三郷Amazon", "越谷ヤマト（スポット）", "旧案件（旧内容）"]);
    expect(rows[0].bill).toBe(883525);
    expect(rows[0].profit).toBe(46145);
    expect(rows[0].qtyTotal).toBe(39);
    expect(rows[0].entryCount).toBe(3);
    expect(rows[0].profitRate).toBeCloseTo(46145 / 883525, 10);
    expect(rows[0].clientName).toBe("アマゾンジャパン");
    expect(rows[2].key).toBe("p9-旧内容");
  });

  it("経費：カテゴリごとに合計し金額の降順、構成比と固定費・変動費の合計", () => {
    const ranked = expenseRanking([
      expenseRow({ category_id: "c1", category_name: "燃料費", kind: "variable", month: "2026-09-01", amount: 60000, expense_count: 3 }),
      expenseRow({ category_id: "c1", category_name: "燃料費", kind: "variable", month: "2026-10-01", amount: 40000.5, expense_count: 2 }),
      expenseRow({ category_id: "c2", category_name: "地代家賃", kind: "fixed", amount: 150000, expense_count: 1 }),
      expenseRow({ category_id: "c3", category_name: "通信費", kind: "fixed", amount: 9500, expense_count: 2 }),
    ]);
    expect(ranked.map((r) => r.categoryName)).toEqual(["地代家賃", "燃料費", "通信費"]);
    expect(ranked[1].amount).toBe(100000.5);
    expect(ranked[1].expenseCount).toBe(5);
    expect(ranked[0].share).toBeCloseTo(150000 / 259500.5, 10);
    expect(ranked.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 10);
    const totals = expenseKindTotals(ranked);
    expect(totals).toEqual({ fixed: 159500, variable: 100000.5, total: 259500.5 });
    expect(expenseRanking([])).toEqual([]);
    expect(expenseKindTotals([])).toEqual({ fixed: 0, variable: 0, total: 0 });
  });
});

describe("年次レポート CSV", () => {
  const rows = toReportRows(YEAR_2026, 2026);

  it("列は 16 列、ヘッダー ＋ 12 か月 ＋ 合計行", () => {
    expect(REPORT_CSV_HEADERS).toHaveLength(16);
    expect(REPORT_CSV_HEADERS[0]).toBe("稼動月");
    expect(REPORT_CSV_HEADERS[11]).toBe("営業利益");
    expect(REPORT_CSV_HEADERS[15]).toBe("状態");
    const csvRows = toReportCsvRows(rows);
    expect(csvRows).toHaveLength(1 + 12 + 1);
    expect(csvRows[0]).toEqual([...REPORT_CSV_HEADERS]);
    expect(csvRows.every((r) => r.length === 16)).toBe(true);
  });

  it("1 行は v_month_pl の値をそのまま（数値は生の値、状態は日本語）", () => {
    expect(reportToCsvRow(rows[8])).toEqual([
      "2026-09",
      "2559573",
      "1700000",
      "400000.5",
      "120000",
      "132489.8",
      "0",
      "652490.3",
      "150000",
      "50000.3",
      "200000.3",
      "452490",
      "0.1768",
      "170000",
      "1870000",
      MONTH_STATUS_LABELS.open,
    ]);
    // 締め済みの月・データの無い月
    expect(reportToCsvRow(rows[9])[15]).toBe("締め済み");
    expect(reportToCsvRow(rows[0])[15]).toBe("");
    expect(reportToCsvRow(rows[0])[1]).toBe("0");
  });

  it("合計行と CSV 文字列（BOM・CRLF）", () => {
    const csv = toReportCsv(rows);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/);
    const lines = csv.slice(CSV_BOM.length).trimEnd().split("\r\n");
    expect(lines).toHaveLength(14);
    expect(lines[0].split(",")[0]).toBe("稼動月");
    expect(lines[9]).toContain("2026-09");
    const total = lines[13].split(",");
    expect(total[0]).toBe("合計");
    expect(total[1]).toBe("3559573");
    expect(total[11]).toBe("582490");
    expect(total[13]).toBe("240000");
    expect(total[15]).toBe("");
    expect(reportCsvFilename(2026)).toBe("年次レポート_2026.csv");
  });

  it("データが 1 件も無い年でもヘッダーと 0 の合計行を出す", () => {
    const csv = toReportCsv(toReportRows([], 2020));
    const lines = csv.slice(CSV_BOM.length).trimEnd().split("\r\n");
    expect(lines).toHaveLength(14);
    expect(lines[13]).toBe("合計,0,0,0,0,0,0,0,0,0,0,0,0,0,0,");
  });
});
