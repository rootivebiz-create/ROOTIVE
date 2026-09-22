"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction, type SessionContext } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { monthSchema, uuidSchema } from "@/lib/schemas/common";
import {
  bulkSetEntriesSchema,
  entryInputSchema,
  quickSetEntriesSchema,
  type BulkRowInput,
  type BulkSetEntriesResult,
  type EntryInput,
  type EntryValues,
  type QuickRowInput,
} from "@/lib/schemas/entries";
import { monthToDate, formatMonthJa, prevMonth } from "@/lib/month";

/** 稼働行の変更が影響する画面 */
const AFFECTED_PATHS = ["/entries", "/entries/bulk", "/dashboard", "/payouts", "/projects", "/settings/months"];

function revalidateEntries(): void {
  for (const p of AFFECTED_PATHS) revalidatePath(p);
}

/** ドライバー・案件内容が自社のものか確認する（RLS により他社の行は見えない） */
async function assertMastersExist(ctx: SessionContext, driverId: string, projectItemId: string): Promise<void> {
  const [driverRes, itemRes] = await Promise.all([
    ctx.supabase.from("drivers").select("id").eq("company_id", ctx.company.id).eq("id", driverId).maybeSingle(),
    ctx.supabase.from("project_items").select("id").eq("company_id", ctx.company.id).eq("id", projectItemId).maybeSingle(),
  ]);
  ensureNoError(driverRes);
  ensureNoError(itemRes);
  if (!driverRes.data) throw new ActionError("ドライバーが見つかりません。", { driver_id: ["ドライバーを選択してください"] });
  if (!itemRes.data) throw new ActionError("案件内容が見つかりません。", { project_item_id: ["案件を選択してください"] });
}

function toRow(ctx: SessionContext, v: EntryValues) {
  return {
    company_id: ctx.company.id,
    month: monthToDate(v.month),
    driver_id: v.driver_id,
    project_item_id: v.project_item_id,
    qty: v.qty,
    bill_rate: v.bill_rate,
    pay_rate: v.pay_rate,
    royalty_rate: v.royalty_percent,
    rounding_mode: v.rounding_mode,
    memo: v.memo,
  };
}

/** 稼働行の追加（driver_months は DB トリガーが自動作成） */
export async function createEntryAction(input: EntryInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const v = entryInputSchema.parse(input);
    // 数量 0 は「前月から複製」直後の未入力状態としてのみ許容する（§7）。手入力の新規行は 0 より大きいこと
    if (!(v.qty > 0)) throw new ActionError("数量は 0 より大きい値を入力してください。", { qty: ["数量は 0 より大きい値を入力してください"] });
    await assertMastersExist(ctx, v.driver_id, v.project_item_id);
    const row = unwrap<{ id: string }>(await ctx.supabase.from("work_entries").insert(toRow(ctx, v)).select("id").single());
    revalidateEntries();
    return { id: row.id };
  }, "稼働を追加しました");
}

/** 稼働行の更新 */
export async function updateEntryAction(id: string, input: EntryInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const entryId = uuidSchema.parse(id);
    const v = entryInputSchema.parse(input);
    await assertMastersExist(ctx, v.driver_id, v.project_item_id);
    const row = unwrap<{ id: string }>(
      await ctx.supabase.from("work_entries").update(toRow(ctx, v)).eq("id", entryId).eq("company_id", ctx.company.id).select("id").maybeSingle(),
      "対象の稼働行が見つかりません（既に削除された可能性があります）。",
    );
    revalidateEntries();
    return { id: row.id };
  }, "稼働を更新しました");
}

/** 稼働行の削除（物理削除） */
export async function deleteEntryAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const entryId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await ctx.supabase.from("work_entries").delete().eq("id", entryId).eq("company_id", ctx.company.id).select("id").maybeSingle(),
      "対象の稼働行が見つかりません（既に削除された可能性があります）。",
    );
    revalidateEntries();
    return { id: row.id };
  }, "稼働を削除しました");
}

/** 前月から複製（数量 0。単価・率・端数処理は現在のマスタから再取得。冪等） */
export async function copyPreviousMonthAction(month: string): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async () => {
    const ctx = await requireAdminAction();
    const m = monthSchema.parse(month);
    const { data, error } = await ctx.supabase.rpc("copy_previous_month", { p_month: monthToDate(m) });
    if (error) throw error;
    revalidateEntries();
    return { count: Number(data ?? 0), month: m };
  });
  if (!res.ok) return res;
  const { count, month: m } = res.data;
  return {
    ok: true,
    data: { count },
    message:
      count > 0
        ? `${formatMonthJa(prevMonth(m))}から ${count} 件を複製しました。数量を入力してください。`
        : "複製対象がありません（既に存在するか、前月にデータがありません）。",
  };
}

