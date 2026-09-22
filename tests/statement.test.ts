/**
 * 支払明細データの組み立て（lib/statement）：消費税・ドライバー個別の支払日・登録番号・ロゴ／認印のパス・テキスト出力
 * 税の値は集計ビュー（v_driver_month_summary）の値をそのまま使い、ビューに行が無いときだけ現在の設定で計算する
 */
import { describe, expect, it } from "vitest";
import { buildStatementData, resolvePayoutDate, statementToText, type StatementData, type StatementDriverSettings } from "@/lib/statement";
import type { Adjustment, Company, DriverMonthSummary, WorkEntryCalc } from "@/lib/db/types";

const company: Company = {
  id: "c1",
  name: "株式会社ROOTIVE",
  rounding_mode: "none",
  default_royalty_rate: 0.1,
  default_mgmt_fee: 15000,
  payout_month_offset: 1,
  payout_day: 0,
  statement_note: "ご不明な点はお問い合わせください。",
  invoice_reg_no: "T1234567890123",
  address: "埼玉県三郷市",
  tel: "048-000-0000",
  driver_portal_show_royalty: true,
  driver_portal_show_open_month: true,
  yayoi_accounts: {},
  tax_rate: 0.1,
  tax_rounding: "floor",
  fiscal_month: 3,
  fb_consignor_code: "",
  fb_consignor_kana: "",
  fb_bank_code: "",
  fb_bank_name: "",
  fb_branch_code: "",
  fb_branch_name: "",
  fb_account_type: null,
  fb_account_number: "",
  labor_duty_limit_minutes: 780,
  labor_duty_max_minutes: 900,
  labor_rest_target_minutes: 660,
  labor_rest_min_minutes: 540,
  labor_month_duty_minutes: 17040,
  labor_max_consecutive_days: 13,
  retention_daily_years: 1,
  retention_instruction_years: 3,
  retention_incident_years: 3,
  retention_roster_years: 3,
  aptitude_age_from: 65,
  aptitude_age_years: 3,
  health_check_months: 12,
  logo_path: "c1/logo-20260916T000000Z.png",
  seal_path: null,
  confidential_scope: { loans: "admin", cash: "admin", bank_account: "admin" },
  created_at: "",
  updated_at: "",
};

// 相曽慧 2026-09：稼働 457,380、ロイヤリティ 45,738、管理費 14,999、調整 −3,000／+2,000
// 税抜小計 396,643、消費税 39,664（切り捨て）、税抜支払額 395,643、税込支払額 435,307
const summary: DriverMonthSummary = {
  company_id: "c1",
  month: "2026-09-01",
  driver_id: "d1",
  driver_name: "相曽慧",
  driver_sort_order: 1,
  driver_is_active: true,
  driver_default_mgmt_fee: 15000,
  driver_month_id: "dm1",
  memo: "社内メモ",
  entry_count: 1,
  active_entry_count: 1,
  bill: 483525,
  pay: 457380,
  margin: 26145,
  royalty: 45738,
  mgmt_fee_setting: 14999,
  mgmt_fee: 14999,
  adjustment_count: 2,
  adj_pay: -1000,
  adj_profit: 3000,
  payout: 395643,
  driver_profit: 89882,
  is_closed: true,
  tax_mode: "taxable",
  tax_rate: 0.1,
  tax_rounding: "floor",
  tax_base: 396643,
  tax: 39664,
  payout_incl: 435307,
};

const entry: WorkEntryCalc = {
  id: "e1",
  company_id: "c1",
  month: "2026-09-01",
  driver_id: "d1",
  project_item_id: "i1",
  project_id: "p1",
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
  created_at: "",
  updated_at: "",
  bill: 483525,
  pay: 457380,
  margin: 26145,
  royalty: 45738,
  entry_profit: 71883,
};

const adjustments: Adjustment[] = [
  { id: "a1", company_id: "c1", driver_month_id: "dm1", label: "リース代", amount: -3000, count_as_profit: true, recurring_id: null, sort_order: 0, created_at: "", updated_at: "" },
  { id: "a2", company_id: "c1", driver_month_id: "dm1", label: "立替精算", amount: 2000, count_as_profit: false, recurring_id: null, sort_order: 1, created_at: "", updated_at: "" },
];

const driver: { id: string; name: string; mgmt_fee: number } & StatementDriverSettings = {
  id: "d1",
  name: "相曽慧",
  mgmt_fee: 15000,
  invoice_reg_no: "T9876543210987",
  tax_mode: "taxable",
  payout_month_offset: null,
  payout_day: null,
};

