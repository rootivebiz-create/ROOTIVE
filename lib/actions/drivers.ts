"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import { driverInputSchema, reorderInputSchema, type DriverFormInput, type ReorderInput } from "@/lib/schemas/drivers";
import type { ServerSupabase } from "@/lib/supabase/server";

/** ドライバー設定の変更が影響する画面 */
function revalidateDriverPaths() {
  revalidatePath("/settings/drivers", "layout");
  revalidatePath("/entries");
  revalidatePath("/payouts");
  revalidatePath("/dashboard");
}

/** 参照件数（1 件以上あるか）を調べる */
async function hasRows(query: PromiseLike<{ count: number | null; data: unknown[] | null; error: unknown }>): Promise<boolean> {
  const res = await query;
  if (res.error) throw res.error;
  return (res.count ?? res.data?.length ?? 0) > 0;
}

/** ドライバーの新規登録・更新（個別単価・固定控除を含む） */
export async function saveDriverAction(input: DriverFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = driverInputSchema.parse(input);

    // 名前は会社内で一意
    let dupQuery = supabase.from("drivers").select("id").eq("company_id", company.id).eq("name", parsed.name).limit(1);
    if (parsed.id) dupQuery = dupQuery.neq("id", parsed.id);
    const dup = await dupQuery;
    ensureNoError(dup);
    if ((dup.data ?? []).length > 0) {
      throw new ActionError("同じ名前のドライバーが既に登録されています。", { name: ["同じ名前のドライバーが既に登録されています"] });
    }

    const fields = {
      name: parsed.name,
      kana: parsed.kana,
      is_active: parsed.is_active,
      royalty_rate: parsed.royalty_rate,
      mgmt_fee: parsed.mgmt_fee,
      rounding_mode: parsed.rounding_mode,
      phone: parsed.phone,
      email: parsed.email,
      bank_info: parsed.bank_info,
      memo: parsed.memo,
    };

    let driverId: string;
    if (parsed.id) {
      const res = await supabase.from("drivers").update(fields).eq("id", parsed.id).eq("company_id", company.id).select("id").single();
      driverId = unwrap(res, "ドライバーが見つかりません。").id;
    } else {
      const maxRes = await supabase.from("drivers").select("sort_order").eq("company_id", company.id).order("sort_order", { ascending: false }).limit(1);
      ensureNoError(maxRes);
      const sort_order = Number(maxRes.data?.[0]?.sort_order ?? 0) + 1;
      const res = await supabase.from("drivers").insert({ ...fields, company_id: company.id, sort_order }).select("id").single();
      driverId = unwrap(res).id;
    }

    // 個別支払単価：空欄は削除、値ありは upsert
    const overrideDeletes = parsed.overrides.filter((o) => o.pay_rate == null).map((o) => o.project_item_id);
    const overrideUpserts = parsed.overrides
      .filter((o): o is { project_item_id: string; pay_rate: number } => o.pay_rate != null)
      .map((o) => ({ company_id: company.id, driver_id: driverId, project_item_id: o.project_item_id, pay_rate: o.pay_rate }));
    if (overrideDeletes.length > 0) {
      ensureNoError(await supabase.from("driver_pay_overrides").delete().eq("driver_id", driverId).in("project_item_id", overrideDeletes));
    }
    if (overrideUpserts.length > 0) {
      ensureNoError(await supabase.from("driver_pay_overrides").upsert(overrideUpserts, { onConflict: "driver_id,project_item_id" }));
    }

    // 固定控除：id ありは更新、id なしは追加、送られてこなかった id は削除
    const existingRes = await supabase.from("driver_recurring_adjustments").select("id").eq("driver_id", driverId);
    ensureNoError(existingRes);
    const existingIds = new Set((existingRes.data ?? []).map((r) => r.id));
    const keptIds = new Set(parsed.recurring.map((r) => r.id).filter((id): id is string => id != null && existingIds.has(id)));
    const removeIds = [...existingIds].filter((id) => !keptIds.has(id));
    if (removeIds.length > 0) {
      ensureNoError(await supabase.from("driver_recurring_adjustments").delete().eq("driver_id", driverId).in("id", removeIds));
    }
    const inserts: {
      company_id: string;
      driver_id: string;
      label: string;
      amount: number;
      count_as_profit: boolean;
      is_active: boolean;
      sort_order: number;
    }[] = [];
    const updates: PromiseLike<{ error: PostgrestError | null }>[] = [];
    parsed.recurring.forEach((r, i) => {
      const row = { label: r.label, amount: r.amount, count_as_profit: r.count_as_profit, is_active: r.is_active, sort_order: i };
      if (r.id && existingIds.has(r.id)) {
        updates.push(supabase.from("driver_recurring_adjustments").update(row).eq("id", r.id).eq("driver_id", driverId));
      } else {
        inserts.push({ ...row, company_id: company.id, driver_id: driverId });
      }
    });
    (await Promise.all(updates)).forEach(ensureNoError);
    if (inserts.length > 0) {
      ensureNoError(await supabase.from("driver_recurring_adjustments").insert(inserts));
    }

    revalidateDriverPaths();
    return { id: driverId };
  }, "保存しました");
}