/** 一括入力（案件内容 1 つに対し複数ドライバーの数量をまとめて保存） */
export async function bulkSetEntriesAction(month: string, projectItemId: string, rows: BulkRowInput[]): Promise<ActionResult<BulkSetEntriesResult>> {
  const res = await runAction(async () => {
    const ctx = await requireAdminAction();
    const v = bulkSetEntriesSchema.parse({ month, project_item_id: projectItemId, rows });
    const itemRes = await ctx.supabase.from("project_items").select("id").eq("company_id", ctx.company.id).eq("id", v.project_item_id).maybeSingle();
    ensureNoError(itemRes);
    if (!itemRes.data) throw new ActionError("案件内容が見つかりません。");
    const { data, error } = await ctx.supabase.rpc("bulk_set_entries", {
      p_month: monthToDate(v.month),
      p_project_item_id: v.project_item_id,
      p_rows: v.rows.map((r) => ({ driver_id: r.driver_id, qty: r.qty })),
    });
    if (error) throw error;
    const obj = (data ?? {}) as Record<string, unknown>;
    revalidateEntries();
    return {
      inserted: Number(obj.inserted ?? 0),
      updated: Number(obj.updated ?? 0),
      deleted: Number(obj.deleted ?? 0),
    };
  });
  if (!res.ok) return res;
  const { inserted, updated, deleted } = res.data;
  return { ok: true, data: res.data, message: `保存しました（追加 ${inserted} 件／更新 ${updated} 件／削除 ${deleted} 件）` };
}

/**
 * まとめて数量だけ保存する（声で入力・その場入力）
 *
 * 案件内容ごとに既存の `bulk_set_entries` を呼ぶだけで、単価・率・端数処理は
 * DB 側が現在のマスタから決める（§7。アプリ側で単価を組み立てない）。
 * 既存の行があれば数量だけが変わり、単価のスナップショットはそのまま残る。
 */
export async function quickSetEntriesAction(month: string, rows: QuickRowInput[]): Promise<ActionResult<BulkSetEntriesResult>> {
  const res = await runAction(async () => {
    const ctx = await requireAdminAction();
    const v = quickSetEntriesSchema.parse({ month, rows });
    if (v.rows.some((r) => !(r.qty > 0))) {
      throw new ActionError("数量は 0 より大きい値を入力してください。", { qty: ["数量は 0 より大きい値を入力してください"] });
    }

    // ドライバー・案件内容が自社のものか（それぞれ 1 往復でまとめて確認する）
    const driverIds = [...new Set(v.rows.map((r) => r.driver_id))];
    const itemIds = [...new Set(v.rows.map((r) => r.project_item_id))];
    const [driversRes, itemsRes] = await Promise.all([
      ctx.supabase.from("drivers").select("id").eq("company_id", ctx.company.id).in("id", driverIds),
      ctx.supabase.from("project_items").select("id").eq("company_id", ctx.company.id).in("id", itemIds),
    ]);
    ensureNoError(driversRes);
    ensureNoError(itemsRes);
    const knownDrivers = new Set((driversRes.data ?? []).map((d) => d.id));
    const knownItems = new Set((itemsRes.data ?? []).map((i) => i.id));
    if (driverIds.some((id) => !knownDrivers.has(id))) throw new ActionError("ドライバーが見つかりません。", { driver_id: ["ドライバーを選択してください"] });
    if (itemIds.some((id) => !knownItems.has(id))) throw new ActionError("案件内容が見つかりません。", { project_item_id: ["案件を選択してください"] });

    const total: BulkSetEntriesResult = { inserted: 0, updated: 0, deleted: 0 };
    for (const itemId of itemIds) {
      const group = v.rows.filter((r) => r.project_item_id === itemId).map((r) => ({ driver_id: r.driver_id, qty: r.qty }));
      const { data, error } = await ctx.supabase.rpc("bulk_set_entries", {
        p_month: monthToDate(v.month),
        p_project_item_id: itemId,
        p_rows: group,
      });
      if (error) throw error;
      const obj = (data ?? {}) as Record<string, unknown>;
      total.inserted += Number(obj.inserted ?? 0);
      total.updated += Number(obj.updated ?? 0);
      total.deleted += Number(obj.deleted ?? 0);
    }
    revalidateEntries();
    return total;
  });
  if (!res.ok) return res;
  const { inserted, updated } = res.data;
  return { ok: true, data: res.data, message: `保存しました（追加 ${inserted} 件／更新 ${updated} 件）` };
}
