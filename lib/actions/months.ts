"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction, requireOwnerAction } from "@/lib/auth/session";
import { ensureNoError, runAction, translateError, type ActionResult } from "@/lib/actions/result";
import { monthSchema } from "@/lib/schemas/common";
import { formatMonthJa, monthToDate } from "@/lib/month";
import { hasServiceRoleKey } from "@/lib/supabase/admin";
import { uploadBackup, uploadBackupWith } from "@/lib/backup/storage";

const closeMonthInputSchema = z.object({
  month: monthSchema,
  note: z.string().trim().max(500, "メモは 500 文字以内で入力してください").default(""),
});

/** 月締めの状態が影響する画面をまとめて再検証する */
function revalidateMonthPaths() {
  revalidatePath("/settings/months");
  revalidatePath("/dashboard");
  revalidatePath("/entries");
  revalidatePath("/payouts");
  revalidatePath("/", "layout");
}

export interface CloseMonthResult {
  /** Storage に保存したバックアップのパス（保存できなかった場合は null） */
  backupPath: string | null;
  /** 締めは成立したがバックアップ保存に失敗したときの警告 */
  warning: string | null;
}

/**
 * 月締め（admin+）：スナップショットを保存し（RPC）、バックアップ JSON を Storage へ自動保存する。
 * バックアップの保存に失敗しても締めは成立させ、警告をメッセージに含める。
 */
export async function closeMonthAction(month: string, note = ""): Promise<ActionResult<CloseMonthResult>> {
  const res = await runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const parsed = closeMonthInputSchema.parse({ month, note });
    const monthDate = monthToDate(parsed.month);

    ensureNoError(await supabase.rpc("close_month", { p_month: monthDate, p_note: parsed.note }));

    let backupPath: string | null = null;
    let warning: string | null = null;
    try {
      const backupRes = await supabase.rpc("export_backup");
      if (backupRes.error) throw backupRes.error;
      // サービスロールで保存。キーが無い環境では本人の権限（Storage RLS：自社フォルダ・admin 以上）で保存を試みる
      const { path } = hasServiceRoleKey()
        ? await uploadBackup(company.id, parsed.month, backupRes.data)
        : await uploadBackupWith(supabase, company.id, parsed.month, backupRes.data);
      const setRes = await supabase.rpc("set_month_backup_path", { p_month: monthDate, p_path: path });
      if (setRes.error) throw setRes.error;
      backupPath = path;
    } catch (e) {
      warning = `締めは完了しましたが、バックアップの保存に失敗しました（${translateError(e)}）。設定 › データ からバックアップ JSON を手動で保存してください。`;
    }

    revalidateMonthPaths();
    return { backupPath, warning };
  }, `${formatMonthJa(month)} を締めました。`);

  if (res.ok && res.data.warning) {
    return { ...res, message: `${formatMonthJa(month)} を締めました。${res.data.warning}` };
  }
  return res;
}

/** 締めの解除（owner のみ） */
export async function reopenMonthAction(month: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase } = await requireOwnerAction();
    const m = monthSchema.parse(month);
    ensureNoError(await supabase.rpc("reopen_month", { p_month: monthToDate(m) }));
    revalidateMonthPaths();
    return null;
  }, `${formatMonthJa(month)} の締めを解除しました。`);
}
