/**
 * 請求書：データの組み立て（lib/invoice）・CSV（lib/exports/invoices-csv）・スキーマ（lib/schemas/clients, lib/schemas/invoices）
 * 金額は DB（invoices / invoice_items のトリガー）が計算した値をそのまま使う想定で、ここでは計算しない。
 */
import { describe, expect, it } from "vitest";
import { buildInvoiceData, invoicePdfFilename, invoiceUnpaid, itemUnitLabel } from "@/lib/invoice";
import { INVOICES_CSV_HEADERS, invoiceToCsvRow, invoicesToCsv, type InvoiceCsvSource } from "@/lib/exports/invoices-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import { clientInputSchema, paymentRuleLabel, type ClientFormInput } from "@/lib/schemas/clients";
import { buildInvoiceInputSchema, invoiceInputSchema, invoiceItemsInputSchema, invoiceStatusInputSchema } from "@/lib/schemas/invoices";
import type { Client, Company, Invoice, InvoiceItem } from "@/lib/db/types";

const UUID1 = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

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
  logo_path: "c1/logo-20260916T000000Z.png",
  seal_path: null,
  confidential_scope: { loans: "admin", cash: "admin", bank_account: "admin" },
  created_at: "",
  updated_at: "",
};

const client: Client = {
  id: "cl1",
  company_id: "c1",
  name: "株式会社三郷物流",
  honorific: "御中",
  address: "埼玉県三郷市中央 1-1-1",
  tel: "048-111-2222",
  invoice_reg_no: "T9876543210987",
  payment_month_offset: 1,
  payment_day: 0,
  memo: "請求書は月末締め翌月末払い",
  is_active: true,
  sort_order: 1,
  created_at: "",
  updated_at: "",
};

// 小計 483,525／消費税 48,352（切り捨て）／合計 531,877
const invoice: Invoice = {
  id: "inv1",
  company_id: "c1",
  client_id: "cl1",
  month: "2026-09-01",
  invoice_no: "202609-01",
  status: "issued",
  issue_date: "2026-09-30",
  due_date: "2026-10-31",
  subtotal: 483525,
  tax_rate: 0.1,
  tax_rounding: "floor",
  tax: 48352,
  total: 531877,
  paid_on: null,
  note: "お振込先：みずほ銀行 三郷支店 普通 1234567",
  created_by: null,
  created_at: "",
  updated_at: "",
};

function item(patch: Partial<InvoiceItem>): InvoiceItem {
  return {
    id: "it1",
    company_id: "c1",
    invoice_id: "inv1",
    project_id: null,
    project_item_id: null,
    name: "三郷Amazon",
    unit: "day",
    qty: 21,
    unit_price: 23025,
    amount: 483525,
    sort_order: 1,
    created_at: "",
    updated_at: "",
    ...patch,
  };
}

