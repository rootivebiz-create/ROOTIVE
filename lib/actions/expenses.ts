"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { requireAdminAction, type SessionContext } from "@/lib/auth/session";
import type { Database } from "@/lib/db/types";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import {
  applyRecurringExpensesSchema,
  expenseInputSchema,
  saveExpenseCategoriesSchema,
  saveRecurringExpensesSchema,
  type ExpenseCategoryRowInput,
  type ExpenseFormInput,
  type RecurringExpenseRowInput,
} from "@/lib/schemas/expenses";
import { monthToDate } from "@/lib/month";

type ExpenseCategoryInsert = Database["public"]["Tables"]["expense_categories"]["Insert"];
type RecurringExpenseInsert = Database["public"]["Tables"]["recurring_expenses"]["Insert"];

/** 経費の変更が影響する画面 */
const AFFECTED_PATHS = ["/expenses", "/settings/expenses", "/dashboard", "/reports"];

function revalidateExpenses(): void {
  for (const p of AFFECTED_PATHS) revalidatePath(p);
}

function uniqueIds(ids: (string | null | undefined)[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => typeof id === "string" && id !== ""))];
}

function assertKnown(res: { data: { id: string }[] | null; error: PostgrestError | null } | null, ids: string[], message: string): void {
  if (!res) return;
  ensureNoError(res);
  const known = new Set((res.data ?? []).map((r) => r.id));
  if (ids.some((id) => !known.has(id))) throw new ActionError(message);
}

/** カテゴリ・ドライバー・案件が自社のものか確認する（RLS により他社の行は見えない） */
async function assertRefs(
  ctx: SessionContext,
  refs: { categoryIds?: (string | null)[]; driverIds?: (string | null)[]; projectIds?: (string | null)[] },
): Promise<void> {
  const categoryIds = uniqueIds(refs.categoryIds);
  const driverIds = uniqueIds(refs.driverIds);
  const projectIds = uniqueIds(refs.projectIds);
  const [catRes, driverRes, projectRes] = await Promise.all([
    categoryIds.length > 0 ? ctx.supabase.from("expense_categories").select("id").eq("company_id", ctx.company.id).in("id", categoryIds) : null,
    driverIds.length > 0 ? ctx.supabase.from("drivers").select("id").eq("company_id", ctx.company.id).in("id", driverIds) : null,
    projectIds.length > 0 ? ctx.supabase.from("projects").select("id").eq("company_id", ctx.company.id).in("id", projectIds) : null,
  ]);
  assertKnown(catRes, categoryIds, "経費カテゴリが見つかりません。画面を再読み込みしてください。");
  assertKnown(driverRes, driverIds, "ドライバーが見つかりません。画面を再読み込みしてください。");
  assertKnown(projectRes, projectIds, "案件が見つかりません。画面を再読み込みしてください。");
}

// ---------------------------------------------------------------------------
// 経費（明細）
// ---------------------------------------------------------------------------

/** 経費の追加・更新（admin+。締め済み月は DB トリガーが拒否する） */
export async function saveExpenseAction(input: ExpenseFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const v = expenseInputSchema.parse(input);
    await assertRefs(ctx, { categoryIds: [v.category_id], driverIds: [v.driver_id], projectIds: [v.project_id] });

    const row = {
      month: monthToDate(v.month),
      category_id: v.category_id,
      label: v.label,
      amount: v.amount,
      tax_mode: v.tax_mode,
      incurred_on: v.incurred_on,
      driver_id: v.driver_id,
      project_id: v.project_id,
      vendor: v.vendor,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await ctx.supabase.from("expenses").update(row).eq("id", v.id).eq("company_id", ctx.company.id).select("id").maybeSingle(),
          "対象の経費が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await ctx.supabase.from("expenses").insert({ ...row, company_id: ctx.company.id }).select("id").single());

    revalidateExpenses();
    return { id: saved.id };
  }, "経費を保存しました");
}

/** 経費の削除（admin+） */
export async function deleteExpenseAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const expenseId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await ctx.supabase.from("expenses").delete().eq("id", expenseId).eq("company_id", ctx.company.id).select("id").maybeSingle(),
      "対象の経費が見つかりません（既に削除された可能性があります）。",
    );
    revalidateExpenses();
    return { id: row.id };
  }, "経費を削除しました");
}

/** 毎月かかる経費をその月に計上（admin+。未締め月のみ。二重計上はしない） */
export async function applyRecurringExpensesAction(month: string): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const ctx = await requireAdminAction();
    const v = applyRecurringExpensesSchema.parse({ month });
    const { data, error } = await ctx.supabase.rpc("apply_recurring_expenses", { p_month: monthToDate(v.month) });
    if (error) throw error;
    revalidateExpenses();
    return { count: Number(data ?? 0) };
  });
  if (!res.ok) return res;
  const { count } = res.data;
  return {
    ok: true,
    data: { count },
    message: count > 0 ? `${count} 件を計上しました` : "計上が必要な経費はありませんでした",
  };
}