function build(over: { company?: Partial<Company>; driver?: Partial<typeof driver>; summary?: DriverMonthSummary | null } = {}): StatementData {
  return buildStatementData({
    company: { ...company, ...over.company },
    month: "2026-09",
    driver: { ...driver, ...over.driver },
    summary: over.summary === undefined ? summary : over.summary,
    entries: [entry],
    adjustments,
  });
}

describe("buildStatementData", () => {
  it("税の値は集計ビューの値をそのまま使う（会社の現在の税率・端数処理が違っても再計算しない）", () => {
    const s = build({ company: { tax_rate: 0.08, tax_rounding: "round" } });
    expect(s.taxMode).toBe("taxable");
    expect(s.taxRate).toBe(0.1);
    expect(s.taxRounding).toBe("floor");
    expect(s.taxRateLabel).toBe("10%");
    expect(s.taxBase).toBe(396643);
    expect(s.tax).toBe(39664);
    expect(s.payout).toBe(395643);
    expect(s.payoutIncl).toBe(435307);
    expect(s.adjPay).toBe(-1000);
  });

  it("登録番号・ロゴ／認印のパス・会社の支払日を引き継ぐ", () => {
    const s = build();
    expect(s.driverInvoiceRegNo).toBe("T9876543210987");
    expect(s.company.invoice_reg_no).toBe("T1234567890123");
    expect(s.company.logo_path).toBe("c1/logo-20260916T000000Z.png");
    expect(s.company.seal_path).toBeNull();
    expect(s.payoutDate).toBe("2026-10-31");
    expect(s.payoutDateLabel).toBe("2026年10月31日");
    expect(s.payoutDateIsDriverSpecific).toBe(false);
    expect(s.driverName).toBe("相曽慧");
    expect(s.monthLabel).toBe("2026年9月");
    expect(s.entries[0]).toMatchObject({ projectName: "三郷Amazon", qty: 21, payRate: 21780, pay: 457380 });
    expect(s.adjustments.map((a) => a.label)).toEqual(["リース代", "立替精算"]);
  });

  it("ドライバーに登録番号・課税区分・支払日が無ければ既定（空文字・課税・会社設定）", () => {
    const s = buildStatementData({ company, month: "2026-09", driver: { id: "d1", name: "相曽慧", mgmt_fee: 15000 }, summary, entries: [entry], adjustments });
    expect(s.driverInvoiceRegNo).toBe("");
    expect(s.taxMode).toBe("taxable");
    expect(s.payoutDateIsDriverSpecific).toBe(false);
    expect(s.payoutDate).toBe("2026-10-31");
  });

  it("ビューに行が無ければ現在の設定（ドライバーの課税区分・会社の税率と端数処理）で計算し、金額は 0", () => {
    const s = build({ summary: null, company: { tax_rate: 0.08, tax_rounding: "round" } });
    expect(s.taxMode).toBe("taxable");
    expect(s.taxRate).toBe(0.08);
    expect(s.taxRounding).toBe("round");
    expect(s.taxRateLabel).toBe("8%");
    expect(s.pay).toBe(0);
    expect(s.taxBase).toBe(0);
    expect(s.tax).toBe(0);
    expect(s.payout).toBe(0);
    expect(s.payoutIncl).toBe(0);
    expect(s.isClosed).toBe(false);
    expect(s.driverMonthId).toBeNull();
    expect(s.mgmtFeeSetting).toBe(15000);
    const ex = build({ summary: null, driver: { tax_mode: "exempt" } });
    expect(ex.taxMode).toBe("exempt");
    expect(ex.tax).toBe(0);
  });

  it("ドライバー個別の支払日（月・日の両方）があればそれを使う。片方だけなら会社設定", () => {
    const s = build({ driver: { payout_month_offset: 2, payout_day: 15 } });
    expect(s.payoutDate).toBe("2026-11-15");
    expect(s.payoutDateLabel).toBe("2026年11月15日");
    expect(s.payoutDateIsDriverSpecific).toBe(true);
    const half = build({ driver: { payout_month_offset: 2, payout_day: null } });
    expect(half.payoutDate).toBe("2026-10-31");
    expect(half.payoutDateIsDriverSpecific).toBe(false);
    const eom = build({ driver: { payout_month_offset: 0, payout_day: 0 } });
    expect(eom.payoutDate).toBe("2026-09-30");
    expect(eom.payoutDateIsDriverSpecific).toBe(true);
  });

  it("非課税（exempt）は消費税 0・税込支払額 = 税抜支払額（ビューの値）", () => {
    const s = build({ summary: { ...summary, tax_mode: "exempt", tax: 0, payout_incl: 395643 }, driver: { tax_mode: "exempt" } });
    expect(s.taxMode).toBe("exempt");
    expect(s.taxBase).toBe(396643);
    expect(s.tax).toBe(0);
    expect(s.payoutIncl).toBe(395643);
    expect(s.payoutIncl).toBe(s.payout);
  });
});