describe("buildInvoiceData", () => {
  it("稼動月・状態・日付のラベルを日本語で作る", () => {
    const d = buildInvoiceData({ company, client, invoice, items: [item({})] });
    expect(d.month).toBe("2026-09");
    expect(d.monthLabel).toBe("2026年9月");
    expect(d.statusLabel).toBe("発行済み");
    expect(d.issueDateLabel).toBe("2026年9月30日");
    expect(d.dueDateLabel).toBe("2026年10月31日");
    expect(d.taxRateLabel).toBe("10%");
    expect(d.client.paymentRuleLabel).toBe("翌月末日");
  });

  it("金額は DB の値をそのまま使う（ここでは計算しない）", () => {
    const d = buildInvoiceData({ company, client, invoice, items: [item({})] });
    expect(d.subtotal).toBe(483525);
    expect(d.tax).toBe(48352);
    expect(d.total).toBe(531877);
    // 明細の金額もトリガーが計算した amount をそのまま出す
    expect(d.items[0].amount).toBe(483525);
  });

  it("明細は sort_order 順に並ぶ", () => {
    const d = buildInvoiceData({
      company,
      client,
      invoice,
      items: [
        item({ id: "b", name: "越谷ヤマト", sort_order: 2, unit: "piece", qty: 1200, unit_price: 180, amount: 216000 }),
        item({ id: "a", name: "三郷Amazon", sort_order: 1 }),
      ],
    });
    expect(d.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(d.items[1].unit).toBe("piece");
    expect(d.items[1].qty).toBe(1200);
  });

  it("入金予定日が未設定なら dueDateLabel は null、入金済みなら入金日を持つ", () => {
    const none = buildInvoiceData({ company, client, invoice: { ...invoice, due_date: null }, items: [] });
    expect(none.dueDate).toBeNull();
    expect(none.dueDateLabel).toBeNull();
    const paid = buildInvoiceData({ company, client, invoice: { ...invoice, status: "paid", paid_on: "2026-10-30" }, items: [] });
    expect(paid.statusLabel).toBe("入金済み");
    expect(paid.paidOnLabel).toBe("2026年10月30日");
  });

  it("会社・取引先の情報（住所・電話・登録番号・ロゴ／認印のパス）を持つ", () => {
    const d = buildInvoiceData({ company, client, invoice, items: [] });
    expect(d.company.name).toBe("株式会社ROOTIVE");
    expect(d.company.invoiceRegNo).toBe("T1234567890123");
    expect(d.company.logoPath).toBe("c1/logo-20260916T000000Z.png");
    expect(d.company.sealPath).toBeNull();
    expect(d.client.name).toBe("株式会社三郷物流");
    expect(d.client.honorific).toBe("御中");
    expect(d.client.invoiceRegNo).toBe("T9876543210987");
  });

  it("明細が 0 件でも組み立てられる", () => {
    const d = buildInvoiceData({ company, client, invoice: { ...invoice, subtotal: 0, tax: 0, total: 0 }, items: [] });
    expect(d.items).toEqual([]);
    expect(d.total).toBe(0);
  });
});

describe("表示ヘルパー", () => {
  it("単位のラベル（日給→日／個数→個／未設定→空）", () => {
    expect(itemUnitLabel("day")).toBe("日");
    expect(itemUnitLabel("piece")).toBe("個");
    expect(itemUnitLabel(null)).toBe("");
  });

  it("未入金の金額は入金済みなら 0", () => {
    expect(invoiceUnpaid({ status: "issued", total: 531877 })).toBe(531877);
    expect(invoiceUnpaid({ status: "draft", total: 531877 })).toBe(531877);
    expect(invoiceUnpaid({ status: "paid", total: 531877 })).toBe(0);
  });

  it("PDF のファイル名は 請求書_稼動月_取引先名.pdf", () => {
    expect(invoicePdfFilename({ month: "2026-09", client: { name: "株式会社三郷物流" } })).toBe("請求書_2026-09_株式会社三郷物流.pdf");
  });

  it("入金予定日のルールを日本語にする", () => {
    expect(paymentRuleLabel(0, 0)).toBe("当月末日");
    expect(paymentRuleLabel(1, 0)).toBe("翌月末日");
    expect(paymentRuleLabel(2, 15)).toBe("翌々月15日");
    expect(paymentRuleLabel(3, 25)).toBe("3 か月後25日");
  });
});

describe("請求書一覧 CSV", () => {
  const row: InvoiceCsvSource = {
    month: "2026-09-01",
    invoice_no: "202609-01",
    client_name: "株式会社三郷物流",
    status: "paid",
    issue_date: "2026-09-30",
    due_date: "2026-10-31",
    subtotal: 483525,
    tax: 48352,
    total: 531877,
    paid_on: "2026-10-30",
    note: "お振込先：みずほ銀行",
  };

  it("列は 稼動月 / 請求書番号 / 取引先 / 状態 / 発行日 / 入金予定日 / 小計 / 消費税 / 合計 / 入金日 / 備考", () => {
    expect([...INVOICES_CSV_HEADERS]).toEqual(["稼動月", "請求書番号", "取引先", "状態", "発行日", "入金予定日", "小計", "消費税", "合計", "入金日", "備考"]);
  });

  it("月は YYYY-MM、状態は日本語、金額は生の値（カンマ無し）", () => {
    expect(invoiceToCsvRow(row)).toEqual(["2026-09", "202609-01", "株式会社三郷物流", "入金済み", "2026-09-30", "2026-10-31", "483525", "48352", "531877", "2026-10-30", "お振込先：みずほ銀行"]);
  });

  it("未設定（null）の列は空文字にする", () => {
    const r = invoiceToCsvRow({ ...row, status: "draft", due_date: null, paid_on: null, note: "" });
    expect(r[3]).toBe("下書き");
    expect(r[5]).toBe("");
    expect(r[9]).toBe("");
    expect(r[10]).toBe("");
  });

  it("BOM ＋ CRLF で出力し、カンマ・改行を含む備考は引用符で囲む", () => {
    const csv = invoicesToCsv([{ ...row, note: 'A銀行, B支店\n"普通"' }]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("稼動月,請求書番号,取引先");
    expect(csv).toContain('"A銀行, B支店\n""普通"""');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("clientInputSchema", () => {
  const base: ClientFormInput = {
    id: null,
    name: "株式会社三郷物流",
    honorific: "御中",
    address: "埼玉県三郷市",
    tel: "048-111-2222",
    invoice_reg_no: "T9876543210987",
    payment_month_offset: "1",
    payment_day: "0",
    memo: "",
    is_active: true,
  };

  it("敬称の空欄は「御中」、入金予定日は全角でも整数になる", () => {
    const out = clientInputSchema.parse({ ...base, honorific: "  ", payment_month_offset: "２", payment_day: "１５" });
    expect(out.honorific).toBe("御中");
    expect(out.payment_month_offset).toBe(2);
    expect(out.payment_day).toBe(15);
  });

  it("登録番号は T ＋ 13 桁（ハイフン可）・空欄も可", () => {
    expect(clientInputSchema.safeParse({ ...base, invoice_reg_no: "" }).success).toBe(true);
    expect(clientInputSchema.safeParse({ ...base, invoice_reg_no: "T1234-5678-90123" }).success).toBe(true);
    expect(clientInputSchema.safeParse({ ...base, invoice_reg_no: "T123" }).success).toBe(false);
  });

  it("名称なし・範囲外の入金予定日を拒否する", () => {
    expect(clientInputSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(clientInputSchema.safeParse({ ...base, payment_month_offset: "4" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ ...base, payment_day: "32" }).success).toBe(false);
    expect(clientInputSchema.safeParse({ ...base, payment_day: "1.5" }).success).toBe(false);
  });
});

describe("invoiceInputSchema", () => {
  const base = { id: UUID1, invoice_no: "202609-01", issue_date: "2026-09-30", due_date: "2026-10-31", note: "備考" };

  it("入金予定日の空欄は null になる", () => {
    const out = invoiceInputSchema.parse({ ...base, due_date: "" });
    expect(out.due_date).toBeNull();
    expect(out.invoice_no).toBe("202609-01");
  });

  it("請求書番号なし・存在しない日付・不正な形式を拒否する", () => {
    expect(invoiceInputSchema.safeParse({ ...base, invoice_no: "  " }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base, issue_date: "2026-02-30" }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base, issue_date: "2026/09/30" }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base, id: "not-uuid" }).success).toBe(false);
  });
});

describe("invoiceItemsInputSchema", () => {
  const rows = [{ id: null, name: "三郷Amazon", unit: "day" as const, qty: "21", unit_price: "23,025" }];

  it("数量・単価はカンマ・全角可、区分の空欄は null（金額は送らない）", () => {
    const out = invoiceItemsInputSchema.parse({ invoice_id: UUID1, items: [{ ...rows[0], unit: "" }, { id: UUID2, name: "越谷ヤマト", unit: "piece", qty: "１２００", unit_price: "180" }] });
    expect(out.items[0].unit).toBeNull();
    expect(out.items[0].qty).toBe(21);
    expect(out.items[0].unit_price).toBe(23025);
    expect(out.items[1].qty).toBe(1200);
    expect(out.items[1].id).toBe(UUID2);
    expect("amount" in out.items[0]).toBe(false);
  });

  it("明細 0 件は許可（作り直し前の空の請求書）", () => {
    expect(invoiceItemsInputSchema.safeParse({ invoice_id: UUID1, items: [] }).success).toBe(true);
  });

  it("内容が空・マイナス単価・小数 3 桁を拒否する", () => {
    expect(invoiceItemsInputSchema.safeParse({ invoice_id: UUID1, items: [{ ...rows[0], name: " " }] }).success).toBe(false);
    expect(invoiceItemsInputSchema.safeParse({ invoice_id: UUID1, items: [{ ...rows[0], unit_price: "-100" }] }).success).toBe(false);
    expect(invoiceItemsInputSchema.safeParse({ invoice_id: UUID1, items: [{ ...rows[0], qty: "1.234" }] }).success).toBe(false);
  });
});

describe("状態変更・作り直しの入力", () => {
  it("入金日は空欄なら null（DB 側で当日になる）", () => {
    expect(invoiceStatusInputSchema.parse({ id: UUID1, status: "paid", paid_on: "" }).paid_on).toBeNull();
    expect(invoiceStatusInputSchema.parse({ id: UUID1, status: "issued", paid_on: null }).paid_on).toBeNull();
    expect(invoiceStatusInputSchema.parse({ id: UUID1, status: "paid", paid_on: "2026-10-30" }).paid_on).toBe("2026-10-30");
  });

  it("未知の状態・不正な入金日を拒否する", () => {
    expect(invoiceStatusInputSchema.safeParse({ id: UUID1, status: "sent", paid_on: null }).success).toBe(false);
    expect(invoiceStatusInputSchema.safeParse({ id: UUID1, status: "paid", paid_on: "2026-13-01" }).success).toBe(false);
  });

  it("作り直しは取引先 ID と稼動月（YYYY-MM）が必要", () => {
    expect(buildInvoiceInputSchema.parse({ client_id: UUID1, month: "2026-09" }).month).toBe("2026-09");
    expect(buildInvoiceInputSchema.safeParse({ client_id: UUID1, month: "2026-09-01" }).success).toBe(false);
    expect(buildInvoiceInputSchema.safeParse({ client_id: "x", month: "2026-09" }).success).toBe(false);
  });
});