// ---------------------------------------------------------------------------
// 経費カテゴリ（設定）
// ---------------------------------------------------------------------------

/**
 * 経費カテゴリの一括保存（admin+）
 * id ありは更新、id なしは追加、送られてこなかった既存 id は削除（使用中なら DB が拒否する）。
 * 並び順は配列の順序（sort_order = index）。
 */
export async function saveExpenseCategoriesAction(rows: ExpenseCategoryRowInput[]): Promise<ActionResult<{ inserted: number; updated: number; deleted: number }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { rows: parsed } = saveExpenseCategoriesSchema.parse({ rows });

    const existingRes = await supabase.from("expense_categories").select("id").eq("company_id", company.id);
    ensureNoError(existingRes);
    const existingIds = new Set((existingRes.data ?? []).map((r) => r.id));
    const keptIds = new Set(parsed.map((r) => r.id).filter((id): id is string => id != null && existingIds.has(id)));
    const removeIds = [...existingIds].filter((id) => !keptIds.has(id));

    const inserts: ExpenseCategoryInsert[] = [];
    const updates: PromiseLike<{ error: PostgrestError | null }>[] = [];
    parsed.forEach((r, i) => {
      const row = { name: r.name, kind: r.kind, memo: r.memo, is_active: r.is_active, sort_order: i };
      if (r.id && existingIds.has(r.id)) {
        updates.push(supabase.from("expense_categories").update(row).eq("id", r.id).eq("company_id", company.id));
      } else {
        inserts.push({ ...row, company_id: company.id });
      }
    });
    (await Promise.all(updates)).forEach(ensureNoError);
    if (inserts.length > 0) ensureNoError(await supabase.from("expense_categories").insert(inserts));
    // 削除は最後（使われているカテゴリは DB が 23503 で拒否する）
    if (removeIds.length > 0) ensureNoError(await supabase.from("expense_categories").delete().eq("company_id", company.id).in("id", removeIds));

    revalidateExpenses();
    return { inserted: inserts.length, updated: updates.length, deleted: removeIds.length };
  }, "経費カテゴリを保存しました");
}

/** 経費カテゴリの削除（admin+。経費・毎月かかる経費で使われていれば DB が拒否する） */
export async function deleteExpenseCategoryAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const categoryId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("expense_categories").delete().eq("id", categoryId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象のカテゴリが見つかりません（既に削除された可能性があります）。",
    );
    revalidateExpenses();
    return { id: row.id };
  }, "経費カテゴリを削除しました");
}

// ---------------------------------------------------------------------------
// 毎月かかる経費（設定）
// ---------------------------------------------------------------------------

/**
 * 毎月かかる経費の一括保存（admin+）
 * id ありは更新、id なしは追加、送られてこなかった既存 id は削除。並び順は配列の順序。
 */
export async function saveRecurringExpensesAction(rows: RecurringExpenseRowInput[]): Promise<ActionResult<{ inserted: number; updated: number; deleted: number }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company } = ctx;
    const { rows: parsed } = saveRecurringExpensesSchema.parse({ rows });
    await assertRefs(ctx, {
      categoryIds: parsed.map((r) => r.category_id),
      driverIds: parsed.map((r) => r.driver_id),
      projectIds: parsed.map((r) => r.project_id),
    });

    const existingRes = await supabase.from("recurring_expenses").select("id").eq("company_id", company.id);
    ensureNoError(existingRes);
    const existingIds = new Set((existingRes.data ?? []).map((r) => r.id));
    const keptIds = new Set(parsed.map((r) => r.id).filter((id): id is string => id != null && existingIds.has(id)));
    const removeIds = [...existingIds].filter((id) => !keptIds.has(id));

    const inserts: RecurringExpenseInsert[] = [];
    const updates: PromiseLike<{ error: PostgrestError | null }>[] = [];
    parsed.forEach((r, i) => {
      const row = {
        category_id: r.category_id,
        label: r.label,
        amount: r.amount,
        tax_mode: r.tax_mode,
        driver_id: r.driver_id,
        project_id: r.project_id,
        vendor: r.vendor,
        start_month: r.start_month == null ? null : monthToDate(r.start_month),
        end_month: r.end_month == null ? null : monthToDate(r.end_month),
        is_active: r.is_active,
        sort_order: i,
      };
      if (r.id && existingIds.has(r.id)) {
        updates.push(supabase.from("recurring_expenses").update(row).eq("id", r.id).eq("company_id", company.id));
      } else {
        inserts.push({ ...row, company_id: company.id });
      }
    });
    (await Promise.all(updates)).forEach(ensureNoError);
    if (inserts.length > 0) {
      ensureNoError(await supabase.from("recurring_expenses").insert(inserts));
    }
    if (removeIds.length > 0) ensureNoError(await supabase.from("recurring_expenses").delete().eq("company_id", company.id).in("id", removeIds));

    revalidateExpenses();
    return { inserted: inserts.length, updated: updates.length, deleted: removeIds.length };
  }, "毎月かかる経費を保存しました");
}
