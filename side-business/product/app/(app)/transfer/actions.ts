"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import { createTransferBatch, deleteTransferBatch, setTransferExecutedOn } from "~/server/features/transfer";

/** 振込データの画面の Server Action（薄い包み。中身は server/features/transfer.ts） */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "月の指定が正しくありません");
const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください");
const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "振込データが見つかりません");

function refresh() {
  revalidatePath("/transfer");
  revalidatePath("/close");
  revalidatePath("/");
}

export type CreateTransferState = ActionResult<{ batchId: string; fileName: string; count: number; total: number; excluded: number }> | undefined;

const createSchema = z.object({
  month: monthSchema,
  transferDate: dateSchema,
  scope: z.enum(["all", "remaining"]),
  replaceConfirmed: z.literal("on").optional(),
});

export async function createTransferAction(_prev: CreateTransferState, form: FormData): Promise<CreateTransferState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = createSchema.parse({
      month: form.get("month"),
      transferDate: form.get("transferDate"),
      scope: form.get("scope") ?? "all",
      replaceConfirmed: form.get("replaceConfirmed") ?? undefined,
    });
    const db = await getDb();
    const batch = await createTransferBatch(
      db,
      user.tenantId,
      input.month,
      { transferDate: input.transferDate, scope: input.scope, replaceConfirmed: input.replaceConfirmed === "on" },
      user.id,
    );
    refresh();
    return { batchId: batch.id, fileName: batch.fileName, count: batch.count, total: batch.total, excluded: batch.excluded.length };
  }, "振込データを作りました。下の「ダウンロード」から銀行に出すファイルを保存してください。");
}

export type SimpleState = ActionResult | undefined;

const executedSchema = z.object({
  batchId: idSchema,
  executedOn: z.union([z.literal(""), dateSchema]),
});

export async function setExecutedOnAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  return runAction(
    async () => {
      const user = await requireUser("staff");
      const input = executedSchema.parse({ batchId: form.get("batchId"), executedOn: form.get("executedOn") ?? "" });
      const db = await getDb();
      await setTransferExecutedOn(db, user.tenantId, input.batchId, input.executedOn || null, user.id);
      refresh();
      return undefined;
    },
    "振り込んだ日を記録しました",
  );
}

export async function deleteTransferAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const batchId = idSchema.parse(form.get("batchId"));
    const db = await getDb();
    await deleteTransferBatch(db, user.tenantId, batchId, user.id);
    refresh();
    return undefined;
  }, "振込データを取り消しました（操作の記録には残ります）");
}
