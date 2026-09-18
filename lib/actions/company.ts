"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/auth/session";
import { ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import { companyInputSchema, type CompanyFormInput } from "@/lib/schemas/company";
import type { Json } from "@/lib/db/database.types";

/** 会社設定の更新（owner のみ）。yayoi_accounts は JSON オブジェクトとして保存する */
export async function updateCompanyAction(input: CompanyFormInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = companyInputSchema.parse(input);

    const yayoi: Json = { ...parsed.yayoi_accounts };
    const res = await supabase
      .from("companies")
      .update({
        name: parsed.name,
        rounding_mode: parsed.rounding_mode,
        default_royalty_rate: parsed.default_royalty_rate,
        default_mgmt_fee: parsed.default_mgmt_fee,
        payout_month_offset: parsed.payout_month_offset,
        payout_day: parsed.payout_day,
        statement_note: parsed.statement_note,
        address: parsed.address,
        tel: parsed.tel,
        invoice_reg_no: parsed.invoice_reg_no,
        driver_portal_show_royalty: parsed.driver_portal_show_royalty,
        driver_portal_show_open_month: parsed.driver_portal_show_open_month,
        tax_rate: parsed.tax_rate,
        tax_rounding: parsed.tax_rounding,
        yayoi_accounts: yayoi,
      })
      .eq("id", company.id)
      .select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new Error("会社設定を更新できませんでした（権限を確認してください）。");

    revalidatePath("/", "layout");
    return null;
  }, "会社設定を保存しました。");
}
