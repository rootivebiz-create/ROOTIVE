"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import {
  buildInvoiceInputSchema,
  invoiceInputSchema,
  invoiceItemsInputSchema,
  invoiceStatusInputSchema,
  type BuildInvoiceInput,
  type InvoiceFormInput,
  type InvoiceItemFormInput,
  type InvoiceStatusInput,
} from "@/lib/schemas/invoices";
import type { InvoiceStatus } from "@/lib/db/types";
import { monthToDate } from "@/lib/month";
import type { ServerSupabase } from "@/lib/supabase/server";

/** 請求書の変更が影響する画面 */
function revalidateInvoicePaths() {
  revalidatePath("/invoices", "layout");
  revalidatePath("/settings/clients");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

/** RPC のエラーを日本語のメッセージへ（INVOICE_ISSUED は lib/actions/result.ts に未登録なのでここで訳す） */
function throwRpcError(error: PostgrestError): never {
  if ((error.hint ?? "").trim() === "INVOICE_ISSUED") {
    throw new ActionError("発行済みの請求書は作り直せません。下書きに戻してから実行してください。");
  }
  throw error;
}

/** 請求書を取得する（会社のものだけ） */
async function loadInvoiceRow(supabase: ServerSupabase, companyId: string, invoiceId: string): Promise<{ id: string; status: InvoiceStatus }> {
  const res = await supabase.from("invoices").select("id, status").eq("id", invoiceId).eq("company_id", companyId).maybeSingle();
  return unwrap<{ id: string; status: InvoiceStatus }>(res, "請求書が見つかりません。");
}

/** その月・その取引先の稼働から請求明細を作り直す（RPC build_invoice。無ければ請求書ごと作る） */
export async function buildInvoiceAction(input: BuildInvoiceInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const parsed = buildInvoiceInputSchema.parse(input);
    const res = await supabase.rpc("build_invoice", { p_client_id: parsed.client_id, p_month: monthToDate(parsed.month) });
    if (res.error) throwRpcError(res.error);
    if (!res.data) throw new ActionError("請求書の作成に失敗しました。");
    revalidateInvoicePaths();
    return { id: res.data };
  }, "稼働から請求明細を作成しました");
}

/** 請求書の見出し（番号・発行日・入金予定日・備考）の保存 */
export async function saveInvoiceAction(input: InvoiceFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = invoiceInputSchema.parse(input);

    // 請求書番号は会社内で一意
    const dup = await supabase.from("invoices").select("id").eq("company_id", company.id).eq("invoice_no", parsed.invoice_no).neq("id", parsed.id).limit(1);
    ensureNoError(dup);
    if ((dup.data ?? []).length > 0) {
      throw new ActionError("同じ請求書番号が既に登録されています。", { invoice_no: ["同じ請求書番号が既に登録されています"] });
    }

    const res = await supabase
      .from("invoices")
      .update({ invoice_no: parsed.invoice_no, issue_date: parsed.issue_date, due_date: parsed.due_date, note: parsed.note })
      .eq("id", parsed.id)
      .eq("company_id", company.id)
      .select("id")
      .single();
    const id = unwrap(res, "請求書が見つかりません。").id;

    revalidateInvoicePaths();
    return { id };
  }, "保存しました");
}

/** 請求明細の保存（追加・更新・削除をまとめて）。金額は DB が 数量 × 単価 で計算する */
export async function saveInvoiceItemsAction(invoiceId: string, rows: InvoiceItemFormInput[]): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = invoiceItemsInputSchema.parse({ invoice_id: invoiceId, items: rows });

    const invoice = await loadInvoiceRow(supabase, company.id, parsed.invoice_id);
    if (invoice.status !== "draft") {
      throw new ActionError("発行済みの請求書は明細を変更できません。下書きに戻してから編集してください。");
    }

    const existingRes = await supabase.from("invoice_items").select("id").eq("invoice_id", parsed.invoice_id);
    ensureNoError(existingRes);
    const existingIds = new Set((existingRes.data ?? []).map((r) => r.id));
    const keptIds = new Set(parsed.items.map((r) => r.id).filter((id): id is string => id != null && existingIds.has(id)));
    const removeIds = [...existingIds].filter((id) => !keptIds.has(id));
    if (removeIds.length > 0) {
      ensureNoError(await supabase.from("invoice_items").delete().eq("invoice_id", parsed.invoice_id).in("id", removeIds));
    }

    const inserts: {
      company_id: string;
      invoice_id: string;
      name: string;
      unit: "day" | "piece" | null;
      qty: number;
      unit_price: number;
      sort_order: number;
    }[] = [];
    const updates: PromiseLike<{ error: PostgrestError | null }>[] = [];
    parsed.items.forEach((item, i) => {
      const row = { name: item.name, unit: item.unit, qty: item.qty, unit_price: item.unit_price, sort_order: i + 1 };
      if (item.id && existingIds.has(item.id)) {
        updates.push(supabase.from("invoice_items").update(row).eq("id", item.id).eq("invoice_id", parsed.invoice_id));
      } else {
        inserts.push({ ...row, company_id: company.id, invoice_id: parsed.invoice_id });
      }
    });
    (await Promise.all(updates)).forEach(ensureNoError);
    if (inserts.length > 0) {
      ensureNoError(await supabase.from("invoice_items").insert(inserts));
    }

    revalidateInvoicePaths();
    return { id: parsed.invoice_id };
  }, "保存しました");
}

/** 状態変更（下書き・発行済み・入金済み。RPC set_invoice_status） */
export async function setInvoiceStatusAction(input: InvoiceStatusInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const parsed = invoiceStatusInputSchema.parse(input);
    const args: { p_invoice_id: string; p_status: InvoiceStatus; p_paid_on?: string } = { p_invoice_id: parsed.id, p_status: parsed.status };
    if (parsed.status === "paid" && parsed.paid_on) args.p_paid_on = parsed.paid_on;
    const res = await supabase.rpc("set_invoice_status", args);
    if (res.error) throwRpcError(res.error);
    revalidateInvoicePaths();
    return { id: parsed.id };
  }, "状態を変更しました");
}

/** 請求書の削除（下書きのみ。明細も一緒に削除される） */
export async function deleteInvoiceAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const invoiceId = uuidSchema.parse(id);

    const invoice = await loadInvoiceRow(supabase, company.id, invoiceId);
    if (invoice.status !== "draft") {
      throw new ActionError("発行済みの請求書は削除できません。下書きに戻してから削除してください。");
    }

    const res = await supabase.from("invoices").delete().eq("id", invoiceId).eq("company_id", company.id).select("id");
    if (res.error) {
      if (res.error.code === "23503") throw new ActionError("他のデータから参照されているため削除できません。");
      throw res.error;
    }
    if ((res.data ?? []).length === 0) throw new ActionError("請求書が見つかりません。");

    revalidateInvoicePaths();
    return null;
  }, "削除しました");
}
