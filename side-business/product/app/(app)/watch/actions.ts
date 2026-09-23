"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import { ACK_MANY_MAX, ACK_NOTE_MAX, ACK_NOTE_MIN, ackWatchIssue, ackWatchIssues, unackWatchIssue } from "~/server/features/watch/acks";

/**
 * 見張り番の Server Action（薄い包み。中身は server/features/watch/acks.ts）。
 * 役割の確認 → 入力の確かめ → 確認済みにする／外す（操作の記録もそこで残す）→ 読み直し。
 */

const keySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "月の指定が正しくありません"),
  code: z.string().regex(/^[a-z_]{2,60}$/, "指摘の種類が正しくありません"),
  subjectId: z.string().trim().min(1, "指摘の対象が正しくありません").max(200, "指摘の対象が正しくありません"),
});

const ackSchema = keySchema.extend({
  note: z
    .string()
    .trim()
    .min(ACK_NOTE_MIN.other, `何を確かめたかを ${ACK_NOTE_MIN.other} 文字以上で書いてください`)
    .max(ACK_NOTE_MAX, `メモは ${ACK_NOTE_MAX} 文字までにしてください`),
});

/** まとめて確認済みにする：同じ種類の指摘を 2 件以上 */
const ackManySchema = keySchema.omit({ subjectId: true }).extend({
  subjectIds: z
    .array(z.string().trim().min(1, "指摘の対象が正しくありません").max(200, "指摘の対象が正しくありません"))
    .min(2, "まとめて確認済みにするのは 2 件からです")
    .max(ACK_MANY_MAX, `まとめて確認済みにできるのは、1 回で ${ACK_MANY_MAX} 件までです`),
  note: ackSchema.shape.note,
});

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

function refresh() {
  // 見張り番の結果は、締め・ホーム・利益の画面にも出る
  revalidatePath("/", "layout");
}

export type WatchFormState = ActionResult | undefined;

export async function ackWatchAction(_prev: WatchFormState, form: FormData): Promise<WatchFormState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = ackSchema.parse({ month: text(form, "month"), code: text(form, "code"), subjectId: text(form, "subjectId"), note: text(form, "note") });
    const db = await getDb();
    await ackWatchIssue(db, user.tenantId, input, user.id);
    refresh();
    return undefined;
  }, "確認済みにしました。何を確かめたかは記録に残ります。");
}

export async function ackManyWatchAction(_prev: WatchFormState, form: FormData): Promise<WatchFormState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const subjectIds = form.getAll("subjectId").filter((v): v is string => typeof v === "string");
    const input = ackManySchema.parse({ month: text(form, "month"), code: text(form, "code"), subjectIds, note: text(form, "note") });
    const db = await getDb();
    await ackWatchIssues(db, user.tenantId, input, user.id);
    refresh();
    return undefined;
  }, "まとめて確認済みにしました。1 件ずつの記録に同じメモが残ります。");
}

export async function unackWatchAction(_prev: WatchFormState, form: FormData): Promise<WatchFormState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = keySchema.parse({ month: text(form, "month"), code: text(form, "code"), subjectId: text(form, "subjectId") });
    const db = await getDb();
    await unackWatchIssue(db, user.tenantId, input, user.id);
    refresh();
    return undefined;
  }, "確認済みを外しました。");
}
