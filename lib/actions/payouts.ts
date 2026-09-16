"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import { resetMgmtFeeSchema, saveDriverMonthSchema, type SaveDriverMonthInput } from "@/lib/schemas/payouts";
import { monthToDate } from "@/lib/month";

function revalidatePayouts() {
  // /payouts と /payouts/[driverId]/statement をまとめて再検証
  revalidatePath("/payouts", "layout");
  revalidatePath("/dashboard");
}

/**
 * 管理費・メモ・調整の一括保存（admin+）
 * driver_months を upsert → 調整は「送られてこなかった id は削除、id ありは更新、id なしは追加」（sort_order は配列順）
 */
export async function saveDriverMonthAction(input: SaveDriverMonthInput): Promise<ActionResult<{ driverMonthId: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const data = saveDriverMonthSchema.parse(input);
    const monthDate = monthToDate(data.month);

    // ドライバーが自社のものか確認
    const driverRes = await supabase.from("drivers").select("id").eq("id", data.driverId).eq("company_id", company.id).maybeSingle();
    if (driverRes.error) throw driverRes.error;
    if (!driverRes.data) throw new ActionError("ドライバーが見つかりません。");

    const dmRes = await supabase
      .from("driver_months")
      .upsert({ company_id: company.id, month: monthDate, driver_id: data.driverId, mgmt_fee: data.mgmtFee, memo: data.memo }, { onConflict: "company_id,month,driver_id" })
      .select("id")
      .single();
    if (dmRes.error) throw dmRes.error;
    const dm = dmRes.data;

    const existingRes = await supabase.from("adjustments").select("id").eq("driver_month_id", dm.id);
    if (existingRes.error) throw existingRes.error;
    const existing = existingRes.data ?? [];
    const existingIds = new Set(existing.map((e) => e.id));
    const keepIds = new Set(data.adjustments.map((a) => a.id).filter((id): id is string => Boolean(id)));

    // 送られてこなかった既存の調整は削除
    for (const e of existing) {
      if (!keepIds.has(e.id)) ensureNoError(await supabase.from("adjustments").delete().eq("id", e.id));
    }

    // 更新（id あり）と追加（id なし）。sort_order は配列順
    const inserts: {
      company_id: string;
      driver_month_id: string;
      label: string;
      amount: number;
      count_as_profit: boolean;
      recurring_id: string | null;
      sort_order: number;
    }[] = [];
    for (let i = 0; i < data.adjustments.length; i++) {
      const a = data.adjustments[i];
      if (a.id && existingIds.has(a.id)) {
        ensureNoError(
          await supabase
            .from("adjustments")
            .update({ label: a.label, amount: a.amount, count_as_profit: a.countAsProfit, recurring_id: a.recurringId ?? null, sort_order: i })
            .eq("id", a.id),
        );
      } else {
        inserts.push({
          company_id: company.id,
          driver_month_id: dm.id,
          label: a.label,
          amount: a.amount,
          count_as_profit: a.countAsProfit,
          recurring_id: a.recurringId ?? null,
          sort_order: i,
        });
      }
    }
    if (inserts.length > 0) ensureNoError(await supabase.from("adjustments").insert(inserts));

    revalidatePayouts();
    return { driverMonthId: dm.id };
  }, "保存しました");
}

/** 当月の管理費をドライバーの標準値（drivers.mgmt_fee）に戻す（admin+） */
export async function resetMgmtFeeToDefaultAction(month: string, driverId: string): Promise<ActionResult<{ mgmtFee: number }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const data = resetMgmtFeeSchema.parse({ month, driverId });
    const driverRes = await supabase.from("drivers").select("id, mgmt_fee").eq("id", data.driverId).eq("company_id", company.id).maybeSingle();
    if (driverRes.error) throw driverRes.error;
    const driver = driverRes.data;
    if (!driver) throw new ActionError("ドライバーが見つかりません。");
    const mgmtFee = Number(driver.mgmt_fee ?? 0);
    if (!Number.isFinite(mgmtFee)) throw new ActionError("ドライバーの標準管理費が不正です。");
    ensureNoError(
      await supabase
        .from("driver_months")
        .upsert({ company_id: company.id, month: monthToDate(data.month), driver_id: data.driverId, mgmt_fee: mgmtFee }, { onConflict: "company_id,month,driver_id" }),
    );
    revalidatePayouts();
    return { mgmtFee };
  }, "管理費を標準値に戻しました");
}
