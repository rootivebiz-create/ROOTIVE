import { describe, expect, it } from "vitest";
import { driverInputSchema, reorderInputSchema, type DriverFormInput } from "@/lib/schemas/drivers";
import { projectInputSchema, type ProjectFormInput } from "@/lib/schemas/projects";

const UUID1 = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

const baseDriver: DriverFormInput = {
  id: null,
  name: " 相曽慧 ",
  kana: "あいそ けい",
  is_active: true,
  royalty_rate: "１０",
  mgmt_fee: "14,999",
  rounding_mode: "",
  phone: "",
  email: "",
  bank_info: "",
  memo: "",
  overrides: [
    { project_item_id: UUID1, bill_rate: "", pay_rate: "21,780" },
    { project_item_id: UUID2, bill_rate: "23,500", pay_rate: "" },
  ],
  recurring: [{ id: null, label: "リース代", amount: "-30,000", count_as_profit: true, is_active: true }],
};

describe("driverInputSchema", () => {
  it("文字列入力を正規化する（全角・カンマ・%→率・空欄→null）", () => {
    const out = driverInputSchema.parse(baseDriver);
    expect(out.name).toBe("相曽慧");
    expect(out.royalty_rate).toBe(0.1);
    expect(out.mgmt_fee).toBe(14999);
    expect(out.rounding_mode).toBeNull();
    expect(out.overrides[0].pay_rate).toBe(21780);
    expect(out.overrides[1].pay_rate).toBeNull();
    expect(out.recurring[0].amount).toBe(-30000);
  });

  it("会社設定に従う（率 null・端数処理 null）を受け付ける", () => {
    const out = driverInputSchema.parse({ ...baseDriver, royalty_rate: null, rounding_mode: "" });
    expect(out.royalty_rate).toBeNull();
    expect(out.rounding_mode).toBeNull();
    const out2 = driverInputSchema.parse({ ...baseDriver, rounding_mode: "floor" });
    expect(out2.rounding_mode).toBe("floor");
  });

  it("川島幹太のような 支払 0・率 0%・管理費 0 は正常", () => {
    const out = driverInputSchema.parse({ ...baseDriver, royalty_rate: "0", mgmt_fee: "0", overrides: [{ project_item_id: UUID1, pay_rate: "0" }] });
    expect(out.royalty_rate).toBe(0);
    expect(out.mgmt_fee).toBe(0);
    expect(out.overrides[0].pay_rate).toBe(0);
  });

  it("不正値を拒否する（率 > 100%・管理費マイナス・名前空・固定控除の項目名空）", () => {
    expect(driverInputSchema.safeParse({ ...baseDriver, royalty_rate: "120" }).success).toBe(false);
    expect(driverInputSchema.safeParse({ ...baseDriver, mgmt_fee: "-1" }).success).toBe(false);
    expect(driverInputSchema.safeParse({ ...baseDriver, name: "  " }).success).toBe(false);
    expect(driverInputSchema.safeParse({ ...baseDriver, royalty_rate: "" }).success).toBe(false);
    expect(driverInputSchema.safeParse({ ...baseDriver, email: "not-an-email" }).success).toBe(false);
    const bad = driverInputSchema.safeParse({ ...baseDriver, recurring: [{ id: null, label: "", amount: "-1", count_as_profit: false, is_active: true }] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(["recurring", 0, "label"]);
  });
});

describe("projectInputSchema", () => {
  const base: ProjectFormInput = {
    id: null,
    name: "和光ヤマト",
    client_name: "ヤマト運輸",
    is_active: true,
    memo: "",
    items: [
      { id: null, name: "宅急便", unit: "piece", bill_rate: "180", pay_rate: "162", is_active: true },
      { id: UUID1, name: "", unit: "piece", bill_rate: "50", pay_rate: "50", is_active: true },
    ],
  };

  it("内容名の空欄は「標準」になり、単価は正規化される", () => {
    const out = projectInputSchema.parse(base);
    expect(out.items[1].name).toBe("標準");
    expect(out.items[0].bill_rate).toBe(180);
    expect(out.items[0].pay_rate).toBe(162);
  });

  it("支払 > 受注 は保存可（警告のみ）", () => {
    const out = projectInputSchema.parse({ ...base, items: [{ id: null, name: "標準", unit: "day", bill_rate: "20000", pay_rate: "21000", is_active: true }] });
    expect(out.items[0].pay_rate).toBe(21000);
  });

  it("内容 0 件・内容名の重複・小数 3 桁を拒否する", () => {
    expect(projectInputSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    const dup = projectInputSchema.safeParse({ ...base, items: [base.items[0], { ...base.items[1], name: "宅急便" }] });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.error.issues[0].path).toEqual(["items", 1, "name"]);
    expect(projectInputSchema.safeParse({ ...base, items: [{ ...base.items[0], bill_rate: "1.234" }] }).success).toBe(false);
  });
});

describe("reorderInputSchema", () => {
  it("id と方向を検証する", () => {
    expect(reorderInputSchema.parse({ id: UUID1, direction: "up" })).toEqual({ id: UUID1, direction: "up" });
    expect(reorderInputSchema.safeParse({ id: "x", direction: "up" }).success).toBe(false);
    expect(reorderInputSchema.safeParse({ id: UUID1, direction: "left" }).success).toBe(false);
  });
});
