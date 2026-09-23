"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import { createTransferBatch, deleteTransferBatch, setTransferExecutedOn, settlePaidDifference, undoSettlement } from "~/server/features/transfer";

/** 振込データの画面の Server Action（薄い包み。中身は server/features/transfer.ts） */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "月の指定が正しくありません");
const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を選んでください");
const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "振込データが見つかりません");

function refresh() {
  revalidatePath("/transfer");
  revalidatePath("/close");
  revalidatePath("/");
}

export type CreateTransferState =
  | ActionResult<{ batchId: string; fileName: string; count: number; total: number; excluded: number; lateDays: number; bankChanged: number }>
  | undefined;

const createSchema = z.object({
  month: monthSchema,
  transferDate: dateSchema,
  scope: z.enum(["all", "remaining"]),
  replaceConfirmed: z.literal("on").optional(),
  bankChangesConfirmed: z.literal("on").optional(),
  // 確かめたときに画面に出ていた「口座が変わった人」の値（英数字だけ）
  bankReviewKey: z
    .string()
    .regex(/^[0-9a-f]{0,64}$/, "画面を読み直してください")
    .optional(),
});

export async function createTransferAction(_prev: CreateTransferState, form: FormData): Promise<CreateTransferState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = createSchema.parse({
      month: form.get("month"),
      transferDate: form.get("transferDate"),
      scope: form.get("scope") ?? "all",
      replaceConfirmed: form.get("replaceConfirmed") ?? undefined,
      bankChangesConfirmed: form.get("bankChangesConfirmed") ?? undefined,
      bankReviewKey: form.get("bankReviewKey") ?? undefined,
    });
    const db = await getDb();
    const batch = await createTransferBatch(
      db,
      user.tenantId,
      input.month,
      {
        transferDate: input.transferDate,
        scope: input.scope,
        replaceConfirmed: input.replaceConfirmed === "on",
        bankChangesConfirmed: input.bankChangesConfirmed === "on",
        bankReviewKey: input.bankChangesConfirmed === "on" ? input.bankReviewKey : undefined,
      },
      user.id,
    );
    refresh();
    return {
      batchId: batch.id,
      fileName: batch.fileName,
      count: batch.count,
      total: batch.total,
      excluded: batch.excluded.length,
      lateDays: batch.lateDays ?? 0,
      bankChanged: batch.bankChanged ?? 0,
    };
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

export type SettleState = ActionResult<{ amount: number; method: "next_month" | "outside"; nextMonth: string | null; driverName: string }> | undefined;

const settleSchema = z.object({
  month: monthSchema,
  driverId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "ドライバーが見つかりません。画面を読み直してください"),
  method: z.enum(["next_month", "outside"], { error: "精算の仕方を選んでください" }),
  expected: z.coerce.number().int("画面を読み直してください"),
  settledOn: z.union([z.literal(""), dateSchema]).optional(),
  note: z.string().trim().max(200, "メモは 200 文字までにしてください").optional(),
});

/** 振り込んだ額と明細の額の差を精算したことを記録する（翌月の調整を足す・別の方法で精算した日を残す） */
export async function settlePaidDifferenceAction(_prev: SettleState, form: FormData): Promise<SettleState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = settleSchema.parse({
      month: form.get("month"),
      driverId: form.get("driverId"),
      method: form.get("method"),
      expected: form.get("expected"),
      settledOn: form.get("settledOn") ?? "",
      note: form.get("note") ?? "",
    });
    const db = await getDb();
    const r = await settlePaidDifference(
      db,
      user.tenantId,
      input.month,
      { driverId: input.driverId, method: input.method, expectedOutstanding: input.expected, settledOn: input.settledOn || null, note: input.note || null },
      user.id,
    );
    refresh();
    revalidatePath("/work");
    revalidatePath("/statements");
    return { amount: r.amount, method: r.method, nextMonth: r.nextMonth, driverName: r.driverName };
  }, "精算の仕方を記録しました");
}

const undoSettleSchema = z.object({ month: monthSchema, settleId: z.coerce.number().int().positive("精算の記録が見つかりません") });

/** 「別の方法で精算した」記録を取り消す（記録は消さず、取り消したことを足す） */
export async function undoSettlementAction(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = undoSettleSchema.parse({ month: form.get("month"), settleId: form.get("settleId") });
    const db = await getDb();
    await undoSettlement(db, user.tenantId, input.month, input.settleId, user.id);
    refresh();
    return undefined;
  }, "精算の記録を取り消しました（操作の記録には残ります）");
}
