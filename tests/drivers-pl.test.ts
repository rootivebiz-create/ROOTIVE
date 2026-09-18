import { describe, expect, it } from "vitest";
import {
  buildDriverPlRows,
  buildSimDrivers,
  driverEntryRows,
  driverStateLabel,
  driverTrend,
  entryLabel,
  hasOwnerRow,
  hiddenInactiveCount,
  isOwnerEntries,
  resolveSelectedDriver,
  sumDriverPlRows,
  toAdjustmentInputs,
  trendScale,
  visibleDriverPlRows,
} from "@/components/drivers-pl/helpers";
import { DRIVERS_PL_CSV_HEADERS, driverPlToCsvRow, driversPlCsvFilename, driversPlTotalCsvRow, toDriversPlCsv, toDriversPlCsvRows } from "@/lib/exports/drivers-pl-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import { calcDriverMonth } from "@/lib/calc";
import type { DriverMonthSummary, WorkEntryCalc } from "@/lib/db/types";

const COMPANY = "00000000-0000-0000-0000-000000000001";

/** v_driver_month_summary の 1 行（指定しない列は 0／既定値） */
function summary(driverId: string, over: Partial<DriverMonthSummary> = {}): DriverMonthSummary {
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    driver_id: driverId,
    driver_name: driverId,
    driver_sort_order: 0,
    driver_is_active: true,
    driver_default_mgmt_fee: 15000,
    driver_month_id: `dm-${driverId}`,
    memo: "",
    entry_count: 0,
    active_entry_count: 0,
    bill: 0,
    pay: 0,
    margin: 0,
    royalty: 0,
    mgmt_fee_setting: 0,
    mgmt_fee: 0,
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

/** v_work_entry_calc の 1 行 */
function entry(id: string, driverId: string, over: Partial<WorkEntryCalc> = {}): WorkEntryCalc {
  return {
    id,
    company_id: COMPANY,
    month: "2026-09-01",
    driver_id: driverId,
    project_item_id: "pi-1",
    project_id: "p-1",
    driver_name: driverId,
    driver_sort_order: 0,
    driver_is_active: true,
    project_name: "Amazon",
    client_name: "",
    item_name: "標準",
    unit: "day",
    qty: 20,
    bill_rate: 23025,
    pay_rate: 21780,
    royalty_rate: 0.1,
    rounding_mode: "floor",
    memo: "",
    created_by: null,
    updated_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    bill: 460500,
    pay: 435600,
    margin: 24900,
    royalty: 43560,
    entry_profit: 68460,
    ...over,
  };
}

/** 田中（利益 83,460）・佐藤（利益 30,000）・停止中の鈴木（利益 10,000）・オーナーの川島（利益 200,000） */
const SUMMARIES: DriverMonthSummary[] = [
  summary("tanaka", {
    entry_count: 1,
    active_entry_count: 1,
    bill: 460500,
    pay: 435600,
    margin: 24900,
    royalty: 43560,
    mgmt_fee_setting: 15000,
    mgmt_fee: 15000,
    payout: 377040,
    driver_profit: 83460,
    tax_base: 377040,
    tax: 37704,
    payout_incl: 414744,
  }),
  summary("sato", {
    driver_sort_order: 1,
    entry_count: 1,
    active_entry_count: 1,
    bill: 120000,
    pay: 100000,
    margin: 20000,
    royalty: 10000,
    mgmt_fee_setting: 0,
    mgmt_fee: 0,
    payout: 90000,
    driver_profit: 30000,
    tax_base: 90000,
    tax: 9000,
    payout_incl: 99000,
  }),
  summary("suzuki", {
    driver_is_active: false,
    driver_sort_order: 2,
    entry_count: 1,
    active_entry_count: 1,
    bill: 50000,
    pay: 40000,
    margin: 10000,
    royalty: 0,
    payout: 40000,
    driver_profit: 10000,
    tax_base: 40000,
    tax: 4000,
    payout_incl: 44000,
  }),
  summary("kawashima", {
    driver_sort_order: 3,
    entry_count: 1,
    active_entry_count: 1,
    bill: 200000,
    pay: 0,
    margin: 200000,
    royalty: 0,
    payout: 0,
    driver_profit: 200000,
    tax_base: 0,
    tax: 0,
    payout_incl: 0,
  }),
  // 稼働行も調整も無い行（一覧には出さない）
  summary("nodata", { driver_sort_order: 4 }),
];

const ENTRIES: WorkEntryCalc[] = [
  entry("e1", "tanaka"),
  entry("e2", "sato", { qty: 10, bill_rate: 12000, pay_rate: 10000, bill: 120000, pay: 100000, margin: 20000, royalty: 10000, entry_profit: 30000, project_name: "ヤマト", item_name: "小口" }),
  entry("e3", "suzuki", { qty: 5, bill_rate: 10000, pay_rate: 8000, bill: 50000, pay: 40000, margin: 10000, royalty: 0, royalty_rate: 0, entry_profit: 10000 }),
  entry("e4", "kawashima", { qty: 10, bill_rate: 20000, pay_rate: 0, royalty_rate: 0, bill: 200000, pay: 0, margin: 200000, royalty: 0, entry_profit: 200000 }),
];

describe("一覧の組み立て（buildDriverPlRows）", () => {
  it("会社利益の多い順に並ぶ", () => {
    const rows = buildDriverPlRows(SUMMARIES, ENTRIES);
    expect(rows.map((r) => r.driverId)).toEqual(["kawashima", "tanaka", "sato", "suzuki", "nodata"]);
  });

  it("ビューの値をそのまま使い、利益率・1 稼働あたりの利益・稼働量を足す", () => {
    const tanaka = buildDriverPlRows(SUMMARIES, ENTRIES).find((r) => r.driverId === "tanaka")!;
    expect(tanaka.month).toBe("2026-09");
    expect(tanaka.bill).toBe(460500);
    expect(tanaka.pay).toBe(435600);
    expect(tanaka.margin).toBe(24900);
    expect(tanaka.royalty).toBe(43560);
    expect(tanaka.mgmtFee).toBe(15000);
    expect(tanaka.profit).toBe(83460);
    expect(tanaka.payoutIncl).toBe(414744);
    expect(tanaka.qtyTotal).toBe(20);
    expect(tanaka.profitRate).toBeCloseTo(83460 / 460500, 10);
    expect(tanaka.profitPerEntry).toBe(83460); // 数量 > 0 の行は 1 件
    expect(tanaka.hasData).toBe(true);
  });

  it("稼働行が 1 件も無い行は 1 稼働あたりの利益が null、hasData は false", () => {
    const nodata = buildDriverPlRows(SUMMARIES, ENTRIES).find((r) => r.driverId === "nodata")!;
    expect(nodata.profitPerEntry).toBeNull();
    expect(nodata.profitRate).toBe(0);
    expect(nodata.qtyTotal).toBe(0);
    expect(nodata.hasData).toBe(false);
  });

  it("調整だけがある月も一覧に出す", () => {
    const rows = buildDriverPlRows([summary("adj-only", { adjustment_count: 1, adj_pay: -5000, adj_profit: 5000, payout: -5000, driver_profit: 5000 })], []);
    expect(rows[0].hasData).toBe(true);
    expect(rows[0].adjPay).toBe(-5000);
  });
});

describe("オーナー判定・状態の表示", () => {
  it("支払単価 0 の行だけのドライバーを役員・オーナーとして扱う", () => {
    const rows = buildDriverPlRows(SUMMARIES, ENTRIES);
    expect(rows.find((r) => r.driverId === "kawashima")!.isOwner).toBe(true);
    expect(rows.find((r) => r.driverId === "tanaka")!.isOwner).toBe(false);
    expect(hasOwnerRow(rows)).toBe(true);
  });

  it("支払単価 0 の行が混ざるだけでは役員扱いにしない（稼働行が無い場合も false）", () => {
    expect(isOwnerEntries([entry("a", "x", { pay_rate: 0 }), entry("b", "x", { pay_rate: 1000 })])).toBe(false);
    expect(isOwnerEntries([entry("a", "x", { pay_rate: 0 })])).toBe(true);
    expect(isOwnerEntries([])).toBe(false);
  });

  it("状態は 役員・オーナー → 停止中 → 稼働中 の順で決まる", () => {
    expect(driverStateLabel({ isActive: true, isOwner: true })).toBe("役員・オーナー");
    expect(driverStateLabel({ isActive: true, isOwner: false })).toBe("稼働中");
    expect(driverStateLabel({ isActive: false, isOwner: false })).toBe("停止中");
  });
});

describe("絞り込みと合計", () => {
  it("既定では停止中とデータの無い行を隠す", () => {
    const rows = buildDriverPlRows(SUMMARIES, ENTRIES);
    expect(visibleDriverPlRows(rows).map((r) => r.driverId)).toEqual(["kawashima", "tanaka", "sato"]);
    expect(visibleDriverPlRows(rows, { includeInactive: true }).map((r) => r.driverId)).toEqual(["kawashima", "tanaka", "sato", "suzuki"]);
    expect(hiddenInactiveCount(rows)).toBe(1);
  });

  it("合計は表示中の行の合計（利益率は合計どうしの比）", () => {
    const rows = visibleDriverPlRows(buildDriverPlRows(SUMMARIES, ENTRIES));
    const t = sumDriverPlRows(rows);
    expect(t.driverCount).toBe(3);
    expect(t.entryCount).toBe(3);
    expect(t.qtyTotal).toBe(40);
    expect(t.bill).toBe(780500);
    expect(t.pay).toBe(535600);
    expect(t.profit).toBe(313460);
    expect(t.payoutIncl).toBe(513744);
    expect(t.profitRate).toBeCloseTo(313460 / 780500, 10);
    expect(t.profitPerEntry).toBeCloseTo(313460 / 3, 10);
  });

  it("空の一覧でも合計は 0（利益率・1 稼働あたりは 0／null）", () => {
    const t = sumDriverPlRows([]);
    expect(t.driverCount).toBe(0);
    expect(t.bill).toBe(0);
    expect(t.profitRate).toBe(0);
    expect(t.profitPerEntry).toBeNull();
  });
});

describe("推移・稼働の内訳・選択", () => {
  it("12 か月の推移はデータの無い月を 0 埋めする", () => {
    const months = ["2026-08", "2026-09"];
    const points = driverTrend([summary("tanaka", { month: "2026-09-01", entry_count: 1, bill: 460500, driver_profit: 83460 })], "tanaka", months);
    expect(points.map((p) => p.month)).toEqual(months);
    expect(points[0].hasData).toBe(false);
    expect(points[0].bill).toBe(0);
    expect(points[1].hasData).toBe(true);
    expect(points[1].profitRate).toBeCloseTo(83460 / 460500, 10);
    expect(trendScale(points)).toBe(460500);
  });

  it("稼働の内訳は選んだドライバーの行だけを返す", () => {
    const rows = driverEntryRows(ENTRIES, "sato");
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(10);
    expect(rows[0].billRate).toBe(12000);
    expect(rows[0].payRate).toBe(10000);
    expect(rows[0].entryProfit).toBe(30000);
    expect(entryLabel(rows[0])).toBe("ヤマト（小口）");
    expect(entryLabel({ projectName: "Amazon", itemName: "標準" })).toBe("Amazon");
  });

  it("選択中のドライバーが一覧に無ければ先頭（利益 1 位）に戻す", () => {
    const rows = visibleDriverPlRows(buildDriverPlRows(SUMMARIES, ENTRIES));
    expect(resolveSelectedDriver(rows, "sato")).toBe("sato");
    expect(resolveSelectedDriver(rows, "suzuki")).toBe("kawashima");
    expect(resolveSelectedDriver(rows, null)).toBe("kawashima");
    expect(resolveSelectedDriver([], "sato")).toBe("");
  });
});

describe("シミュレーションの入力（buildSimDrivers）", () => {
  it("ビューの値から calcDriverMonth の入力を組み立て、現状の数字を再現する", () => {
    const sims = buildSimDrivers(SUMMARIES, ENTRIES);
    const tanaka = sims.find((s) => s.driverId === "tanaka")!;
    expect(tanaka.entries).toEqual([{ qty: 20, billRate: 23025, payRate: 21780, royaltyRate: 0.1, roundingMode: "floor" }]);
    expect(tanaka.driverMonth.mgmtFee).toBe(15000);
    expect(tanaka.driverMonth.tax).toEqual({ mode: "taxable", rate: 0.1, rounding: "floor" });

    const calc = calcDriverMonth({ entries: tanaka.entries, mgmtFee: tanaka.driverMonth.mgmtFee, adjustments: tanaka.driverMonth.adjustments, tax: tanaka.driverMonth.tax });
    expect(calc.bill).toBe(460500);
    expect(calc.payout).toBe(377040);
    expect(calc.driverProfit).toBe(83460);
    expect(calc.tax).toBe(37704);
    expect(calc.payoutIncl).toBe(414744);
  });

  it("調整は合計から「利益計上あり／なし」の 2 件に復元する", () => {
    expect(toAdjustmentInputs(0, 0)).toEqual([]);
    expect(toAdjustmentInputs(-5000, 5000)).toEqual([{ amount: -5000, countAsProfit: true }]);
    expect(toAdjustmentInputs(-2000, 5000)).toEqual([
      { amount: -5000, countAsProfit: true },
      { amount: 3000, countAsProfit: false },
    ]);
    // 復元した調整で計算しても payout / driver_profit は元どおり
    const calc = calcDriverMonth({ entries: [], mgmtFee: 0, adjustments: toAdjustmentInputs(-2000, 5000), tax: null });
    expect(calc.adjPay).toBe(-2000);
    expect(calc.adjProfit).toBe(5000);
  });
});

describe("CSV（ドライバー別の採算）", () => {
  const rows = visibleDriverPlRows(buildDriverPlRows(SUMMARIES, ENTRIES));

  it("列は 稼動月 … 税込支払額 の 14 列", () => {
    expect(DRIVERS_PL_CSV_HEADERS).toEqual([
      "稼動月",
      "ドライバー",
      "状態",
      "稼働件数",
      "数量",
      "売上",
      "支払（税抜）",
      "単価差額利益",
      "ロイヤリティ",
      "管理費",
      "調整",
      "会社利益",
      "利益率",
      "税込支払額",
    ]);
  });

  it("1 行は生の値（カンマ・¥ なし、率は率のまま）", () => {
    const tanaka = rows.find((r) => r.driverId === "tanaka")!;
    expect(driverPlToCsvRow(tanaka)).toEqual(["2026-09", "tanaka", "稼働中", "1", "20", "460500", "435600", "24900", "43560", "15000", "0", "83460", "0.1812", "414744"]);
  });

  it("役員・オーナーは状態が「役員・オーナー」になる", () => {
    const owner = rows.find((r) => r.driverId === "kawashima")!;
    expect(driverPlToCsvRow(owner)[2]).toBe("役員・オーナー");
    expect(driverPlToCsvRow(owner)[12]).toBe("1"); // 利益率 100%
  });

  it("合計行は「合計」と人数、利益率は合計どうしの比", () => {
    const total = driversPlTotalCsvRow(rows);
    expect(total[0]).toBe("合計");
    expect(total[1]).toBe("3 名");
    expect(total[5]).toBe("780500");
    expect(total[11]).toBe("313460");
    expect(total[13]).toBe("513744");
  });

  it("CSV 文字列は BOM 付き・CRLF・ヘッダー ＋ 行 ＋ 合計行", () => {
    const csv = toDriversPlCsv(rows);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const lines = csv.slice(CSV_BOM.length).trimEnd().split("\r\n");
    expect(lines).toHaveLength(1 + rows.length + 1);
    expect(lines[0]).toBe(DRIVERS_PL_CSV_HEADERS.join(","));
    expect(lines.at(-1)!.startsWith("合計,")).toBe(true);
    expect(toDriversPlCsvRows(rows)).toHaveLength(1 + rows.length + 1);
  });

  it("ファイル名は稼動月つき", () => {
    expect(driversPlCsvFilename("2026-09")).toBe("ドライバー別採算_2026-09.csv");
  });
});
