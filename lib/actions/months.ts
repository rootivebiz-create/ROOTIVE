"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction, requireOwnerAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, translateError, type ActionResult } from "@/lib/actions/result";
import { monthSchema } from "@/lib/schemas/common";
import { formatMonthJa, monthToDate } from "@/lib/month";
import { hasServiceRoleKey } from "@/lib/supabase/admin";
import { uploadBackup, uploadBackupWith } from "@/lib/backup/storage";
import { autoBackupToDriveAction, notifyStatementsAction } from "@/lib/actions/integrations";

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
  /** LINE で支払明細の連絡を送った件数（連携していなければ 0） */
  lineSent: number;
  /** Google ドライブにバックアップを保存したか */
  driveSaved: boolean;
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

    // 承認待ちの稼働報告が残っていると、締めたあとに月次へ入れられなくなるので先に止める
    const pending = await supabase
      .from("work_day_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("month", monthDate)
      .eq("status", "submitted");
    if (!pending.error && (pending.count ?? 0) > 0) {
      throw new ActionError(
        `承認待ちの稼働報告が ${pending.count} 件あります。日報・点呼の画面で承認するか差し戻してから締めてください。`,
      );
    }

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

    // 外部連携（設定していなければ何もしない。失敗しても締めは成立させる）
    const [lineRes, driveRes] = await Promise.all([notifyStatementsAction(parsed.month), autoBackupToDriveAction(parsed.month)]);
    const lineSent = lineRes.ok ? lineRes.data.sent : 0;
    const driveSaved = driveRes.ok ? driveRes.data.saved : false;

    revalidateMonthPaths();
    return { backupPath, warning, lineSent, driveSaved };
  }, `${formatMonthJa(month)} を締めました。`);

  if (res.ok) {
    const extra = [
      res.data.lineSent > 0 ? `LINE で ${res.data.lineSent} 人に連絡しました。` : "",
      res.data.driveSaved ? "Google ドライブにも保存しました。" : "",
      res.data.warning ?? "",
    ]
      .filter(Boolean)
      .join("");
    if (extra) return { ...res, message: `${formatMonthJa(month)} を締めました。${extra}` };
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
