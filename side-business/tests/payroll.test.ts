import { describe, expect, it } from "vitest";
import { buildStatement, mergeWork, summarize } from "@/lib/payroll/calc";
import { parseAmount, pct, roundYen, yen } from "@/lib/payroll/money";
import { parseWorkPaste } from "@/lib/payroll/paste";
import { sampleData } from "@/lib/payroll/sample";
import { deductibleRateForExempt, monthEnd, nonDeductibleTax } from "@/lib/payroll/tax";

describe("端数処理と表示", () => {
  it("浮動小数の誤差を消してから丸める", () => {
    expect(roundYen(0.1 + 0.2, "floor")).toBe(0);
    expect(roundYen(1.005 * 1000, "floor")).toBe(1005);
    expect(roundYen(451.5, "round")).toBe(452);
    expect(roundYen(451.5, "floor")).toBe(451);
    expect(roundYen(451.1, "ceil")).toBe(452);
    expect(roundYen(-451.5, "round")).toBe(-452);
    expect(roundYen(-451.5, "floor")).toBe(-451);
    expect(roundYen(-0.4, "round")).toBe(0);
  });

  it("円と率の表示", () => {
    expect(yen(1234567)).toBe("¥1,234,567");
    expect(yen(-5000)).toBe("-¥5,000");
    expect(pct(0.1)).toBe("10%");
    expect(pct(0.105)).toBe("10.5%");
  });

  it("全角・カンマ・円記号を許して数にする", () => {
    expect(parseAmount("１２，３４５円")).toBe(12345);
    expect(parseAmount("¥1,000")).toBe(1000);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("免税の方からの仕入れの経過措置（令和8年度改正後）", () => {
  it("取引日で割合が決まる", () => {
    expect(deductibleRateForExempt("2023-09-30")).toBe(1);
    expect(deductibleRateForExempt("2023-10-01")).toBe(0.8);
    expect(deductibleRateForExempt("2026-09-30")).toBe(0.8);
    expect(deductibleRateForExempt("2026-10-01")).toBe(0.7);
    expect(deductibleRateForExempt("2028-09-30")).toBe(0.7);
    expect(deductibleRateForExempt("2028-10-01")).toBe(0.5);
    expect(deductibleRateForExempt("2030-10-01")).toBe(0.3);
    expect(deductibleRateForExempt("2031-10-01")).toBe(0);
  });

  it("税込 11 万円の支払で会社が負担する消費税", () => {
    expect(nonDeductibleTax(110000, "2026-09-15")).toBe(2000);
    expect(nonDeductibleTax(110000, "2026-10-15")).toBe(3000);
    expect(nonDeductibleTax(110000, "2028-10-15")).toBe(5000);
    expect(nonDeductibleTax(110000, "2030-10-15")).toBe(7000);
    expect(nonDeductibleTax(110000, "2031-10-15")).toBe(10000);
  });

  it("月の末日", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });
});

describe("支払明細", () => {
  const data = sampleData("2026-10");
  const driver = (id: string) => data.drivers.find((d) => d.id === id)!;

  it("登録済みの方：委託料・消費税・控除・調整", () => {
    const st = buildStatement(driver("d1"), data);
    expect(st.lines.map((l) => [l.projectName, l.qty, l.amount])).toEqual([
      ["スポット便", 4, 28000],
      ["宅配（個建て）", 2310, 346500],
    ]);
    expect(st.subtotal).toBe(374500);
    expect(st.tax).toBe(37450);
    expect(st.royalty).toBe(37450);
    expect(st.fee).toBe(15000);
    expect(st.deductionTax).toBe(5245);
    expect(st.adjustmentTotal).toBe(3300);
    expect(st.total).toBe(357555);
  });

  it("免税の方：既定では消費税相当額も払う。払わない設定なら委託料の消費税は 0", () => {
    expect(buildStatement(driver("d3"), data).total).toBe(245740);
    const noTax = { ...data, settings: { ...data.settings, payTaxToExempt: false } };
    const st = buildStatement(driver("d3"), noTax);
    expect(st.tax).toBe(0);
    expect(st.total).toBe(276000 - (27600 + 15000 + 4260) - 11000);
  });

  it("稼働が無い月は管理費を引かない", () => {
    const empty = { ...data, work: data.work.filter((w) => w.driverId !== "d2") };
    const st = buildStatement(driver("d2"), empty);
    expect(st.hasWork).toBe(false);
    expect(st.fee).toBe(0);
    expect(st.total).toBe(0);
  });

  it("端数の出る単価は設定どおりに丸める", () => {
    const d = { ...data, projects: data.projects.map((p) => (p.id === "p1" ? { ...p, payRate: 150.5 } : p)) };
    const st = buildStatement(driver("d3"), { ...d, work: [{ driverId: "d3", projectId: "p1", qty: 3 }], adjustments: [] });
    expect(st.subtotal).toBe(452); // 451.5 を四捨五入
    const floor = { ...d, settings: { ...d.settings, amountRounding: "floor" as const } };
    expect(buildStatement(driver("d3"), { ...floor, work: [{ driverId: "d3", projectId: "p1", qty: 3 }], adjustments: [] }).subtotal).toBe(451);
  });
});

describe("会社の利益", () => {
  it("免税の方への支払で控除できない消費税を利益から引く（原則課税のとき）", () => {
    const sum = summarize(sampleData("2026-10"));
    const d3 = sum.drivers.find((d) => d.driver.id === "d3")!;
    expect(d3.sales).toBe(349600);
    expect(d3.invoiceCost).toBe(8280);
    expect(d3.profit).toBe(349600 - 276000 + 42600 - 8280);
    expect(sum.judgedOn).toBe("2026-10-31");
    expect(sum.profit).toBe(sum.sales - sum.cost + sum.royaltyAndFee - sum.invoiceCost);
    expect(sum.payout).toBe(sum.statements.reduce((a, s) => a + s.total, 0));
  });

  it("9 月分は 80%、簡易課税ならインボイスの負担は出ない", () => {
    const sep = summarize(sampleData("2026-09"));
    expect(sep.drivers.find((d) => d.driver.id === "d3")!.invoiceCost).toBe(5520);
    const simple = sampleData("2026-10");
    simple.settings.taxMethod = "simplified";
    expect(summarize(simple).invoiceCost).toBe(0);
  });

  it("案件別・元請別の粗利は受注と支払の差", () => {
    const sum = summarize(sampleData("2026-10"));
    const p1 = sum.projects.find((p) => p.project.id === "p1")!;
    expect(p1.qty).toBe(2310 + 1840 + 420);
    expect(p1.sales).toBe(4570 * 190);
    expect(p1.cost).toBe(4570 * 150);
    expect(p1.gross).toBe(4570 * 40);
    const clients = Object.fromEntries(sum.clients.map((c) => [c.client, c.gross]));
    expect(clients["A物流"] + clients["B商事"]).toBe(sum.projects.reduce((a, p) => a + p.gross, 0));
  });
});

describe("稼働表の貼り付け", () => {
  const data = sampleData();
  it("見出しを飛ばし、空白の違いを無視して名前を照合する", () => {
    const text = "ドライバー\t案件\t数量\n青木翔太\t宅配（個建て）\t1,200\n井上　美咲\t企業配（日当）\t２０\n";
    const res = parseWorkPaste(text, data.drivers, data.projects);
    expect(res.errors).toEqual([]);
    expect(res.rows).toEqual([
      { driverId: "d1", projectId: "p1", qty: 1200 },
      { driverId: "d2", projectId: "p2", qty: 20 },
    ]);
  });

  it("見つからない名前と数字でない数量を行番号つきで返す", () => {
    const res = parseWorkPaste("山田太郎\t宅配（個建て）\t10\n青木翔太\t謎の案件\tabc", data.drivers, data.projects);
    expect(res.rows).toEqual([]);
    expect(res.errors.map((e) => e.line)).toEqual([1, 2, 2]);
  });

  it("同じドライバー × 案件はまとめる", () => {
    expect(
      mergeWork([
        { driverId: "d1", projectId: "p1", qty: 1.1 },
        { driverId: "d1", projectId: "p1", qty: 2.2 },
        { driverId: "d2", projectId: "p1", qty: 1 },
      ]),
    ).toEqual([
      { driverId: "d1", projectId: "p1", qty: 3.3 },
      { driverId: "d2", projectId: "p1", qty: 1 },
    ]);
  });
});
