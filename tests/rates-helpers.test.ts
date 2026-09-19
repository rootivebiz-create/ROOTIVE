import { describe, expect, it } from "vitest";
import {
  buildAllRows,
  buildDriverRows,
  buildItemRows,
  changedRows,
  driverOptions,
  effectiveRates,
  filterDiffs,
  hasOverrideValue,
  initialValue,
  isRowChanged,
  itemOptions,
  rowErrorsFromFieldErrors,
  rowKey,
  summarizeDiff,
  summarizeDiffs,
  toRateMasters,
  toSaveRow,
  type RateMasters,
} from "@/components/settings/rates/helpers";
import type { Masters, RateDiff } from "@/lib/db/types";

const COMPANY = "00000000-0000-4000-8000-000000000000";
const DRIVER = "11111111-1111-4111-8111-111111111111";
const DRIVER2 = "22222222-2222-4222-8222-222222222222";
const DRIVER3 = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const PROJECT2 = "55555555-5555-4555-8555-555555555555";
const ITEM = "66666666-6666-4666-8666-666666666666";
const ITEM2 = "77777777-7777-4777-8777-777777777777";
const ITEM3 = "88888888-8888-4888-8888-888888888888";

/** loadMasters と同じ形（数値は DB からの生の値を想定） */
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
  drivers: [
    { id: DRIVER, company_id: COMPANY, name: "相曽慧", kana: "", is_active: true, royalty_rate: null, mgmt_fee: 15000, rounding_mode: null, phone: "", email: "", bank_info: "", memo: "", sort_order: 1, tax_mode: "taxable", invoice_reg_no: "", payout_month_offset: null, payout_day: null, line_user_id: "", line_linked_at: null, created_at: "", updated_at: "" },
    { id: DRIVER2, company_id: COMPANY, name: "吉田雅一", kana: "", is_active: false, royalty_rate: 0.125, mgmt_fee: 15000, rounding_mode: "round", phone: "", email: "", bank_info: "", memo: "", sort_order: 2, tax_mode: "taxable", invoice_reg_no: "", payout_month_offset: null, payout_day: null, line_user_id: "", line_linked_at: null, created_at: "", updated_at: "" },
    { id: DRIVER3, company_id: COMPANY, name: "停止太郎", kana: "", is_active: false, royalty_rate: null, mgmt_fee: 0, rounding_mode: null, phone: "", email: "", bank_info: "", memo: "", sort_order: 3, tax_mode: "taxable", invoice_reg_no: "", payout_month_offset: null, payout_day: null, line_user_id: "", line_linked_at: null, created_at: "", updated_at: "" },
  ],
  projects: [
    {
      id: PROJECT,
      company_id: COMPANY,
      name: "三郷Amazon",
      client_name: "Amazon",
      client_id: null,
      target_margin: null,
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
    {
      id: PROJECT2,
      company_id: COMPANY,
      name: "ヤマト",
      client_name: "",
      client_id: null,
      target_margin: null,
      is_active: false,
      memo: "",
      sort_order: 2,
      created_at: "",
      updated_at: "",
      items: [{ id: ITEM3, company_id: COMPANY, project_id: PROJECT2, name: "標準", unit: "piece", bill_rate: 200, pay_rate: 180, is_active: true, sort_order: 1, created_at: "", updated_at: "" }],
    },
  ],
  overrides: [
    // 停止中ドライバー × 稼働中内容：支払だけ個別
    { company_id: COMPANY, driver_id: DRIVER2, project_item_id: ITEM, pay_rate: 21960, bill_rate: null, created_at: "", updated_at: "" },
    // 稼働中ドライバー × 停止中内容：受注だけ個別
    { company_id: COMPANY, driver_id: DRIVER, project_item_id: ITEM2, pay_rate: null, bill_rate: 20500, created_at: "", updated_at: "" },
  ],
};

const rm: RateMasters = toRateMasters(masters);

function diff(over: Partial<RateDiff> = {}): RateDiff {
  return {
    entry_id: "e1",
    driver_id: DRIVER,
    driver_name: "相曽慧",
    project_id: PROJECT,
    project_item_id: ITEM,
    project_name: "三郷Amazon",
    item_name: "標準",
    qty: 20,
    bill_rate: 23025,
    pay_rate: 21780,
    royalty_rate: 0.1,
    rounding_mode: "none",
    master_bill_rate: 23025,
    master_pay_rate: 21780,
    master_royalty_rate: 0.1,
    master_rounding_mode: "none",
    ...over,
  };
}

