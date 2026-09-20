import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { exportUrls } from "@/lib/exports/urls";
import { dateToMonth } from "@/lib/month";
import type { RecordDoc } from "./index";

/** 1 種類あたりの読み込み上限（検索の対象は直近の書類が中心） */
export const RECORDS_LIMIT = 500;

/**
 * 経費のレシート・請求書・支払通知・契約書を 1 つの配列にまとめる。
 * 埋め込みリソースは使わず、名称が要るものは v_* ビューから読む（CLAUDE.md の制約）。
 */
export async function loadRecordDocs(supabase: ServerSupabase, companyId: string): Promise<RecordDoc[]> {
  const [expensesRes, invoicesRes, noticesRes, contractsRes] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, month, incurred_on, label, amount, vendor, memo, receipt_path")
      .eq("company_id", companyId)
      .order("incurred_on", { ascending: false, nullsFirst: false })
      .limit(RECORDS_LIMIT),
    supabase
      .from("v_invoice_list")
      .select("id, month, invoice_no, issue_date, total, client_name, note")
      .eq("company_id", companyId)
      .order("issue_date", { ascending: false })
      .limit(RECORDS_LIMIT),
    supabase
      .from("v_payment_notice_list")
      .select("id, month, notice_no, received_on, total_amount, client_name, memo")
      .eq("company_id", companyId)
      .order("received_on", { ascending: false, nullsFirst: false })
      .limit(RECORDS_LIMIT),
    supabase
      .from("v_contract_list")
      .select("id, title, start_on, driver_name, file_path, memo")
      .eq("company_id", companyId)
      .order("start_on", { ascending: false })
      .limit(RECORDS_LIMIT),
  ]);
  if (expensesRes.error) throw expensesRes.error;
  if (invoicesRes.error) throw invoicesRes.error;
  if (noticesRes.error) throw noticesRes.error;
  if (contractsRes.error) throw contractsRes.error;

  const docs: RecordDoc[] = [];

  for (const e of expensesRes.data ?? []) {
    const path = (e.receipt_path ?? "").trim();
    docs.push({
      id: `expense:${e.id}`,
      kind: "receipt",
      date: e.incurred_on ?? (e.month ? e.month : null),
      amount: Number(e.amount ?? 0),
      counterparty: (e.vendor ?? "").trim(),
      title: e.label ?? "",
      href: path ? `/api/receipt/${path}` : null,
      hasFile: path.length > 0,
      month: e.month ? dateToMonth(e.month) : null,
      memo: e.memo ?? "",
    });
  }

  for (const i of invoicesRes.data ?? []) {
    docs.push({
      id: `invoice:${i.id}`,
      kind: "invoice",
      date: i.issue_date ?? null,
      amount: Number(i.total ?? 0),
      counterparty: i.client_name ?? "",
      title: i.invoice_no ?? "",
      href: i.id ? exportUrls.invoicePdf(i.id) : null,
      hasFile: true, // 請求書はいつでも同じ内容の PDF を出せる
      month: i.month ? dateToMonth(i.month) : null,
      memo: i.note ?? "",
    });
  }

  for (const n of noticesRes.data ?? []) {
    docs.push({
      id: `notice:${n.id}`,
      kind: "notice",
      date: n.received_on ?? (n.month ? n.month : null),
      amount: Number(n.total_amount ?? 0),
      counterparty: n.client_name ?? "",
      title: (n.notice_no ?? "").trim() || "支払通知",
      href: n.id ? `/invoices/notices/${n.id}` : null,
      hasFile: false, // 通知そのもののファイルは保管しない（明細は取り込んで残す）
      month: n.month ? dateToMonth(n.month) : null,
      memo: n.memo ?? "",
    });
  }

  for (const c of contractsRes.data ?? []) {
    const path = (c.file_path ?? "").trim();
    docs.push({
      id: `contract:${c.id}`,
      kind: "contract",
      date: c.start_on ?? null,
      amount: null,
      counterparty: c.driver_name ?? "",
      title: c.title ?? "業務委託契約書",
      href: path && c.id ? exportUrls.contractFile(c.id) : null,
      hasFile: path.length > 0,
      month: null,
      memo: c.memo ?? "",
    });
  }

  return docs;
}
