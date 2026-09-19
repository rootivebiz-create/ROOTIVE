"use server";

import { revalidatePath } from "next/cache";
import { requireActionRole, requireAdminAction, type SessionContext } from "@/lib/auth/session";
import { ActionError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import type { Database } from "@/lib/db/types";
import { uuidSchema } from "@/lib/schemas/common";
import {
  applyDayEntriesSchema,
  approveDayEntriesSchema,
  dailyReportInputSchema,
  submitDayEntriesSchema,
  type DailyReportFormInput,
  type DayEntryRowInput,
} from "@/lib/schemas/daily";
import { alcoholOk, jstLocalToIso } from "@/lib/daily/helpers";
import { dateToMonth, monthToDate } from "@/lib/month";

type DailyReportInsert = Database["public"]["Tables"]["daily_reports"]["Insert"];

/** 日報・稼働報告の変更が影響する画面 */
const AFFECTED_PATHS = ["/daily", "/driver/today", "/dashboard", "/entries", "/payouts", "/alerts"];

function revalidateDaily(): void {
  for (const p of AFFECTED_PATHS) revalidatePath(p);
}

interface DailyActor {
  ctx: SessionContext;
  /** ドライバー本人として操作しているか */
  isDriver: boolean;
  /** ドライバー本人のときの自分の driver_id */
  ownDriverId: string | null;
}

/** 日報・稼働報告を書けるのは admin 以上かドライバー本人 */
async function requireDailyActor(): Promise<DailyActor> {
  const ctx = await requireActionRole(["owner", "admin", "driver"]);
  const isDriver = ctx.profile.role === "driver";
  if (isDriver && !ctx.profile.driver_id) throw new ActionError("ドライバーの登録が見つかりません。管理者にお問い合わせください。");
  return { ctx, isDriver, ownDriverId: ctx.profile.driver_id };
}

/** 対象のドライバー（本人は自分、スタッフは指定された相手） */
function resolveDriverId(actor: DailyActor, requested: string | null | undefined): string {
  if (actor.isDriver) return actor.ownDriverId as string;
  if (!requested) throw new ActionError("ドライバーを選択してください。");
  return requested;
}

/**
 * 点呼の時刻を決める
 * - 未指定（undefined）：既に記録があればそのまま、無ければ「今」
 * - ""：今
 * - "YYYY-MM-DDTHH:MM"：日本時間として解釈した時刻
 * 戻り値が undefined の列は更新しない（既存の値が残る）
 */
function resolveAt(at: string | undefined, existing: string | null | undefined, nowIso: string): string | undefined {
  if (at === undefined) return existing ? undefined : nowIso;
  if (at === "") return nowIso;
  return jstLocalToIso(at) ?? undefined;
}

/**
 * 日報（業務前点呼・業務後点呼・業務記録）の保存（ドライバー本人または admin+）
 * 渡された区分だけを更新する（渡されなかった項目は既存の値が残る）。締め済み月は DB トリガーが拒否する。
 */
export async function saveDailyReportAction(input: DailyReportFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireDailyActor();
    const { supabase, company, user } = actor.ctx;
    const v = dailyReportInputSchema.parse(input);
    const driverId = resolveDriverId(actor, v.driver_id);
    const nowIso = new Date().toISOString();

    // 既存の行（あれば時刻をそのまま残す・created_by を上書きしない）
    const existingRes = await supabase
      .from("daily_reports")
      .select("id, pre_at, post_at, start_at, end_at")
      .eq("company_id", company.id)
      .eq("work_date", v.work_date)
      .eq("driver_id", driverId)
      .maybeSingle();
    if (existingRes.error) throw existingRes.error;
    const existing = existingRes.data;

    const row: DailyReportInsert = {
      company_id: company.id,
      work_date: v.work_date,
      month: monthToDate(dateToMonth(v.work_date)),
      driver_id: driverId,
      updated_by: user.id,
    };
    if (!existing) row.created_by = user.id;
    if (v.vehicle_id !== undefined) row.vehicle_id = v.vehicle_id;

    if (v.pre) {
      const at = resolveAt(v.pre.at, existing?.pre_at, nowIso);
      if (at !== undefined) row.pre_at = at;
      if (v.pre.method !== undefined) row.pre_method = v.pre.method;
      if (v.pre.alcohol !== undefined) row.pre_alcohol = v.pre.alcohol;
      const ok = v.pre.alcohol_ok ?? (v.pre.alcohol !== undefined ? alcoholOk(v.pre.alcohol) : undefined);
      if (ok !== undefined) row.pre_alcohol_ok = ok;
      if (v.pre.health_ok !== undefined) row.pre_health_ok = v.pre.health_ok;
      if (v.pre.inspection_ok !== undefined) row.pre_inspection_ok = v.pre.inspection_ok;
      if (v.pre.instruction !== undefined) row.pre_instruction = v.pre.instruction;
      row.pre_by = user.id;
    }

    if (v.post) {
      const at = resolveAt(v.post.at, existing?.post_at, nowIso);
      if (at !== undefined) row.post_at = at;
      if (v.post.method !== undefined) row.post_method = v.post.method;
      if (v.post.alcohol !== undefined) row.post_alcohol = v.post.alcohol;
      const ok = v.post.alcohol_ok ?? (v.post.alcohol !== undefined ? alcoholOk(v.post.alcohol) : undefined);
      if (ok !== undefined) row.post_alcohol_ok = ok;
      if (v.post.condition_ok !== undefined) row.post_condition_ok = v.post.condition_ok;
      if (v.post.incident !== undefined) row.post_incident = v.post.incident;
      row.post_by = user.id;
    }

    if (v.work) {
      if (v.work.start !== undefined) {
        const at = resolveAt(v.work.start, existing?.start_at, nowIso);
        if (at !== undefined) row.start_at = at;
      }
      if (v.work.end !== undefined) {
        const at = resolveAt(v.work.end, existing?.end_at, nowIso);
        if (at !== undefined) row.end_at = at;
      }
      if (v.work.break_minutes !== undefined) row.break_minutes = v.work.break_minutes;
      if (v.work.distance_km !== undefined) row.distance_km = v.work.distance_km;
      if (v.work.odo_start !== undefined) row.odo_start = v.work.odo_start;
      if (v.work.odo_end !== undefined) row.odo_end = v.work.odo_end;
      if (v.work.memo !== undefined) row.memo = v.work.memo;
    }

    const saved = unwrap<{ id: string }>(
      await supabase.from("daily_reports").upsert(row, { onConflict: "company_id,work_date,driver_id" }).select("id").single(),
    );

    revalidateDaily();
    return { id: saved.id };
  }, "記録しました");
}

