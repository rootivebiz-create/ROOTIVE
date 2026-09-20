"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireOwnerAction } from "@/lib/auth/session";
import { ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { planSchema, planYearSchema, spreadPlanYearSchema } from "@/lib/schemas/executive";
import { uuidSchema } from "@/lib/schemas/common";

/**
 * 中期計画（plans / plan_years）の Server Actions。**すべて代表（owner）のみ**。
 *
 * 順序は CLAUDE.md §1 のとおり（requireOwnerAction → zod → supabase-js → revalidatePath → ActionResult）。
 * - 年の行を作るのは RPC `ensure_plan_years`（期間ぶんを作り、すでにある年はそのまま）
 * - 年の目標を月へ配る（month_targets）のは RPC `spread_plan_year` だけ。アプリ側で按分を書かない
 */

export type PlanInput = z.input<typeof planSchema>;
export type PlanYearInput = z.input<typeof planYearSchema>;
export type SpreadPlanYearInput = z.input<typeof spreadPlanYearSchema>;

function revalidatePlans(): void {
  revalidatePath("/executive", "layout");
}

/** 月次目標が変わる先（ダッシュボードの進捗バー・年間予算・レポート） */
function revalidateTargets(): void {
  revalidatePlans();
  revalidatePath("/dashboard");
  revalidatePath("/finance");
  revalidatePath("/reports");
}

// ---------------------------------------------------------------------------
// 中期計画
// ---------------------------------------------------------------------------

/** 中期計画の作成・更新。新規のときは期間ぶんの年もまとめて作る */
export async function savePlanAction(input: PlanInput): Promise<ActionResult<{ id: string; years: number }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const v = planSchema.parse(input);
    const row = {
      name: v.name,
      from_year: v.from_year,
      to_year: v.to_year,
      vision: v.vision,
      memo: v.memo,
      is_active: v.is_active,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("plans").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の中期計画が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(
          await supabase.from("plans").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single(),
        );

    // 期間を変えたときも足りない年を足す（すでにある年の目標はそのまま残る）
    const made = await supabase.rpc("ensure_plan_years", { p_plan_id: saved.id });
    ensureNoError(made);

    revalidatePlans();
    return { id: saved.id, years: typeof made.data === "number" ? made.data : 0 };
  }, "中期計画を保存しました");
}

/** 中期計画の削除（年の行も DB の cascade で消える） */
export async function deletePlanAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const planId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("plans").delete().eq("id", planId).eq("company_id", company.id));
    revalidatePlans();
    return { id: planId };
  }, "中期計画を削除しました");
}

/** 期間ぶんの年を作る（すでにある年はそのまま） */
export async function ensurePlanYearsAction(planId: string): Promise<ActionResult<{ years: number }>> {
  return runAction(async () => {
    const { supabase } = await requireOwnerAction();
    const id = uuidSchema.parse(planId);
    const res = await supabase.rpc("ensure_plan_years", { p_plan_id: id });
    ensureNoError(res);
    revalidatePlans();
    return { years: typeof res.data === "number" ? res.data : 0 };
  }, "計画の年を作りました");
}

// ---------------------------------------------------------------------------
// 年の目標
// ---------------------------------------------------------------------------

/** 年の目標（売上・利益・ドライバー数）の更新 */
export async function savePlanYearAction(input: PlanYearInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = planYearSchema.parse(input);

    const saved = unwrap<{ id: string }>(
      await supabase
        .from("plan_years")
        .update({
          bill_target: v.bill_target,
          profit_target: v.profit_target,
          driver_target: v.driver_target,
          memo: v.memo,
        })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の年が見つかりません。",
    );

    revalidatePlans();
    return { id: saved.id };
  }, "年の目標を保存しました");
}

/**
 * 年の目標を 12 か月へ配る（month_targets を書き換える）。
 * 均等（even）か、前年の売上の構成比（actual）。按分は DB の spread_plan_year に任せる。
 */
export async function spreadPlanYearAction(input: SpreadPlanYearInput): Promise<ActionResult<{ months: number }>> {
  return runAction(async () => {
    const { supabase } = await requireOwnerAction();
    const v = spreadPlanYearSchema.parse(input);

    const res = await supabase.rpc("spread_plan_year", { p_plan_id: v.plan_id, p_year: v.year, p_weight: v.weight });
    ensureNoError(res);

    revalidateTargets();
    return { months: typeof res.data === "number" ? res.data : 0 };
  }, "年の目標を月へ配りました");
}
