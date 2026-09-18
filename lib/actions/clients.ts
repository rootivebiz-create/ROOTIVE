"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import { clientInputSchema, type ClientFormInput } from "@/lib/schemas/clients";
import { reorderInputSchema, type ReorderInput } from "@/lib/schemas/drivers";

/** 取引先の変更が影響する画面 */
function revalidateClientPaths() {
  revalidatePath("/settings/clients");
  revalidatePath("/settings/projects", "layout");
  revalidatePath("/invoices", "layout");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

/** 取引先の新規登録・更新（名称は会社内で一意。名称変更は DB トリガーが projects.client_name へ反映する） */
export async function saveClientAction(input: ClientFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = clientInputSchema.parse(input);

    let dupQuery = supabase.from("clients").select("id").eq("company_id", company.id).eq("name", parsed.name).limit(1);
    if (parsed.id) dupQuery = dupQuery.neq("id", parsed.id);
    const dup = await dupQuery;
    ensureNoError(dup);
    if ((dup.data ?? []).length > 0) {
      throw new ActionError("同じ名前の取引先が既に登録されています。", { name: ["同じ名前の取引先が既に登録されています"] });
    }

    const fields = {
      name: parsed.name,
      honorific: parsed.honorific,
      address: parsed.address,
      tel: parsed.tel,
      invoice_reg_no: parsed.invoice_reg_no,
      payment_month_offset: parsed.payment_month_offset,
      payment_day: parsed.payment_day,
      memo: parsed.memo,
      is_active: parsed.is_active,
    };

    let clientId: string;
    if (parsed.id) {
      const res = await supabase.from("clients").update(fields).eq("id", parsed.id).eq("company_id", company.id).select("id").single();
      clientId = unwrap(res, "取引先が見つかりません。").id;
    } else {
      const maxRes = await supabase.from("clients").select("sort_order").eq("company_id", company.id).order("sort_order", { ascending: false }).limit(1);
      ensureNoError(maxRes);
      const sort_order = Number(maxRes.data?.[0]?.sort_order ?? 0) + 1;
      const res = await supabase.from("clients").insert({ ...fields, company_id: company.id, sort_order }).select("id").single();
      clientId = unwrap(res).id;
    }

    revalidateClientPaths();
    return { id: clientId };
  }, "保存しました");
}

/** 取引先の削除（案件・請求書から参照されていれば拒否） */
export async function deleteClientAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const clientId = uuidSchema.parse(id);

    const projectsRes = await supabase.from("projects").select("id").eq("company_id", company.id).eq("client_id", clientId).limit(1);
    ensureNoError(projectsRes);
    if ((projectsRes.data ?? []).length > 0) {
      throw new ActionError("この取引先を設定した案件があるため削除できません。案件の取引先を変更するか、停止中にしてください。");
    }
    const invoicesRes = await supabase.from("invoices").select("id").eq("company_id", company.id).eq("client_id", clientId).limit(1);
    ensureNoError(invoicesRes);
    if ((invoicesRes.data ?? []).length > 0) {
      throw new ActionError("請求書があるため削除できません。停止中にしてください。");
    }

    const res = await supabase.from("clients").delete().eq("id", clientId).eq("company_id", company.id).select("id");
    if (res.error) {
      if (res.error.code === "23503") throw new ActionError("他のデータから参照されているため削除できません。停止中にしてください。");
      throw res.error;
    }
    if ((res.data ?? []).length === 0) throw new ActionError("取引先が見つかりません。");

    revalidateClientPaths();
    return null;
  }, "削除しました");
}

/** 並び替え（↑↓）。sort_order を連番に振り直し、変わった行だけ更新する */
export async function reorderClientsAction(input: ReorderInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { id, direction } = reorderInputSchema.parse(input);
    const listRes = await supabase.from("clients").select("id, sort_order").eq("company_id", company.id).order("sort_order").order("name");
    ensureNoError(listRes);
    const rows = listRes.data ?? [];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new ActionError("取引先が見つかりません。");
    const j = direction === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= rows.length) return null;
    const order = [...rows];
    [order[idx], order[j]] = [order[j], order[idx]];
    const changed = order.map((r, i) => ({ id: r.id, sort_order: i + 1 })).filter((u) => rows.find((r) => r.id === u.id)?.sort_order !== u.sort_order);
    const results = await Promise.all(changed.map((u) => supabase.from("clients").update({ sort_order: u.sort_order }).eq("id", u.id).eq("company_id", company.id)));
    results.forEach(ensureNoError);

    revalidateClientPaths();
    return null;
  });
}