/**
 * 日別の稼働報告の送信（ドライバー本人または admin+。RPC submit_day_entries）
 * 数量 0 の行は削除される。承認済みの月次稼働へは DB トリガーが自動で反映する。
 */
export async function submitDayEntriesAction(
  workDate: string,
  rows: DayEntryRowInput[],
  driverId?: string | null,
  memo?: string,
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const actor = await requireDailyActor();
    const v = submitDayEntriesSchema.parse({ work_date: workDate, rows, driver_id: driverId, memo });
    const targetId = resolveDriverId(actor, v.driver_id);

    const { data, error } = await actor.ctx.supabase.rpc("submit_day_entries", {
      p_work_date: v.work_date,
      p_item_ids: v.rows.map((r) => r.project_item_id),
      p_qtys: v.rows.map((r) => r.qty),
      // ドライバー本人のときは DB 側で自分の分に固定される（引数は無視される）
      p_driver_id: actor.isDriver ? undefined : targetId,
      p_memo: v.memo,
    });
    if (error) throw error;

    revalidateDaily();
    return { count: Number(data ?? 0) };
  }, "今日の稼働を送信しました");
}

/** 日別の稼働報告の承認・差戻し（admin+。RPC approve_day_entries） */
export async function approveDayEntriesAction(ids: string[], approve: boolean, reason?: string): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = approveDayEntriesSchema.parse({ ids, approve, reason });
    const { data, error } = await supabase.rpc("approve_day_entries", { p_ids: v.ids, p_approve: v.approve, p_reason: v.reason });
    if (error) throw error;
    revalidateDaily();
    return { count: Number(data ?? 0), approve: v.approve };
  });
  if (!res.ok) return res;
  const { count, approve: approved } = res.data;
  return { ok: true, data: { count }, message: approved ? `${count} 件を承認しました` : `${count} 件を差し戻しました` };
}

/** その月の承認済みの日別を月次の稼働へ反映し直す（admin+。RPC apply_day_entries） */
export async function applyDayEntriesAction(month: string): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = applyDayEntriesSchema.parse({ month });
    const { data, error } = await supabase.rpc("apply_day_entries", { p_month: monthToDate(v.month) });
    if (error) throw error;
    revalidateDaily();
    return { count: Number(data ?? 0) };
  });
  if (!res.ok) return res;
  const { count } = res.data;
  return { ok: true, data: { count }, message: count > 0 ? `${count} 件を月次に反映しました` : "反映が必要な稼働はありませんでした" };
}

/** 日報の削除（admin+。締め済み月は DB トリガーが拒否する） */
export async function deleteDailyReportAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const reportId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("daily_reports").delete().eq("id", reportId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の日報が見つかりません（既に削除された可能性があります）。",
    );
    revalidateDaily();
    return { id: row.id };
  }, "日報を削除しました");
}