describe("ドライバー別単価のヘルパー", () => {
  it("選択肢：稼働中が先、停止中は末尾に「（停止中）」付き", () => {
    expect(driverOptions(rm).map((o) => o.label)).toEqual(["相曽慧", "吉田雅一（停止中）", "停止太郎（停止中）"]);
    // 案件が停止中なら内容も停止中扱い
    expect(itemOptions(rm).map((o) => o.label)).toEqual(["三郷Amazon", "三郷Amazon（旧）（停止中）", "ヤマト（停止中）"]);
    expect(itemOptions(rm).map((o) => o.isActive)).toEqual([true, false, false]);
  });

  it("buildDriverRows：稼働中の内容 ＋ 個別単価がある停止中の内容を案件ごとにグループ化する", () => {
    const groups = buildDriverRows(rm, DRIVER);
    // ヤマト（停止中・個別なし）は出ない
    expect(groups.map((g) => g.name)).toEqual(["三郷Amazon"]);
    const rows = groups[0].rows;
    expect(rows.map((r) => r.label)).toEqual(["三郷Amazon", "三郷Amazon（旧）"]);
    expect(rows[0]).toMatchObject({ key: rowKey(DRIVER, ITEM), driverId: DRIVER, itemId: ITEM, unit: "day", isActive: true, stdBill: 23025, stdPay: 21780, overrideBill: null, overridePay: null });
    expect(rows[1]).toMatchObject({ isActive: false, stdBill: 20000, stdPay: 19000, overrideBill: 20500, overridePay: null });
    // 個別単価が無い停止中ドライバーでも稼働中の内容は出る（新規設定できる）
    expect(buildDriverRows(rm, DRIVER3)[0].rows.map((r) => r.itemId)).toEqual([ITEM]);
    expect(buildDriverRows(rm, "nope")).toEqual([]);
  });

  it("buildItemRows：稼働中ドライバー ＋ 個別単価がある停止中ドライバー（停止太郎は出ない）", () => {
    const rows = buildItemRows(rm, ITEM);
    expect(rows.map((r) => r.label)).toEqual(["相曽慧", "吉田雅一"]);
    expect(rows[1]).toMatchObject({ isActive: false, overrideBill: null, overridePay: 21960, stdBill: 23025 });
    expect(buildItemRows(rm, "nope")).toEqual([]);
    // buildAllRows は全ドライバー分をまとめる
    expect(buildAllRows(rm).map((r) => r.key)).toEqual([rowKey(DRIVER, ITEM), rowKey(DRIVER, ITEM2), rowKey(DRIVER2, ITEM), rowKey(DRIVER3, ITEM)]);
  });

  it("変更検出：全角・カンマは同じ値、空欄は標準、数値でない入力は変更あり", () => {
    const [row] = buildItemRows(rm, ITEM).filter((r) => r.driverId === DRIVER2); // 支払 21960 の個別
    expect(initialValue(row)).toEqual({ bill: "", pay: "21960" });
    expect(isRowChanged(row, { bill: "", pay: "21,960" })).toBe(false);
    expect(isRowChanged(row, { bill: "", pay: "２１９６０" })).toBe(false);
    expect(isRowChanged(row, { bill: "23500", pay: "21960" })).toBe(true);
    expect(isRowChanged(row, { bill: "", pay: "" })).toBe(true); // 標準に戻す
    expect(isRowChanged(row, { bill: "", pay: "abc" })).toBe(true); // サーバーで検証エラーになる
    expect(hasOverrideValue({ bill: "", pay: " " })).toBe(false);
    expect(hasOverrideValue({ bill: "1", pay: "" })).toBe(true);

    const rows = buildAllRows(rm);
    const values = { [rowKey(DRIVER, ITEM)]: { bill: "", pay: "" }, [rowKey(DRIVER2, ITEM)]: { bill: "", pay: "" }, [rowKey(DRIVER3, ITEM)]: undefined };
    const changed = changedRows(rows, values);
    expect(changed.map((c) => c.row.key)).toEqual([rowKey(DRIVER2, ITEM)]); // 元々標準の行を空欄のままにしても変更なし
    expect(toSaveRow(changed[0].row, changed[0].value)).toEqual({ driver_id: DRIVER2, project_item_id: ITEM, bill_rate: "", pay_rate: "" });

    const errs = rowErrorsFromFieldErrors({ "rows.0.pay_rate": ["数値を入力してください"], "rows.1.bill_rate": ["0 以上で入力してください"], rows: ["x"] }, ["a", "b"]);
    expect(errs).toEqual({ a: { pay: "数値を入力してください" }, b: { bill: "0 以上で入力してください" } });
  });

  it("実効値と赤字判定：支払 > 受注 のみ赤字（支払 0 は正常）", () => {
    const [row] = buildItemRows(rm, ITEM);
    expect(effectiveRates(row, { bill: "", pay: "" })).toEqual({ bill: 23025, pay: 21780, diff: 1245, isLoss: false });
    expect(effectiveRates(row, { bill: "", pay: "0" })).toMatchObject({ pay: 0, diff: 23025, isLoss: false });
    expect(effectiveRates(row, { bill: "20,000", pay: "" })).toMatchObject({ bill: 20000, diff: -1780, isLoss: true });
  });

  it("差分：選択中のドライバー／内容で絞り、要約文字列を作る", () => {
    const diffs = [
      diff({ entry_id: "e1", master_bill_rate: 23500 }),
      diff({ entry_id: "e2", driver_id: DRIVER2, driver_name: "吉田雅一", pay_rate: 21960, master_pay_rate: 22000, royalty_rate: 0.1, master_royalty_rate: 0.125, rounding_mode: "none", master_rounding_mode: "round" }),
      diff({ entry_id: "e3", project_item_id: ITEM2, item_name: "旧", bill_rate: 20000, master_bill_rate: 20500 }),
    ];
    expect(filterDiffs(diffs, "driver", DRIVER).map((d) => d.entry_id)).toEqual(["e1", "e3"]);
    expect(filterDiffs(diffs, "item", ITEM).map((d) => d.entry_id)).toEqual(["e1", "e2"]);
    expect(filterDiffs(diffs, "driver", "")).toEqual([]);
    expect(summarizeDiff(diffs[0])).toBe("相曽慧／三郷Amazon：受注 ¥23,025 → ¥23,500");
    expect(summarizeDiff(diffs[1])).toBe("吉田雅一／三郷Amazon：支払 ¥21,960 → ¥22,000、率 10.0% → 12.5%、端数処理 丸めない → 四捨五入");
    expect(summarizeDiff(diffs[2])).toBe("相曽慧／三郷Amazon（旧）：受注 ¥20,000 → ¥20,500");
    const many = Array.from({ length: 7 }, (_, i) => diff({ entry_id: `e${i}`, master_bill_rate: 23500 }));
    expect(summarizeDiffs(many)).toMatchObject({ rest: 2 });
    expect(summarizeDiffs(many).lines).toHaveLength(5);
  });
});
