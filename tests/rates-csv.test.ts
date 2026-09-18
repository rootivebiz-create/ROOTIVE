import { describe, expect, it } from "vitest";
import type { Driver, DriverPayOverride, Masters, ProjectItem, ProjectWithItems } from "@/lib/db/types";
import { CSV_BOM } from "@/lib/exports/csv";
import { RATES_CSV_HEADERS, rateRows, ratesCsvFilename, ratesToCsv, ratesToCsvRows } from "@/lib/exports/rates-csv";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const D_AISO = "10000000-0000-4000-8000-000000000001";
const D_YOSHIDA = "10000000-0000-4000-8000-000000000002";
const D_STOPPED = "10000000-0000-4000-8000-000000000003";
const P_MISATO = "20000000-0000-4000-8000-000000000001";
const P_KASHIWA = "20000000-0000-4000-8000-000000000002";
const P_STOPPED = "20000000-0000-4000-8000-000000000003";
const I_MISATO_STD = "30000000-0000-4000-8000-000000000001";
const I_MISATO_PIECE = "30000000-0000-4000-8000-000000000002";
const I_MISATO_OLD = "30000000-0000-4000-8000-000000000003";
const I_KASHIWA_STD = "30000000-0000-4000-8000-000000000004";
const I_STOPPED = "30000000-0000-4000-8000-000000000005";

function driver(id: string, name: string, sort_order: number, is_active = true): Driver {
  return { id, company_id: COMPANY, name, kana: "", is_active, royalty_rate: null, mgmt_fee: 15000, rounding_mode: null, phone: "", email: "", bank_info: "", memo: "", sort_order, tax_mode: "taxable", invoice_reg_no: "", payout_month_offset: null, payout_day: null, created_at: "", updated_at: "" };
}

function item(id: string, project_id: string, name: string, unit: "day" | "piece", bill_rate: number, pay_rate: number, sort_order: number, is_active = true): ProjectItem {
  return { id, company_id: COMPANY, project_id, name, unit, bill_rate, pay_rate, is_active, sort_order, created_at: "", updated_at: "" };
}

function project(id: string, name: string, sort_order: number, items: ProjectItem[], is_active = true): ProjectWithItems {
  return { id, company_id: COMPANY, name, client_name: "", client_id: null, is_active, memo: "", sort_order, created_at: "", updated_at: "", items };
}

function override(driver_id: string, project_item_id: string, rates: { bill_rate?: number | null; pay_rate?: number | null }): DriverPayOverride {
  return { company_id: COMPANY, driver_id, project_item_id, bill_rate: rates.bill_rate ?? null, pay_rate: rates.pay_rate ?? null, created_at: "", updated_at: "" };
}

/** ドライバー・案件・内容はわざと並び順と逆の順序で入れる（並び替えの検証用） */
const masters: Masters = {
  company: {
    id: COMPANY,
    name: "ROOTIVE",
    rounding_mode: "none",
    default_royalty_rate: 0.1,
    default_mgmt_fee: 15000,
    payout_month_offset: 1,
    payout_day: 0,
    statement_note: "",
    invoice_reg_no: "",
    address: "",
    tel: "",
    driver_portal_show_royalty: true,
  driver_portal_show_open_month: true,
    yayoi_accounts: {},
    tax_rate: 0.1,
    tax_rounding: "floor",
    logo_path: null,
    seal_path: null,
    created_at: "",
    updated_at: "",
  },
  drivers: [driver(D_STOPPED, "退職者", 0, false), driver(D_YOSHIDA, "吉田雅一", 2), driver(D_AISO, "相曽慧", 1)],
  projects: [
    project(P_STOPPED, "終了案件", 0, [item(I_STOPPED, P_STOPPED, "標準", "day", 10000, 9000, 1)], false),
    project(P_KASHIWA, "柏Amazon", 2, [item(I_KASHIWA_STD, P_KASHIWA, "標準", "day", 22000, 20500, 1)]),
    project(P_MISATO, "三郷Amazon", 1, [
      item(I_MISATO_OLD, P_MISATO, "旧単価", "day", 20000, 19000, 3, false),
      item(I_MISATO_PIECE, P_MISATO, "個建て", "piece", 180.5, 162.3, 2),
      item(I_MISATO_STD, P_MISATO, "標準", "day", 23025, 21780, 1),
    ]),
  ],
  overrides: [
    // 両方の上書き
    override(D_AISO, I_MISATO_STD, { bill_rate: 23500, pay_rate: 22000 }),
    // 受注単価だけの上書き
    override(D_AISO, I_MISATO_PIECE, { bill_rate: 190 }),
    // 支払単価だけの上書き
    override(D_YOSHIDA, I_KASHIWA_STD, { pay_rate: 21000 }),
    // 停止中のドライバー・内容への上書きは出力に現れない
    override(D_STOPPED, I_MISATO_STD, { pay_rate: 1 }),
    override(D_YOSHIDA, I_MISATO_OLD, { pay_rate: 1 }),
  ],
};

