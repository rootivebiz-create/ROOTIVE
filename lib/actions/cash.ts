"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { deleteCashSnapshotSchema, saveCashSnapshotSchema, type SaveCashSnapshotInput } from "@/lib/schemas/cash";

/** 残高の変更が影響する画面 */
function revalidateCash(): void {
  revalidatePath("/cashflow");
  revalidatePath("/dashboard");
}

/**
 * 現金残高の登録（admin+）。同じ日付が既にあれば上書きする（unique(company_id, as_of)）。
 * 資金繰りの起点になるだけで、締め済み月の制限は受けない。
 */
export async function saveCashSnapshotAction(input: SaveCashSnapshotInput): Promise<ActionResult<{ as_of: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = saveCashSnapshotSchema.parse(input);
    ensureNoError(
      await supabase.from("cash_snapshots").upsert(
        {
          company_id: company.id,
          as_of: v.as_of,
          balance: v.balance,
          memo: v.memo,
          created_by: user.id,
        },
        { onConflict: "company_id,as_of" },
      ),
    );
    revalidateCash();
    return { as_of: v.as_of };
  }, "現在の残高を登録しました");
}

/** 現金残高の削除（admin+） */
export async function deleteCashSnapshotAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = deleteCashSnapshotSchema.parse({ id });
    const row = unwrap<{ id: string }>(
      await supabase.from("cash_snapshots").delete().eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の残高が見つかりません（既に削除された可能性があります）。",
    );
    revalidateCash();
    return { id: row.id };
  }, "残高を削除しました");
}
