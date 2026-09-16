"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import { applyMasterRatesSchema, saveRateOverridesSchema, type ApplyMasterRatesInput, type RateOverrideRowInput } from "@/lib/schemas/rates";
import { monthToDate } from "@/lib/month";

/** 単価の変更が影響する画面 */
function revalidateRatePaths() {
  revalidatePath("/settings/rates");
  revalidatePath("/settings/drivers", "layout");
  revalidatePath("/settings/projects", "layout");
  revalidatePath("/entries", "layout");
  revalidatePath("/payouts", "layout");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

/**
 * ドライバー別単価の保存（admin+）
 * 行ごとに「受注・支払とも空欄 → 削除」「どちらかに値 → upsert（空欄側は null＝標準）」
 */
export async function saveRateOverridesAction(rows: RateOverrideRowInput[]): Promise<ActionResult<{ saved: number; cleared: number }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { rows: parsed } = saveRateOverridesSchema.parse({ rows });

    // 自社のドライバー・案件内容だけを対象にする
    const driverIds = [...new Set(parsed.map((r) => r.driver_id))];
    const itemIds = [...new Set(parsed.map((r) => r.project_item_id))];
    const [driversRes, itemsRes] = await Promise.all([
      supabase.from("drivers").select("id").eq("company_id", company.id).in("id", driverIds),
      supabase.from("project_items").select("id").eq("company_id", company.id).in("id", itemIds),
    ]);
    ensureNoError(driversRes);
    ensureNoError(itemsRes);
    const knownDrivers = new Set((driversRes.data ?? []).map((d) => d.id));
    const knownItems = new Set((itemsRes.data ?? []).map((i) => i.id));
    if (driverIds.some((id) => !knownDrivers.has(id))) throw new ActionError("ドライバーが見つかりません。画面を再読み込みしてください。");
    if (itemIds.some((id) => !knownItems.has(id))) throw new ActionError("案件内容が見つかりません。画面を再読み込みしてください。");

    const upserts = parsed
      .filter((r) => r.bill_rate != null || r.pay_rate != null)
      .map((r) => ({ company_id: company.id, driver_id: r.driver_id, project_item_id: r.project_item_id, bill_rate: r.bill_rate, pay_rate: r.pay_rate }));
    const clears = parsed.filter((r) => r.bill_rate == null && r.pay_rate == null);

    if (upserts.length > 0) {
      ensureNoError(await supabase.from("driver_pay_overrides").upsert(upserts, { onConflict: "driver_id,project_item_id" }));
    }
    // 削除はドライバーごとにまとめる
    const clearsByDriver = new Map<string, string[]>();
    for (const r of clears) clearsByDriver.set(r.driver_id, [...(clearsByDriver.get(r.driver_id) ?? []), r.project_item_id]);
    for (const [driverId, items] of clearsByDriver) {
      ensureNoError(await supabase.from("driver_pay_overrides").delete().eq("driver_id", driverId).in("project_item_id", items));
    }

    revalidateRatePaths();
    return { saved: upserts.length, cleared: clears.length };
  }, "単価を保存しました");
}

/**
 * 単価変更を未締め月の稼働へ反映（admin+）
 * 指定月の稼働行のうち現在のマスタと異なる行の単価・率・端数処理を更新する（DB 関数 apply_master_rates）
 */
export async function applyMasterRatesAction(input: ApplyMasterRatesInput): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = applyMasterRatesSchema.parse(input);
    const { data, error } = await supabase.rpc("apply_master_rates", {
      p_month: monthToDate(v.month),
      p_driver_id: v.driver_id ?? undefined,
      p_project_item_id: v.project_item_id ?? undefined,
      p_entry_ids: v.entry_ids ?? undefined,
    });
    if (error) throw error;
    revalidateRatePaths();
    return { count: Number(data ?? 0) };
  });
  if (!res.ok) return res;
  const { count } = res.data;
  return {
    ok: true,
    data: { count },
    message: count > 0 ? `${count} 行の単価・率をマスタの値に更新しました` : "更新が必要な稼働行はありませんでした",
  };
}