/** ドライバーの削除（稼働行・月別データがあれば拒否） */
export async function deleteDriverAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const driverId = uuidSchema.parse(id);

    if (await hasRows(supabase.from("work_entries").select("id", { count: "exact" }).eq("driver_id", driverId).limit(1))) {
      throw new ActionError("稼働行があるため削除できません。停止中にしてください。");
    }
    if (await hasRows(supabase.from("driver_months").select("id", { count: "exact" }).eq("driver_id", driverId).limit(1))) {
      throw new ActionError("月別データ（管理費・調整）があるため削除できません。停止中にしてください。");
    }
    if (await hasRows(supabase.from("profiles").select("id", { count: "exact" }).eq("driver_id", driverId).limit(1))) {
      throw new ActionError("ドライバーのユーザーアカウントが紐づいているため削除できません。停止中にしてください。");
    }

    const res = await supabase.from("drivers").delete().eq("id", driverId).eq("company_id", company.id).select("id");
    if (res.error) {
      if (res.error.code === "23503" || res.error.code === "23514") {
        throw new ActionError("他のデータから参照されているため削除できません。停止中にしてください。");
      }
      throw res.error;
    }
    if ((res.data ?? []).length === 0) throw new ActionError("ドライバーが見つかりません。");

    revalidateDriverPaths();
    return null;
  }, "削除しました");
}

/** 並び替え（↑↓）。sort_order を連番に振り直し、変わった行だけ更新する */
export async function reorderDriversAction(input: ReorderInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { id, direction } = reorderInputSchema.parse(input);
    await reorderRows(supabase, "drivers", company.id, id, direction);
    revalidateDriverPaths();
    return null;
  });
}

/** drivers / projects 共通の並び替え処理（同じ sort_order が並んでいても壊れないよう連番へ正規化） */
async function reorderRows(supabase: ServerSupabase, table: "drivers" | "projects", companyId: string, id: string, direction: "up" | "down"): Promise<void> {
  const listRes = await supabase.from(table).select("id, sort_order").eq("company_id", companyId).order("sort_order").order("name");
  ensureNoError(listRes);
  const rows = listRes.data ?? [];
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) throw new ActionError("対象のデータが見つかりません。");
  const j = direction === "up" ? idx - 1 : idx + 1;
  if (j < 0 || j >= rows.length) return;
  const order = [...rows];
  [order[idx], order[j]] = [order[j], order[idx]];
  const changed = order.map((r, i) => ({ id: r.id, sort_order: i + 1 })).filter((u) => rows.find((r) => r.id === u.id)?.sort_order !== u.sort_order);
  const results = await Promise.all(changed.map((u) => supabase.from(table).update({ sort_order: u.sort_order }).eq("id", u.id).eq("company_id", companyId)));
  results.forEach(ensureNoError);
}
