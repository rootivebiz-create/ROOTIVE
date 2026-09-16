import { describe, expect, it } from "vitest";
import { bulkRowSchema, bulkSetEntriesSchema, entryInputSchema } from "@/lib/schemas/entries";
import { defaultsFor, filterActiveMasters, filterRows, isLossRow, isQtyEmpty, itemOptions, oldestEntryFor, projectDisplayName, toEntryRow, type EntryRow } from "@/components/entries/helpers";
import type { Masters, WorkEntryCalc } from "@/lib/db/types";

const DRIVER = "11111111-1111-4111-8111-111111111111";
const DRIVER2 = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const ITEM2 = "44444444-4444-4444-8444-444444444444";
const PROJECT = "55555555-5555-4555-8555-555555555555";
const COMPANY = "66666666-6666-4666-8666-666666666666";

const base = {
  month: "2026-09",
  driver_id: DRIVER,
  project_item_id: ITEM,
  qty: "21",
  bill_rate: "23,025",
  pay_rate: "21780",
  royalty_percent: "10",
  rounding_mode: "none",
  memo: "  テスト  ",
};

describe("entryInputSchema", () => {
  it("文字列のフォーム値を正規化する（カンマ・全角・% → 率）", () => {
    const v = entryInputSchema.parse({ ...base, qty: "２１", royalty_percent: "12.5%" });
    expect(v.qty).toBe(21);
    expect(v.bill_rate).toBe(23025);
    expect(v.pay_rate).toBe(21780);
    expect(v.royalty_percent).toBe(0.125);
    expect(v.rounding_mode).toBe("none");
    expect(v.memo).toBe("テスト");
  });

  it("率 10 → 0.1、備考は省略可", () => {
    const { memo: _memo, ...rest } = base;
    const v = entryInputSchema.parse(rest);
    expect(v.royalty_percent).toBe(0.1);
    expect(v.memo).toBe("");
  });

  it("数量 0 は許容（未入力状態）", () => {
    expect(entryInputSchema.parse({ ...base, qty: "0" }).qty).toBe(0);
  });

  it("不正値を拒否する", () => {
    expect(entryInputSchema.safeParse({ ...base, qty: "-1" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, qty: "" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, bill_rate: "abc" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, bill_rate: "1.234" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, royalty_percent: "101" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, month: "2026-9" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, driver_id: "" }).success).toBe(false);
    expect(entryInputSchema.safeParse({ ...base, rounding_mode: "half" }).success).toBe(false);
  });

  it("エラーはフィールド名付きで返る", () => {
    const r = entryInputSchema.safeParse({ ...base, qty: "-1" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["qty"]);
  });
});

describe("bulk schemas", () => {
  it("空欄・null の数量は 0 として扱う", () => {
    expect(bulkRowSchema.parse({ driver_id: DRIVER, qty: "" }).qty).toBe(0);
    expect(bulkRowSchema.parse({ driver_id: DRIVER, qty: "  " }).qty).toBe(0);
    expect(bulkRowSchema.parse({ driver_id: DRIVER, qty: null }).qty).toBe(0);
    expect(bulkRowSchema.parse({ driver_id: DRIVER, qty: "８０３" }).qty).toBe(803);
  });

  it("行の配列を検証する", () => {
    const v = bulkSetEntriesSchema.parse({ month: "2026-09", project_item_id: ITEM, rows: [{ driver_id: DRIVER, qty: "21" }, { driver_id: DRIVER2, qty: "" }] });
    expect(v.rows).toEqual([
      { driver_id: DRIVER, qty: 21 },
      { driver_id: DRIVER2, qty: 0 },
    ]);
    expect(bulkSetEntriesSchema.safeParse({ month: "2026-09", project_item_id: ITEM, rows: [{ driver_id: "x", qty: "1" }] }).success).toBe(false);
    expect(bulkSetEntriesSchema.safeParse({ month: "2026-09", project_item_id: ITEM, rows: [{ driver_id: DRIVER, qty: "-2" }] }).success).toBe(false);
  });
});

function viewRow(over: Partial<WorkEntryCalc> = {}): WorkEntryCalc {
  return {
    id: "e1",
    company_id: COMPANY,
    month: "2026-09-01",
    driver_id: DRIVER,
    project_item_id: ITEM,
    project_id: PROJECT,
    driver_name: "相曽慧",
    driver_sort_order: 1,
    driver_is_active: true,
    project_name: "三郷Amazon",
    client_name: "",
    item_name: "標準",
    unit: "day",
    qty: 21,
    bill_rate: 23025,
    pay_rate: 21780,
    royalty_rate: 0.1,
    rounding_mode: "none",
    memo: "",
    created_by: null,
    updated_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    bill: 483525,
    pay: 457380,
    margin: 26145,
    royalty: 45738,
    entry_profit: 71883,
    ...over,
  };
}

describe("helpers", () => {
  it("toEntryRow はビューの null を正規化し月を YYYY-MM にする", () => {
    const r = toEntryRow(viewRow({ qty: null, memo: null, bill: null }));
    expect(r.month).toBe("2026-09");
    expect(r.qty).toBe(0);
    expect(r.memo).toBe("");
    expect(r.bill).toBe(0);
    expect(r.entryProfit).toBe(71883);
  });

  it("案件表示名：内容が「標準」以外なら「案件（内容）」", () => {
    expect(projectDisplayName("三郷Amazon", "標準")).toBe("三郷Amazon");
    expect(projectDisplayName("和光ヤマト", "宅急便")).toBe("和光ヤマト（宅急便）");
    expect(projectDisplayName("三郷Amazon", "")).toBe("三郷Amazon");
  });

  it("警告：数量 0 は未入力、支払 > 受注のみ赤字（支払 0・率 0 は正常）", () => {
    expect(isQtyEmpty({ qty: 0 })).toBe(true);
    expect(isQtyEmpty({ qty: 1 })).toBe(false);
    expect(isLossRow({ billRate: 23025, payRate: 21780 })).toBe(false);
    expect(isLossRow({ billRate: 23025, payRate: 0 })).toBe(false);
    expect(isLossRow({ billRate: 15000, payRate: 15000 })).toBe(false);
    expect(isLossRow({ billRate: 180, payRate: 181 })).toBe(true);
  });

  it("絞り込み・検索（ドライバー、部分一致）", () => {
    const rows: EntryRow[] = [
      toEntryRow(viewRow()),
      toEntryRow(viewRow({ id: "e2", driver_id: DRIVER2, driver_name: "今井皇輝", project_name: "和光ヤマト", item_name: "宅急便", memo: "午前のみ" })),
    ];
    expect(filterRows(rows, DRIVER2, "").map((r) => r.id)).toEqual(["e2"]);
    expect(filterRows(rows, "", "ヤマト").map((r) => r.id)).toEqual(["e2"]);
    expect(filterRows(rows, "", "午前").map((r) => r.id)).toEqual(["e2"]);
    expect(filterRows(rows, "", "相曽").map((r) => r.id)).toEqual(["e1"]);
    expect(filterRows(rows, "", "和光ヤマト（宅急便）").map((r) => r.id)).toEqual(["e2"]);
    expect(filterRows(rows, DRIVER, "ヤマト")).toEqual([]);
  });

  it("oldestEntryFor は created_at が最も古い行と件数を返す", () => {
    const rows = [
      toEntryRow(viewRow({ id: "new", created_at: "2026-09-05T00:00:00Z", qty: 5 })),
      toEntryRow(viewRow({ id: "old", created_at: "2026-09-01T00:00:00Z", qty: 21 })),
      toEntryRow(viewRow({ id: "other", project_item_id: ITEM2 })),
    ];
    const r = oldestEntryFor(rows, DRIVER, ITEM);
    expect(r.entry?.id).toBe("old");
    expect(r.count).toBe(2);
    expect(oldestEntryFor(rows, DRIVER2, ITEM).entry).toBeNull();
  });

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
      yayoi_accounts: {},
      created_at: "",
      updated_at: "",
    },
    drivers: [
      { id: DRIVER, company_id: COMPANY, name: "相曽慧", kana: "", is_active: true, royalty_rate: null, mgmt_fee: 15000, rounding_mode: null, phone: "", email: "", bank_info: "", memo: "", sort_order: 1, created_at: "", updated_at: "" },
      { id: DRIVER2, company_id: COMPANY, name: "吉田雅一", kana: "", is_active: false, royalty_rate: 0.125, mgmt_fee: 15000, rounding_mode: "round", phone: "", email: "", bank_info: "", memo: "", sort_order: 2, created_at: "", updated_at: "" },
    ],
    projects: [
      {
        id: PROJECT,
        company_id: COMPANY,
        name: "三郷Amazon",
        client_name: "",
        is_active: true,
        memo: "",
        sort_order: 1,
        created_at: "",
        updated_at: "",
        items: [
          { id: ITEM, company_id: COMPANY, project_id: PROJECT, name: "標準", unit: "day", bill_rate: 23025, pay_rate: 21780, is_active: true, sort_order: 1, created_at: "", updated_at: "" },
          { id: ITEM2, company_id: COMPANY, project_id: PROJECT, name: "旧", unit: "day", bill_rate: 20000, pay_rate: 19000, is_active: false, sort_order: 2, created_at: "", updated_at: "" },
        ],
      },
    ],
    overrides: [{ company_id: COMPANY, driver_id: DRIVER2, project_item_id: ITEM, pay_rate: 21960, created_at: "", updated_at: "" }],
  };

  it("defaultsFor は §2.5 の優先順で自動入力する", () => {
    const a = defaultsFor(masters, DRIVER, ITEM);
    expect(a).toMatchObject({ billRate: 23025, payRate: 21780, royaltyRate: 0.1, roundingMode: "none", payRateSource: "item", royaltySource: "company", roundingSource: "company" });
    const b = defaultsFor(masters, DRIVER2, ITEM);
    expect(b).toMatchObject({ billRate: 23025, payRate: 21960, royaltyRate: 0.125, roundingMode: "round", payRateSource: "override", royaltySource: "driver", roundingSource: "driver" });
    expect(defaultsFor(masters, "nope", ITEM)).toBeNull();
  });

  it("filterActiveMasters は停止中を除き、itemOptions は案件（内容）のラベルを作る", () => {
    const active = filterActiveMasters(masters);
    expect(active.drivers.map((d) => d.id)).toEqual([DRIVER]);
    expect(active.projects[0]?.items.map((i) => i.id)).toEqual([ITEM]);
    expect(itemOptions(active).map((o) => o.label)).toEqual(["三郷Amazon"]);
    expect(itemOptions(masters).map((o) => o.label)).toEqual(["三郷Amazon", "三郷Amazon（旧）"]);
  });
});
