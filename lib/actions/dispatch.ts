"use server";

import { revalidatePath } from "next/cache";
import { requireActionRole, requireAdminAction } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/actions/result";
import {
  copyWeekSchema,
  dayOffDecisionSchema,
  dayOffRequestSchema,
  dispatchRangeSchema,
  projectDemandDaySchema,
  projectDemandSchema,
  setDispatchSchema,
  weeklyOffSchema,
  type DayOffDecisionInput,
  type DayOffRequestInput,
  type DispatchRowInput,
  type ProjectDemandDayInput,
  type ProjectDemandInput,
  type SetDispatchResult,
  type WeeklyOffInput,
} from "@/lib/schemas/dispatch";

/**
 * 配車・シフトの Server Actions
 *
 * 規約どおり requireXxxAction() → zod → RPC（RLS 適用）→ revalidatePath → ActionResult。
 * 配車は「予定」なので締め済み月のガードは掛からない（実績は日別の稼働が正）。
 */

/** 配車の変更が影響する画面 */
const AFFECTED = ["/dispatch", "/dashboard", "/daily", "/driver", "/driver/schedule", "/alerts"];

function revalidateDispatch(): void {
  for (const p of AFFECTED) revalidatePath(p);
}

/** 配車をまとめて置く（qty_plan が 0 の行は外す） */
export async function setDispatchAction(rows: DispatchRowInput[]): Promise<ActionResult<SetDispatchResult>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = setDispatchSchema.parse({ rows });
    const { data, error } = await supabase.rpc("set_dispatch_bulk", {
      p_rows: v.rows.map((r) => ({
        on_date: r.on_date,
        driver_id: r.driver_id,
        project_item_id: r.project_item_id,
        qty_plan: r.qty_plan,
      })),
    });
    if (error) throw error;
    const obj = (data ?? {}) as Record<string, unknown>;
    revalidateDispatch();
    return {
      inserted: Number(obj.inserted ?? 0),
      updated: Number(obj.updated ?? 0),
      deleted: Number(obj.deleted ?? 0),
    };
  });
  if (!res.ok) return res;
  const { inserted, updated, deleted } = res.data;
  return { ok: true, data: res.data, message: `配車を保存しました（追加 ${inserted} 件／変更 ${updated} 件／外した ${deleted} 件）` };
}

/** 1 週間ぶんを別の週へ写す */
export async function copyDispatchWeekAction(fromStart: string, toStart: string): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = copyWeekSchema.parse({ from_start: fromStart, to_start: toStart });
    const { data, error } = await supabase.rpc("copy_dispatch_week", { p_from_start: v.from_start, p_to_start: v.to_start });
    if (error) throw error;
    revalidateDispatch();
    return { count: Number(data ?? 0) };
  });
  if (!res.ok) return res;
  const { count } = res.data;
  return {
    ok: true,
    data: res.data,
    message: count > 0 ? `前の週から ${count} 件を写しました` : "写せる配車がありませんでした（休みの日は写しません）",
  };
}

/** 予定を確定する（確定すると前日の通知に乗る） */
export async function confirmDispatchAction(from: string, to: string): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = dispatchRangeSchema.parse({ from, to });
    const { data, error } = await supabase.rpc("confirm_dispatch", { p_from: v.from, p_to: v.to });
    if (error) throw error;
    revalidateDispatch();
    return { count: Number(data ?? 0) };
  });
  if (!res.ok) return res;
  const { count } = res.data;
  return {
    ok: true,
    data: res.data,
    message: count > 0 ? `${count} 件を確定しました。前日の夕方にドライバーへ知らせます` : "確定する予定がありませんでした",
  };
}

/** 曜日ごとの必要人数 */
export async function setProjectDemandAction(input: ProjectDemandInput): Promise<ActionResult<{ need: number }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = projectDemandSchema.parse(input);
    const { error } = await supabase.rpc("set_project_demand", {
      p_project_item_id: v.project_item_id,
      p_weekday: v.weekday,
      p_need: v.need,
    });
    if (error) throw error;
    revalidateDispatch();
    return { need: v.need };
  }, "必要人数を保存しました");
}

/** 特定の日だけの必要人数（need が null なら曜日のパターンに戻す） */
export async function setProjectDemandDayAction(input: ProjectDemandDayInput): Promise<ActionResult<{ on_date: string }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = projectDemandDaySchema.parse(input);
    const { error } = await supabase.rpc("set_project_demand_day", {
      p_project_item_id: v.project_item_id,
      p_on_date: v.on_date,
      // 「特定日の指定をやめる」は -1 で伝える（DB 側は null も受ける）
      p_need: v.need ?? -1,
      p_note: v.note,
    });
    if (error) throw error;
    revalidateDispatch();
    return { on_date: v.on_date };
  }, "必要人数を保存しました");
}

/** 休みを申請する（ドライバー本人） */
export async function requestDayOffAction(input: DayOffRequestInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, profile } = await requireActionRole(["driver"]);
    if (!profile.driver_id) throw new ActionError("ドライバーの登録が見つかりません。管理者にお問い合わせください。");
    const v = dayOffRequestSchema.parse(input);
    const { data, error } = await supabase.rpc("request_day_off", { p_on_date: v.on_date, p_reason: v.reason });
    if (error) throw error;
    revalidateDispatch();
    return { id: String(data ?? "") };
  }, "休みを申請しました");
}

/** 休み希望を決める（管理者） */
export async function decideDayOffAction(input: DayOffDecisionInput): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = dayOffDecisionSchema.parse(input);
    const { error } = await supabase.rpc("decide_day_off", { p_id: v.id, p_approve: v.approve, p_note: v.note });
    if (error) throw error;
    revalidateDispatch();
    return { id: v.id, approve: v.approve };
  });
  if (!res.ok) return res;
  return { ok: true, data: { id: res.data.id }, message: res.data.approve ? "休みを承認しました" : "休み希望を見送りました" };
}

/** 定休日（曜日）を決める（管理者） */
export async function setWeeklyOffAction(input: WeeklyOffInput): Promise<ActionResult<{ driver_id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = weeklyOffSchema.parse(input);
    const weekdays = [...new Set(v.weekdays)].sort((a, b) => a - b);
    const { error } = await supabase.from("drivers").update({ weekly_off: weekdays }).eq("id", v.driver_id).eq("company_id", company.id);
    if (error) throw error;
    revalidateDispatch();
    return { driver_id: v.driver_id };
  }, "定休日を保存しました");
}
