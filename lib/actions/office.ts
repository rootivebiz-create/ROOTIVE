"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdminAction, requireStaffAction } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/actions/result";
import { todayJST } from "@/lib/daily/helpers";
import { monthToDate } from "@/lib/month";
import { closeCheckSchema, remindReportsSchema, startPageSchema, type CloseCheckInput, type RemindReportsInput, type StartPage } from "@/lib/schemas/office";

/**
 * 事務（/office）の Server Actions。
 * 承認・休み希望・消込・経費の計上・月締め・配車の確定は既存の Action をそのまま呼ぶ（ここでは足さない）。
 * ここにあるのは事務で新しくできたことだけ：今日の報告の催促・月締めの手作業のチェック・最初に開く画面。
 */

export interface RemindReportsResult {
  /** 今回催促を記録した人数（この人たちにだけ送る） */
  sent: number;
  /** 今日すでに催促していたので送らなかった人数 */
  skipped: number;
}

/** 今日の報告がまだの人へ催促する（端末への通知 ＋ LINE。1 人 1 日 1 回まで） */
export async function remindReportsAction(input: RemindReportsInput): Promise<ActionResult<RemindReportsResult>> {
  const res = await runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = remindReportsSchema.parse(input);
    const workDate = todayJST();
    const { data, error } = await supabase.rpc("record_report_reminders", { p_work_date: workDate, p_driver_ids: v.driverIds });
    if (error) throw error;
    const recorded = (data ?? []) as string[];
    revalidatePath("/office");

    // 返事を返したあとに送る（送れなくても催促の記録は残る）
    if (recorded.length > 0) {
      after(async () => {
        const { notifyReportReminders } = await import("@/lib/push/notify-remind");
        await notifyReportReminders({ companyId: company.id, workDate, driverIds: recorded }).catch(() => undefined);
      });
    }
    return { sent: recorded.length, skipped: new Set(v.driverIds).size - recorded.length };
  });
  if (!res.ok) return res;
  const { sent, skipped } = res.data;
  const message =
    sent === 0 ? "今日はもう催促しています" : skipped > 0 ? `${sent} 人に催促しました（${skipped} 人は今日すでに催促済み）` : `${sent} 人に催促しました`;
  return { ...res, message };
}

/** 月締めの手作業の手順にチェックを付ける／外す（締めた月は DB が拒否する） */
export async function setCloseCheckAction(input: CloseCheckInput): Promise<ActionResult<{ key: string; done: boolean }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = closeCheckSchema.parse(input);
    const { error } = await supabase.rpc("set_close_check", { p_month: monthToDate(v.month), p_key: v.key, p_done: v.done });
    if (error) throw error;
    revalidatePath("/office");
    return { key: v.key, done: v.done };
  });
}

/** 最初に開く画面を変える（事務は管理者以上だけ。DB も同じ判定をする。知らせる文言は呼ぶ側が決める） */
export async function setStartPageAction(page: StartPage): Promise<ActionResult<{ startPage: StartPage }>> {
  return runAction(async () => {
    const { supabase, profile } = await requireStaffAction();
    const v = startPageSchema.parse(page);
    if (v === "office" && profile.role !== "owner" && profile.role !== "admin") {
      throw new ActionError("事務の画面は管理者以上が使えます");
    }
    const { error } = await supabase.rpc("set_start_page", { p_start_page: v });
    if (error) throw error;
    revalidatePath("/", "layout");
    return { startPage: v };
  });
}
