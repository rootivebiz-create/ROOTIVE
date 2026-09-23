import { describe, expect, it } from "vitest";
import { buildStatementDrafts, payDateFor, profitOf, type BuildInput } from "~/server/calc/statement";

const tenant: BuildInput["tenant"] = {
  name: "サンプル運送（架空）",
  registrationNo: "T1234567890123",
  taxMethod: "general",
  payTaxToExempt: true,
  taxRounding: "floor",
  amountRounding: "round",
  closingDay: 0,
  payMonthOffset: 1,
  payDay: 25,
};

const base = (): BuildInput => ({
  month: "2026-10-01",
  tenant,
  drivers: [
    { id: "a", name: "青木 翔太", invoiceRegistered: true, registrationNo: "T9876543210987", isCorporation: false, withholdingCategory: "none", active: true },
    { id: "u", name: "上田 健", invoiceRegistered: false, registrationNo: null, isCorporation: false, withholdingCategory: "none", active: true },
  ],
  projects: [
    { id: "p1", name: "宅配（個建て）", clientName: "A物流", unit: "個", billRate: 190, payRate: 150 },
    { id: "p3", name: "スポット便", clientName: "B商事", unit: "件", billRate: 9000, payRate: 7000 },
  ],
  overrides: [],
  rules: [
    { id: "r1", driverId: null, name: "ロイヤリティ", kind: "percent", rate: 0.1, amount: null, onlyWhenWorked: true, taxable: true, agreedInWriting: true, active: true, sort: 1 },
    { id: "r2", driverId: null, name: "管理費", kind: "fixed", rate: null, amount: 15000, onlyWhenWorked: true, taxable: true, agreedInWriting: true, active: true, sort: 2 },
  ],
  work: [
    { driverId: "a", projectId: "p1", qty: 2310 },
    { driverId: "a", projectId: "p3", qty: 4 },
    { driverId: "u", projectId: "p1", qty: 1840 },
  ],
  adjustments: [
    { driverId: "a", label: "駐車場代の立替", amount: 3300, taxable: false, agreedInWriting: true },
    { driverId: "u", label: "車両修理の負担分", amount: -11000, taxable: false, agreedInWriting: true },
  ],
});

describe("支払明細の計算", () => {
  it("サイトのデモと同じ数字になる（青木：357,555円・上田：245,740円）", () => {
    const [a, u] = buildStatementDrafts(base());
    expect(a.driver.name).toBe("上田 健"); // 名前順（あいうえお）
    const aoki = buildStatementDrafts(base()).find((d) => d.driverId === "a")!;
    const ueda = buildStatementDrafts(base()).find((d) => d.driverId === "u")!;
    expect(aoki.subtotal).toBe(374500);
    expect(aoki.tax).toBe(37450);
    expect(aoki.deductionTotal).toBe(37450 + 15000);
    expect(aoki.deductionTax).toBe(5245);
    expect(aoki.total).toBe(357555);
    expect(aoki.isPurchaseStatement).toBe(true);
    expect(aoki.taxLabel).toBe("消費税");
    expect(ueda.total).toBe(245740);
    expect(ueda.taxLabel).toBe("消費税相当額");
    expect(u).toBeDefined();
  });

  it("免税の方への支払で控除できない消費税：10月分は30%（8,280円）", () => {
    const ueda = buildStatementDrafts(base()).find((d) => d.driverId === "u")!;
    expect(ueda.deductibleRate).toBe(0.7);
    expect(ueda.invoiceBurden).toBe(8280);
    expect(profitOf(ueda)).toBe(349600 - 276000 + 27600 + 15000 - 8280);
  });

  it("ドライバーごとの単価があれば、そちらを使う", () => {
    const input = base();
    input.overrides = [{ driverId: "u", projectId: "p1", payRate: 155 }];
    const ueda = buildStatementDrafts(input).find((d) => d.driverId === "u")!;
    expect(ueda.lines[0].rate).toBe(155);
    expect(ueda.subtotal).toBe(1840 * 155);
  });

  it("稼働が無い月は、稼働のある月だけの控除を引かない（調整だけの明細）", () => {
    const input = base();
    input.work = input.work.filter((w) => w.driverId !== "u");
    const ueda = buildStatementDrafts(input).find((d) => d.driverId === "u")!;
    expect(ueda.hasWork).toBe(false);
    expect(ueda.deductionTotal).toBe(0);
    expect(ueda.total).toBe(-11000);
  });

  it("1個あたりの控除と、講師料などの源泉徴収", () => {
    const input = base();
    input.rules.push({ id: "r3", driverId: "a", name: "システム利用料", kind: "per_unit", rate: 2, amount: null, onlyWhenWorked: true, taxable: true, agreedInWriting: false, active: true, sort: 3 });
    input.drivers[0] = { ...input.drivers[0], withholdingCategory: "ko1" };
    const aoki = buildStatementDrafts(input).find((d) => d.driverId === "a")!;
    const sys = aoki.deductions.find((x) => x.name === "システム利用料")!;
    expect(sys.amount).toBe((2310 + 4) * 2);
    expect(sys.agreedInWriting).toBe(false);
    expect(aoki.withholding?.amount).toBe(Math.floor((374500 * 1021) / 10000));
  });

  it("支払日：翌月25日・翌々月末・月に無い日は末日", () => {
    expect(payDateFor("2026-10-01", { payMonthOffset: 1, payDay: 25 })).toBe("2026-11-25");
    expect(payDateFor("2026-11-01", { payMonthOffset: 2, payDay: 0 })).toBe("2027-01-31");
    expect(payDateFor("2026-12-01", { payMonthOffset: 2, payDay: 31 })).toBe("2027-02-28");
  });
});
