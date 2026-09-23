"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerAction } from "@/lib/auth/session";
import { ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import {
  companyInputSchema,
  laborSettingsSchema,
  laborSettingsToColumns,
  retentionSettingsSchema,
  type CompanyFormInput,
  type LaborSettingsFormInput,
  type RetentionSettingsFormInput,
} from "@/lib/schemas/company";
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
        fiscal_month: parsed.fiscal_month,
        // 振込元（総合振込データの依頼人情報）。空欄は "" のまま保存する
        fb_consignor_code: parsed.fb_consignor_code,
        fb_consignor_kana: parsed.fb_consignor_kana,
        fb_bank_code: parsed.fb_bank_code,
        fb_bank_name: parsed.fb_bank_name,
        fb_branch_code: parsed.fb_branch_code,
        fb_branch_name: parsed.fb_branch_name,
        fb_account_type: parsed.fb_account_type,
        fb_account_number: parsed.fb_account_number,
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

/**
 * 労務の基準の更新（owner / admin）
 * 画面は時間で入力し、ここで分に直して companies.labor_* に保存する。
 * 保存してもビュー（v_daily_labor / v_driver_month_labor）が判定をやり直すだけで、日報そのものは変わらない。
 */
export async function updateLaborSettingsAction(input: LaborSettingsFormInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    // companies の更新は DB（RLS）がオーナーのみに限っている。入口もそろえる（0025）
    const { supabase, company } = await requireOwnerAction();
    const parsed = laborSettingsSchema.parse(input);

    const res = await supabase.from("companies").update(laborSettingsToColumns(parsed)).eq("id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new Error("労務の基準を更新できませんでした（会社設定はオーナーのみ変更できます）。");

    revalidatePath("/settings/safety");
    revalidatePath("/daily");
    return null;
  }, "労務の基準を保存しました。");
}

/**
 * 法定帳票の保存期間と診断の間隔（0024）。会社設定なので **オーナーのみ**（DB の RLS が拒否する）。
 * 期間を延ばしても記録は消えない（保存期間は「いつまで持つ必要があるか」を示すだけ）。
 */
export async function updateRetentionSettingsAction(input: RetentionSettingsFormInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = retentionSettingsSchema.parse(input);

    const res = await supabase.from("companies").update(parsed).eq("id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new Error("保存期間を更新できませんでした（会社設定はオーナーのみ変更できます）。");

    revalidatePath("/settings/safety");
    revalidatePath("/compliance");
    return null;
  }, "保存期間を保存しました。");
}
