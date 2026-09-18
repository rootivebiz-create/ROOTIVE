"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import { deleteMonthTargetSchema, saveMonthTargetSchema, type SaveMonthTargetInput } from "@/lib/schemas/targets";
import { monthToDate } from "@/lib/month";

/** 目標はダッシュボードと年次レポートの両方に出る */
function revalidateTargets() {
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

/** 月次目標（売上・営業利益）の保存（admin+）。締め済み月でも目標は編集できる */
export async function saveMonthTargetAction(input: SaveMonthTargetInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const data = saveMonthTargetSchema.parse(input);
    ensureNoError(
      await supabase.from("month_targets").upsert(
        {
          company_id: company.id,
          month: monthToDate(data.month),
          bill_target: data.bill_target,
          profit_target: data.profit_target,
          memo: data.memo,
        },
        { onConflict: "company_id,month" },
      ),
    );
    revalidateTargets();
    return null;
  }, "月次目標を保存しました");
}

/** 月次目標の削除（admin+） */
export async function deleteMonthTargetAction(month: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const data = deleteMonthTargetSchema.parse({ month });
    ensureNoError(await supabase.from("month_targets").delete().eq("company_id", company.id).eq("month", monthToDate(data.month)));
    revalidateTargets();
    return null;
  }, "月次目標を削除しました");
}
