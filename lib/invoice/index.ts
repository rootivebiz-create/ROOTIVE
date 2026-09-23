/**
 * 請求書データの組み立て（請求書の詳細画面・印刷ページ・PDF で共用。lib/statement/index.ts と同じ考え方）
 * 金額は DB（invoices / invoice_items のトリガー）が計算した値をそのまま使い、ここでは計算しない。
 */
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Client, Company, Invoice, InvoiceItem, InvoiceStatus } from "@/lib/db/types";
import { INVOICE_STATUS_LABELS } from "@/lib/db/types";
import { dateToMonth, formatDateJa, formatMonthJa } from "@/lib/month";
import { taxRateLabel } from "@/lib/calc/tax";
import type { RoundingMode, Unit } from "@/lib/calc/types";
import { paymentRuleLabel } from "@/lib/schemas/clients";

export interface InvoiceItemData {
  id: string;
  name: string;
  /** 区分（日給・個数）。null = 区分なし */
  unit: Unit | null;
  qty: number;
  unitPrice: number;
  /** 数量 × 単価（DB のトリガーが計算した値） */
  amount: number;
  sortOrder: number;
  projectId: string | null;
  projectItemId: string | null;
}

export interface InvoiceClientData {
  id: string;
  name: string;
  honorific: string;
  address: string;
  tel: string;
  /** 請求書を送るメールアドレス（カンマ区切り。空 = 未登録） */
  email: string;
  invoiceRegNo: string;
  paymentMonthOffset: number;
  paymentDay: number;
  /** 入金予定日のルール（例: 翌月末日） */
  paymentRuleLabel: string;
  memo: string;
}

export interface InvoiceCompanyData {
  name: string;
  address: string;
  tel: string;
  invoiceRegNo: string;
  /** ロゴ・認印（Storage のパス。null = 未設定） */
  logoPath: string | null;
  sealPath: string | null;
}

export interface InvoiceData {
  id: string;
  /** 稼動月 "YYYY-MM" */
  month: string;
  /** 2026年9月 */
  monthLabel: string;
  invoiceNo: string;
  status: InvoiceStatus;
  statusLabel: string;
  /** "YYYY-MM-DD" */
  issueDate: string;
  issueDateLabel: string;
  /** お支払い期限（"YYYY-MM-DD"。null = 未設定） */
  dueDate: string | null;
  dueDateLabel: string | null;
  paidOn: string | null;
  paidOnLabel: string | null;
  note: string;
  /** 税抜の小計 */
  subtotal: number;
  taxRate: number;
  /** 税率の表示（"10%"） */
  taxRateLabel: string;
  taxRounding: RoundingMode;
  tax: number;
  /** 税込の合計（ご請求金額） */
  total: number;
  client: InvoiceClientData;
  company: InvoiceCompanyData;
  items: InvoiceItemData[];
}

/** 会社・取引先・請求書・明細から表示用のデータを組み立てる（純関数） */
export function buildInvoiceData(input: { company: Company; client: Client; invoice: Invoice; items: InvoiceItem[] }): InvoiceData {
  const { company, client, invoice, items } = input;
  const month = dateToMonth(invoice.month);
  const taxRate = Number(invoice.tax_rate ?? 0);
  return {
    id: invoice.id,
    month,
    monthLabel: formatMonthJa(month),
    invoiceNo: invoice.invoice_no,
    status: invoice.status,
    statusLabel: INVOICE_STATUS_LABELS[invoice.status],
    issueDate: invoice.issue_date,
    issueDateLabel: formatDateJa(invoice.issue_date),
    dueDate: invoice.due_date ?? null,
    dueDateLabel: invoice.due_date ? formatDateJa(invoice.due_date) : null,
    paidOn: invoice.paid_on ?? null,
    paidOnLabel: invoice.paid_on ? formatDateJa(invoice.paid_on) : null,
    note: invoice.note ?? "",
    subtotal: Number(invoice.subtotal ?? 0),
    taxRate,
    taxRateLabel: taxRateLabel(taxRate),
    taxRounding: invoice.tax_rounding,
    tax: Number(invoice.tax ?? 0),
    total: Number(invoice.total ?? 0),
    client: {
      id: client.id,
      name: client.name,
      honorific: client.honorific ?? "",
      address: client.address ?? "",
      tel: client.tel ?? "",
      email: client.email ?? "",
      invoiceRegNo: client.invoice_reg_no ?? "",
      paymentMonthOffset: client.payment_month_offset,
      paymentDay: client.payment_day,
      paymentRuleLabel: paymentRuleLabel(client.payment_month_offset, client.payment_day),
      memo: client.memo ?? "",
    },
    company: {
      name: company.name,
      address: company.address ?? "",
      tel: company.tel ?? "",
      invoiceRegNo: company.invoice_reg_no ?? "",
      logoPath: company.logo_path ?? null,
      sealPath: company.seal_path ?? null,
    },
    items: [...items]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ja"))
      .map((it) => ({
        id: it.id,
        name: it.name,
        unit: (it.unit ?? null) as Unit | null,
        qty: Number(it.qty ?? 0),
        unitPrice: Number(it.unit_price ?? 0),
        amount: Number(it.amount ?? 0),
        sortOrder: it.sort_order,
        projectId: it.project_id ?? null,
        projectItemId: it.project_item_id ?? null,
      })),
  };
}

/** 請求書 ID から表示用のデータを読み込む（RLS 適用。見つからなければ null） */
export async function loadInvoiceData(supabase: ServerSupabase, companyId: string, invoiceId: string): Promise<InvoiceData | null> {
  const [invoiceRes, companyRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", invoiceId).eq("company_id", companyId).maybeSingle(),
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
  ]);
  if (invoiceRes.error) throw invoiceRes.error;
  if (companyRes.error) throw companyRes.error;
  const invoice = invoiceRes.data;
  const company = companyRes.data;
  if (!invoice || !company) return null;

  const [clientRes, itemsRes] = await Promise.all([
    supabase.from("clients").select("*").eq("id", invoice.client_id).eq("company_id", companyId).maybeSingle(),
    supabase.from("invoice_items").select("*").eq("invoice_id", invoice.id).order("sort_order"),
  ]);
  if (clientRes.error) throw clientRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (!clientRes.data) return null;

  return buildInvoiceData({ company, client: clientRes.data, invoice, items: itemsRes.data ?? [] });
}

/** 請求明細の単位表示（日給 → 日、個数 → 個、未設定 → 空） */
export function itemUnitLabel(unit: Unit | null | undefined): string {
  return unit === "day" ? "日" : unit === "piece" ? "個" : "";
}

/** 未入金の金額（入金済みなら 0） */
export function invoiceUnpaid(invoice: Pick<InvoiceData, "status" | "total">): number {
  return invoice.status === "paid" ? 0 : invoice.total;
}

/** PDF・印刷のファイル名：請求書_2026-09_三郷物流.pdf */
export function invoicePdfFilename(d: Pick<InvoiceData, "month"> & { client: Pick<InvoiceClientData, "name"> }): string {
  return `請求書_${d.month}_${d.client.name}.pdf`;
}