describe("単価表 CSV", () => {
  it("列並び", () => {
    expect([...RATES_CSV_HEADERS]).toEqual(["ドライバー", "案件", "内容", "区分", "受注単価", "支払単価", "差額", "受注単価の出所", "支払単価の出所", "個別受注単価", "個別支払単価"]);
    expect(ratesToCsvRows(masters)[0]).toEqual([...RATES_CSV_HEADERS]);
  });

  it("並び順：ドライバーの並び順 → 案件の並び順 → 内容の並び順（入力の順序に依らない）", () => {
    const rows = rateRows(masters);
    expect(rows.map((r) => `${r.driverName}/${r.projectName}/${r.itemName}`)).toEqual([
      "相曽慧/三郷Amazon/標準",
      "相曽慧/三郷Amazon/個建て",
      "相曽慧/柏Amazon/標準",
      "吉田雅一/三郷Amazon/標準",
      "吉田雅一/三郷Amazon/個建て",
      "吉田雅一/柏Amazon/標準",
    ]);
  });

  it("停止中のドライバー・案件・内容は除外する（上書きがあっても出さない）", () => {
    const rows = rateRows(masters);
    expect(rows.some((r) => r.driverId === D_STOPPED)).toBe(false);
    expect(rows.some((r) => r.projectId === P_STOPPED)).toBe(false);
    expect(rows.some((r) => r.itemId === I_MISATO_OLD)).toBe(false);
    expect(rows).toHaveLength(2 * 3);
  });

  it("個別単価が標準より優先され、出所は「個別」、個別列に値が入る", () => {
    const row = rateRows(masters).find((r) => r.driverId === D_AISO && r.itemId === I_MISATO_STD)!;
    expect(row).toMatchObject({ billRate: 23500, payRate: 22000, margin: 1500, billRateSource: "override", payRateSource: "override", overrideBillRate: 23500, overridePayRate: 22000 });
    const csvRow = ratesToCsvRows(masters)[1];
    expect(csvRow).toEqual(["相曽慧", "三郷Amazon", "標準", "日給", "23500", "22000", "1500", "個別", "個別", "23500", "22000"]);
  });

  it("片方だけの上書き：上書きの無い側は標準を使い、個別列は空", () => {
    const rows = ratesToCsvRows(masters);
    // 受注単価だけ（相曽慧 × 三郷Amazon 個建て）
    expect(rows[2]).toEqual(["相曽慧", "三郷Amazon", "個建て", "個数", "190", "162.3", "27.7", "個別", "標準", "190", ""]);
    // 支払単価だけ（吉田雅一 × 柏Amazon 標準）
    expect(rows[6]).toEqual(["吉田雅一", "柏Amazon", "標準", "日給", "22000", "21000", "1000", "標準", "個別", "", "21000"]);
  });

  it("上書きが無ければ標準の単価・出所「標準」・個別列は空。差額は受注 − 支払（誤差なし）", () => {
    const rows = ratesToCsvRows(masters);
    expect(rows[3]).toEqual(["相曽慧", "柏Amazon", "標準", "日給", "22000", "20500", "1500", "標準", "標準", "", ""]);
    expect(rows[5]).toEqual(["吉田雅一", "三郷Amazon", "個建て", "個数", "180.5", "162.3", "18.2", "標準", "標準", "", ""]);
  });

  it("上書きの単価が 0 でも個別として扱う（川島幹太のような支払 0）", () => {
    const m: Masters = { ...masters, overrides: [override(D_AISO, I_KASHIWA_STD, { pay_rate: 0 })] };
    const row = rateRows(m).find((r) => r.driverId === D_AISO && r.itemId === I_KASHIWA_STD)!;
    expect(row).toMatchObject({ billRate: 22000, payRate: 0, margin: 22000, billRateSource: "item", payRateSource: "override", overrideBillRate: null, overridePayRate: 0 });
  });

  it("CSV は UTF-8 BOM 付き・CRLF・末尾にも CRLF", () => {
    const csv = ratesToCsv(masters);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(RATES_CSV_HEADERS.join(","));
    expect(lines[1]).toBe("相曽慧,三郷Amazon,標準,日給,23500,22000,1500,個別,個別,23500,22000");
    expect(lines).toHaveLength(1 + 6 + 1);
    expect(lines.at(-1)).toBe("");
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("ドライバーや案件が無ければヘッダー行だけ", () => {
    expect(ratesToCsvRows({ ...masters, drivers: [] })).toEqual([[...RATES_CSV_HEADERS]]);
    expect(ratesToCsvRows({ ...masters, projects: [] })).toEqual([[...RATES_CSV_HEADERS]]);
  });

  it("ファイル名は 単価表_YYYYMMDD.csv（日本時間）", () => {
    expect(ratesCsvFilename(new Date("2026-09-16T15:04:00Z"))).toBe("単価表_20260917.csv");
    expect(ratesCsvFilename(new Date("2026-01-05T01:02:00Z"))).toBe("単価表_20260105.csv");
  });
});
