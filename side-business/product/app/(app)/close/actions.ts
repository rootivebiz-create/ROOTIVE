"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import { closeMonth, MINUTES_MAX, normalizeMinutes, OVERRIDE_REASON_MIN, reopenMonth, REOPEN_REASON_MIN } from "~/server/features/close";

/** 締めの画面の Server Action（薄い包み。中身は server/features/close.ts） */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "月の指定が正しくありません");

function refresh() {
  // 締めると、ほぼすべての画面の表示（編集できるか）が変わる
  revalidatePath("/", "layout");
}

export type CloseState = ActionResult<{ drivers: number; total: number }> | undefined;

const closeSchema = z.object({
  month: monthSchema,
  // 全角の数字・「1,200」・「90分」でも受け取る。空なら入れない（読み方は normalizeMinutes と同じ）
  minutesSpent: z
    .string()
    .refine(
      (v) => {
        try {
          normalizeMinutes(v);
          return true;
        } catch {
          return false;
        }
      },
      `締めにかかった時間は 1〜${MINUTES_MAX} の分の数で入れてください（空でもかまいません）`,
    )
    .transform((v) => normalizeMinutes(v)),
  overrideReason: z.string().trim().max(500, "理由は 500 文字までにしてください"),
});

export async function closeMonthAction(_prev: CloseState, form: FormData): Promise<CloseState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = closeSchema.parse({
      month: form.get("month"),
      minutesSpent: String(form.get("minutesSpent") ?? ""),
      overrideReason: String(form.get("overrideReason") ?? ""),
    });
    if (input.overrideReason && user.role !== "owner") throw new UserError("赤い指摘が残ったまま締められるのはオーナーだけです");
    if (input.overrideReason && input.overrideReason.length < OVERRIDE_REASON_MIN) {
      throw new UserError(`理由を ${OVERRIDE_REASON_MIN} 文字以上で書いてください（操作の記録に残ります）`);
    }
    const db = await getDb();
    const result = await closeMonth(db, user.tenantId, input.month, user.id, {
      role: user.role,
      overrideReason: input.overrideReason || null,
      minutesSpent: input.minutesSpent,
    });
    refresh();
    return { drivers: result.drivers, total: result.total };
  }, "締めました。この月の稼働・調整・明細は変えられません。");
}

export type ReopenState = ActionResult | undefined;

const reopenSchema = z.object({
  month: monthSchema,
  reason: z
    .string()
    .trim()
    .min(REOPEN_REASON_MIN, `理由を ${REOPEN_REASON_MIN} 文字以上で書いてください`)
    .max(500, "理由は 500 文字までにしてください"),
});

export async function reopenMonthAction(_prev: ReopenState, form: FormData): Promise<ReopenState> {
  return runAction(
    async () => {
      const user = await requireUser("owner");
      const input = reopenSchema.parse({ month: form.get("month"), reason: form.get("reason") ?? "" });
      const db = await getDb();
      await reopenMonth(db, user.tenantId, input.month, { id: user.id, role: user.role }, input.reason);
      refresh();
      return undefined;
    },
    "締めを外しました。直したら、明細を作り直してもう一度締めてください。",
  );
}
