"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import { reorderInputSchema, type ReorderInput } from "@/lib/schemas/drivers";
import { projectInputSchema, type ProjectFormInput } from "@/lib/schemas/projects";
import type { ServerSupabase } from "@/lib/supabase/server";

/** 案件・単価の変更が影響する画面 */
function revalidateProjectPaths() {
  revalidatePath("/settings/projects", "layout");
  revalidatePath("/settings/drivers", "layout");
  revalidatePath("/entries");
  revalidatePath("/payouts", "layout");
  revalidatePath("/projects");
  revalidatePath("/invoices", "layout");
  revalidatePath("/settings/clients");
  revalidatePath("/dashboard");
}

/** 指定の案件内容を参照する稼働行があるか */
async function itemsHaveEntries(supabase: ServerSupabase, itemIds: string[]): Promise<boolean> {
  if (itemIds.length === 0) return false;
  const res = await supabase.from("work_entries").select("id", { count: "exact" }).in("project_item_id", itemIds).limit(1);
  ensureNoError(res);
  return (res.count ?? res.data?.length ?? 0) > 0;
}

/** 案件の新規登録・更新（内容の行を含む） */
export async function saveProjectAction(input: ProjectFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = projectInputSchema.parse(input);

    // 案件名は会社内で一意
    let dupQuery = supabase.from("projects").select("id").eq("company_id", company.id).eq("name", parsed.name).limit(1);
    if (parsed.id) dupQuery = dupQuery.neq("id", parsed.id);
    const dup = await dupQuery;
    ensureNoError(dup);
    if ((dup.data ?? []).length > 0) {
      throw new ActionError("同じ名前の案件が既に登録されています。", { name: ["同じ名前の案件が既に登録されています"] });
    }

    // 取引先を外すときは client_name も空にする（残っていると DB トリガーが同名の取引先へ再リンクするため）
    const fields = {
      name: parsed.name,
      client_id: parsed.client_id,
      ...(parsed.client_id == null ? { client_name: "" } : {}),
      is_active: parsed.is_active,
      memo: parsed.memo,
    };
    let projectId: string;
    if (parsed.id) {
      const res = await supabase.from("projects").update(fields).eq("id", parsed.id).eq("company_id", company.id).select("id").single();
      projectId = unwrap(res, "案件が見つかりません。").id;
    } else {
      const maxRes = await supabase.from("projects").select("sort_order").eq("company_id", company.id).order("sort_order", { ascending: false }).limit(1);
      ensureNoError(maxRes);
      const sort_order = Number(maxRes.data?.[0]?.sort_order ?? 0) + 1;
      const res = await supabase.from("projects").insert({ ...fields, company_id: company.id, sort_order }).select("id").single();
      projectId = unwrap(res).id;
    }

    // 内容：id ありは更新、id なしは追加、送られてこなかった id は削除（稼働行があれば拒否）
    const existingRes = await supabase.from("project_items").select("id").eq("project_id", projectId);
    ensureNoError(existingRes);
    const existingIds = new Set((existingRes.data ?? []).map((r) => r.id));
    const keptIds = new Set(parsed.items.map((r) => r.id).filter((id): id is string => id != null && existingIds.has(id)));
    const removeIds = [...existingIds].filter((id) => !keptIds.has(id));
    if (removeIds.length > 0) {
      if (await itemsHaveEntries(supabase, removeIds)) {
        throw new ActionError("稼働行がある内容は削除できません。停止中にしてください。");
      }
      const del = await supabase.from("project_items").delete().eq("project_id", projectId).in("id", removeIds);
      if (del.error) {
        if (del.error.code === "23503") throw new ActionError("稼働行がある内容は削除できません。停止中にしてください。");
        throw del.error;
      }
    }

    const inserts: {
      company_id: string;
      project_id: string;
      name: string;
      unit: "day" | "piece";
      bill_rate: number;
      pay_rate: number;
      is_active: boolean;
      sort_order: number;
    }[] = [];
    const updates: PromiseLike<{ error: PostgrestError | null }>[] = [];
    parsed.items.forEach((item, i) => {
      const row = { name: item.name, unit: item.unit, bill_rate: item.bill_rate, pay_rate: item.pay_rate, is_active: item.is_active, sort_order: i };
      if (item.id && existingIds.has(item.id)) {
        updates.push(supabase.from("project_items").update(row).eq("id", item.id).eq("project_id", projectId));
      } else {
        inserts.push({ ...row, company_id: company.id, project_id: projectId });
      }
    });
    (await Promise.all(updates)).forEach(ensureNoError);
    if (inserts.length > 0) {
      ensureNoError(await supabase.from("project_items").insert(inserts));
    }

    revalidateProjectPaths();
    return { id: projectId };
  }, "保存しました");
}

/** 案件の削除（内容を参照する稼働行があれば拒否） */
export async function deleteProjectAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const projectId = uuidSchema.parse(id);

    const itemsRes = await supabase.from("project_items").select("id").eq("project_id", projectId);
    ensureNoError(itemsRes);
    const itemIds = (itemsRes.data ?? []).map((r) => r.id);
    if (await itemsHaveEntries(supabase, itemIds)) {
      throw new ActionError("稼働行があるため削除できません。停止中にしてください。");
    }

    if (itemIds.length > 0) {
      const delItems = await supabase.from("project_items").delete().eq("project_id", projectId);
      if (delItems.error) {
        if (delItems.error.code === "23503") throw new ActionError("稼働行があるため削除できません。停止中にしてください。");
        throw delItems.error;
      }
    }
    const res = await supabase.from("projects").delete().eq("id", projectId).eq("company_id", company.id).select("id");
    if (res.error) {
      if (res.error.code === "23503") throw new ActionError("他のデータから参照されているため削除できません。停止中にしてください。");
      throw res.error;
    }
    if ((res.data ?? []).length === 0) throw new ActionError("案件が見つかりません。");

    revalidateProjectPaths();
    return null;
  }, "削除しました");
}

/** 並び替え（↑↓）。sort_order を連番に振り直し、変わった行だけ更新する */
export async function reorderProjectsAction(input: ReorderInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { id, direction } = reorderInputSchema.parse(input);
    const listRes = await supabase.from("projects").select("id, sort_order").eq("company_id", company.id).order("sort_order").order("name");
    ensureNoError(listRes);
    const rows = listRes.data ?? [];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new ActionError("案件が見つかりません。");
    const j = direction === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= rows.length) return null;
    const order = [...rows];
    [order[idx], order[j]] = [order[j], order[idx]];
    const changed = order.map((r, i) => ({ id: r.id, sort_order: i + 1 })).filter((u) => rows.find((r) => r.id === u.id)?.sort_order !== u.sort_order);
    const results = await Promise.all(changed.map((u) => supabase.from("projects").update({ sort_order: u.sort_order }).eq("id", u.id).eq("company_id", company.id)));
    results.forEach(ensureNoError);
    revalidateProjectPaths();
    return null;
  });
}