describe("statementToText", () => {
  it("課税：稼働 → 控除 → 小計（税抜）→ 消費税 → 調整（税込）→ お支払額（税込）→ 振込予定日 → 備考 の順", () => {
    const text = statementToText(build());
    const lines = text.split("\n");
    const at = (needle: string) => {
      const i = lines.findIndex((l) => l === needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(lines[0]).toBe("【2026年9月 支払明細】");
    expect(lines[1]).toBe("相曽慧 様");
    expect(lines[2]).toBe("株式会社ROOTIVE");
    const order = [
      at("■ 稼働"),
      at("・三郷Amazon：21日 × ¥21,780 ＝ ¥457,380"),
      at("稼働小計：¥457,380"),
      at("■ 控除"),
      at("・ロイヤリティ（10.0%）：-¥45,738"),
      at("・管理費：-¥14,999"),
      at("小計（税抜）：¥396,643"),
      at("消費税（10%）：¥39,664"),
      at("■ 調整（税込）"),
      at("・リース代：-¥3,000"),
      at("・立替精算：+¥2,000"),
      at("■ お支払額（税込）：¥435,307"),
      at("振込予定日：2026年10月31日"),
      at("ご不明な点はお問い合わせください。"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain("会社利益");
    expect(text).not.toContain("483,525");
    expect(text).not.toContain("社内メモ");
  });

  it("非課税：消費税の行を出さず「■ お支払額：」。調整が無ければ「■ 調整（税込）」も出さない", () => {
    const s = build({ summary: { ...summary, tax_mode: "exempt", tax: 0, payout_incl: 395643, adj_pay: 0 }, driver: { tax_mode: "exempt" } });
    const text = statementToText({ ...s, adjustments: [] });
    expect(text).toContain("小計（税抜）：¥396,643");
    expect(text).not.toContain("消費税");
    expect(text).not.toContain("■ 調整（税込）");
    expect(text).toContain("■ お支払額：¥395,643");
  });

  it("ロイヤリティ率を隠せる（ドライバー向け）", () => {
    const text = statementToText(build(), { showRoyaltyRate: false });
    expect(text).toContain("・ロイヤリティ：-¥45,738");
    expect(text).not.toContain("10.0%");
  });
});

describe("resolvePayoutDate", () => {
  const co = { payout_month_offset: 1, payout_day: 0 };

  it("ドライバー設定が無ければ会社設定（翌月末）", () => {
    expect(resolvePayoutDate("2026-09", co, null)).toEqual({ date: "2026-10-31", isDriverSpecific: false });
    expect(resolvePayoutDate("2026-09", co, undefined)).toEqual({ date: "2026-10-31", isDriverSpecific: false });
    expect(resolvePayoutDate("2026-09", co, { payout_month_offset: null, payout_day: null })).toEqual({ date: "2026-10-31", isDriverSpecific: false });
  });

  it("月・日の両方が設定されていればドライバー個別（0 = 末日、月末超過は末日に丸める）", () => {
    expect(resolvePayoutDate("2026-09", co, { payout_month_offset: 2, payout_day: 15 })).toEqual({ date: "2026-11-15", isDriverSpecific: true });
    expect(resolvePayoutDate("2026-09", co, { payout_month_offset: 0, payout_day: 0 })).toEqual({ date: "2026-09-30", isDriverSpecific: true });
    expect(resolvePayoutDate("2026-01", co, { payout_month_offset: 1, payout_day: 31 })).toEqual({ date: "2026-02-28", isDriverSpecific: true });
  });

  it("片方だけの設定は無視して会社設定", () => {
    expect(resolvePayoutDate("2026-09", co, { payout_month_offset: 2, payout_day: null })).toEqual({ date: "2026-10-31", isDriverSpecific: false });
    expect(resolvePayoutDate("2026-09", co, { payout_month_offset: null, payout_day: 15 })).toEqual({ date: "2026-10-31", isDriverSpecific: false });
  });
});
