import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadBankImports, loadBankTransactions } from "@/lib/db/queries";
import { bankStatusFromParam } from "@/lib/schemas/bank";
import { BankView } from "@/components/bank/bank-view";
import { toImportRow, toInvoiceCandidate, toTxnRow } from "@/components/bank/helpers";

export const metadata = { title: "入金の消込" };

/**
 * 入金の消込（/bank）
 * 稼動月には依存しない（全期間）。?status=unmatched|matched|ignored|all で絞り込む。
 * 消し込み先の候補（未入金の請求書）は編集できるときだけ読み込む。
 */
export default async function BankPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = bankStatusFromParam(sp.status);
  const { supabase, profile, company } = await requireStaff();
  const editable = canEdit(profile.role);

  const [transactions, imports, invoiceRes] = await Promise.all([
    loadBankTransactions(supabase, company.id, { status, limit: 300 }),
    editable ? loadBankImports(supabase, company.id, 5) : Promise.resolve([]),
    editable
      ? supabase.from("v_invoice_list").select("*").eq("company_id", company.id).neq("status", "paid").order("month", { ascending: false }).order("invoice_no")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (invoiceRes.error) throw invoiceRes.error;

  return (
    <BankView
      status={status}
      rows={transactions.map(toTxnRow)}
      imports={imports.map(toImportRow)}
      invoices={(invoiceRes.data ?? []).map(toInvoiceCandidate)}
      editable={editable}
    />
  );
}
