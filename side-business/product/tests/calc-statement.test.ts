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

describe("締めの期間・ルールの上書き・稼働の無い月の定額・経過措置の境目", () => {
  it("締めの期間は締め日で決まる（末締め・20 日締め・2 月）", async () => {
    const { periodOf } = await import("~/server/calc/statement");
    expect(periodOf("2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodOf("2026-10-01", 20)).toEqual({ from: "2026-09-21", to: "2026-10-20" });
    expect(periodOf("2027-01-01", 20)).toEqual({ from: "2026-12-21", to: "2027-01-20" });
    expect(periodOf("2027-03-01", 30)).toEqual({ from: "2027-03-01", to: "2027-03-30" });
    expect(periodOf("2027-02-01", 31)).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("同じ名前のルールは、その人だけのものを使う（全員 10%・青木さんだけ 8%）", () => {
    const input = base();
    input.rules.push({ id: "r9", driverId: "a", name: "ロイヤリティ", kind: "percent", rate: 0.08, amount: null, onlyWhenWorked: true, taxable: true, agreedInWriting: true, active: true, sort: 1 });
    const aoki = buildStatementDrafts(input).find((d) => d.driverId === "a")!;
    const roy = aoki.deductions.filter((x) => x.name === "ロイヤリティ");
    expect(roy).toHaveLength(1);
    expect(roy[0].amount).toBe(29960); // 374,500 × 8%
    const ueda = buildStatementDrafts(input).find((d) => d.driverId === "u")!;
    expect(ueda.deductions.find((x) => x.name === "ロイヤリティ")!.amount).toBe(27600); // 276,000 × 10%
  });

  it("稼働が無くても引く定額（車両リース）がある人は明細ができ、振込額はマイナスになる", () => {
    const input = base();
    input.drivers.push({ id: "e", name: "遠藤 大輔", invoiceRegistered: false, registrationNo: null, isCorporation: false, withholdingCategory: "none", active: true });
    input.rules.push({ id: "r3", driverId: "e", name: "車両リース", kind: "fixed", rate: null, amount: 32000, onlyWhenWorked: false, taxable: true, agreedInWriting: true, active: true, sort: 3 });
    const endo = buildStatementDrafts(input).find((d) => d.driverId === "e")!;
    expect(endo.hasWork).toBe(false);
    expect(endo.deductions.map((x) => x.name)).toEqual(["車両リース"]);
    expect(endo.total).toBe(-35200);
    // 契約の前・終わったあと・辞めた人（無効）・誰も稼働していない月には作らない
    const none = (mut: (i: BuildInput) => void) => {
      const i = structuredClone(input);
      mut(i);
      return buildStatementDrafts(i).find((d) => d.driverId === "e");
    };
    expect(none((i) => (i.drivers[2].startedOn = "2026-11-01"))).toBeUndefined();
    expect(none((i) => (i.drivers[2].endOn = "2026-09-30"))).toBeUndefined();
    expect(none((i) => (i.drivers[2].active = false))).toBeUndefined();
    expect(none((i) => (i.work = []))).toBeUndefined();
    expect(none((i) => (i.drivers[2].startedOn = "2026-10-15"))).toBeDefined();
  });

  it("20 日締めで 9/21〜10/20 の期間は、稼働の日で 80% と 70% に分けて会社の負担を出す", () => {
    const input = base();
    input.tenant = { ...tenant, closingDay: 20 };
    input.work = [
      { driverId: "u", projectId: "p1", qty: 1000, workDate: "2026-09-25" },
      { driverId: "u", projectId: "p1", qty: 1000, workDate: "2026-10-05" },
    ];
    input.adjustments = [];
    const ueda = buildStatementDrafts(input).find((d) => d.driverId === "u")!;
    expect(ueda.period).toEqual({ from: "2026-09-21", to: "2026-10-20" });
    expect(ueda.subtotal + ueda.tax).toBe(330000);
    expect(ueda.burdenParts).toEqual([
      { from: "2026-09-25", to: "2026-09-25", rate: 0.8, base: 165000, burden: 3000 },
      { from: "2026-10-05", to: "2026-10-05", rate: 0.7, base: 165000, burden: 4500 },
    ]);
    expect(ueda.invoiceBurden).toBe(7500);
    expect(ueda.undatedAcrossStep).toBe(false);

    // 日付の無い稼働は期間の末日（70%）で数え、見張り番に知らせる印を立てる
    input.work = [{ driverId: "u", projectId: "p1", qty: 2000 }];
    const undated = buildStatementDrafts(input).find((d) => d.driverId === "u")!;
    expect(undated.invoiceBurden).toBe(9000);
    expect(undated.undatedAcrossStep).toBe(true);

    // 末締めの月はまたがないので、内訳は出さない
    input.tenant = tenant;
    const monthly = buildStatementDrafts(input).find((d) => d.driverId === "u")!;
    expect(monthly.burdenParts).toEqual([]);
    expect(monthly.invoiceBurden).toBe(9000);
  });
});
