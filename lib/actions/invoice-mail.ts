"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, translateError, type ActionResult } from "@/lib/actions/result";
import { loadStatementAssets } from "@/lib/company-assets";
import { invoicePdfFilename, loadInvoiceData } from "@/lib/invoice";
import { invoiceMailSubject, invoiceMailText } from "@/lib/mail/invoice";
import { splitEmails } from "@/lib/mail/address";
import { isMailEnabled, sendMail } from "@/lib/mail/send";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { sendInvoiceMailSchema, type SendInvoiceMailInput } from "@/lib/schemas/invoices";

/**
 * 請求書をメールで送る（admin 以上。事務員を含む。0028）。
 *
 * 1. 下書きなら発行する（発行済みの請求書は作り直せなくなる。送ったあとで金額が変わらないように）
 * 2. PDF を作って添付し、Resend で送る
 * 3. 送った（送れなかった）ことを invoice_sends に残す（record_invoice_send）
 * 4. remember なら宛先を取引先の送り先として覚える
 */
export async function sendInvoiceMailAction(input: SendInvoiceMailInput): Promise<ActionResult<{ to: string; issued: boolean }>> {
  const res = await runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    if (!isMailEnabled()) throw new ActionError("メールの送信が設定されていません。管理者に RESEND_API_KEY と MAIL_FROM の設定を依頼してください。");
    const parsed = sendInvoiceMailSchema.parse(input);

    let data = await loadInvoiceData(supabase, company.id, parsed.id);
    if (!data) throw new ActionError("請求書が見つかりません。");
    if (data.items.length === 0 || data.total <= 0) throw new ActionError("明細が無い（金額が 0 の）請求書は送れません。");

    // 1. 下書きなら発行する
    let issued = false;
    if (data.status === "draft") {
      // set_invoice_status は何も返さない（void）ので、エラーだけを見る
      ensureNoError(await supabase.rpc("set_invoice_status", { p_invoice_id: data.id, p_status: "issued" }));
      issued = true;
      data = await loadInvoiceData(supabase, company.id, parsed.id);
      if (!data) throw new ActionError("請求書が見つかりません。");
    }

    // 2. PDF を作って送る
    const subject = invoiceMailSubject({ companyName: company.name, monthLabel: data.monthLabel, invoiceNo: data.invoiceNo });
    const text = invoiceMailText({
      companyName: company.name,
      companyTel: data.company.tel,
      clientName: data.client.name,
      honorific: data.client.honorific,
      invoiceNo: data.invoiceNo,
      monthLabel: data.monthLabel,
      total: data.total,
      dueDateLabel: data.dueDateLabel,
      message: parsed.message,
    });
    const pdf = await renderInvoicePdf(data, { assets: await loadStatementAssets(company) });
    try {
      const { id: providerId } = await sendMail({
        to: splitEmails(parsed.to),
        subject,
        text,
        attachments: [{ filename: invoicePdfFilename(data), content: pdf }],
      });
      // 3. 記録（送れたあとに記録が失敗しても、送ったこと自体は取り消せないので例外にしない）
      await supabase.rpc("record_invoice_send", { p_invoice_id: data.id, p_to: parsed.to, p_subject: subject, p_status: "sent", p_error: "", p_provider_id: providerId });
    } catch (e) {
      const message = translateError(e);
      await supabase.rpc("record_invoice_send", { p_invoice_id: data.id, p_to: parsed.to, p_subject: subject, p_status: "failed", p_error: message, p_provider_id: "" });
      revalidatePath(`/invoices/${data.id}`);
      throw new ActionError(issued ? `請求書は発行しましたが、メールは送れませんでした。${message}` : message);
    }

    // 4. 宛先を覚える
    if (parsed.remember && parsed.to !== data.client.email) {
      await supabase.from("clients").update({ email: parsed.to }).eq("id", data.client.id).eq("company_id", company.id);
    }

    revalidatePath("/invoices", "layout");
    revalidatePath("/office");
    revalidatePath("/settings/clients");
    return { to: parsed.to, issued };
  });
  return res.ok ? { ...res, message: `${res.data.issued ? "発行して、" : ""}${res.data.to} へ請求書を送りました` } : res;
}
