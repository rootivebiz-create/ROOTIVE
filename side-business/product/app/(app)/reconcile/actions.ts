"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import {
  deleteNotice,
  findSampleClient,
  importNotice,
  markItemsAsked,
  MAX_NOTICE_FILE_BYTES,
  readSampleNotice,
  runReconcile,
  SAMPLE_NOTICE_FILE,
  SAMPLE_NOTICE_MONTH,
  setDriverMapping,
  setItemStatus,
  setLineMapping,
  updateNoticeColumns,
  updateNoticeMeta,
  type LineTarget,
} from "~/server/features/reconcile";
import { COLUMN_ROLES, type ColumnMap } from "~/server/features/reconcile/roles";
import { ITEM_STATUSES } from "~/server/features/reconcile/labels";

/**
 * 元請との突合の書き込み。どれも最初に役割を確かめ（staff 以上）、入力を確かめてから server/features/reconcile を呼ぶ。
 */

const idSchema = z.uuid("画面を読み込み直してください");
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "月を選んでください");

function revalidateAll(): void {
  revalidatePath("/reconcile", "layout");
  // ホームと利益の画面も「見つけたお金」（確定・見込み）を出すので、あわせて読み直させる
  revalidatePath("/");
  revalidatePath("/profit");
}

// ---------------------------------------------------------------- 取り込み

const uploadSchema = z.object({
  clientId: z.uuid("元請を選んでください"),
  month: monthSchema,
  replace: z.boolean(),
});

export async function uploadNoticeAction(_prev: ActionResult<{ noticeId: string }> | undefined, form: FormData): Promise<ActionResult<{ noticeId: string }>> {
  const result = await runAction(async () => {
    const user = await requireUser("staff");
    const input = uploadSchema.parse({ clientId: form.get("clientId"), month: form.get("month"), replace: form.get("replace") === "1" });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("元請から届いたファイル（CSV か Excel）を選んでください");
    if (file.size > MAX_NOTICE_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）。不要なシートを消すか、CSV にしてから上げてください");
    const db = await getDb();
    const res = await importNotice(db, user.tenantId, user.id, {
      clientId: input.clientId,
      month: `${input.month}-01`,
      fileName: file.name || "お支払通知.csv",
      bytes: new Uint8Array(await file.arrayBuffer()),
      replace: input.replace,
    });
    revalidateAll();
    return { noticeId: res.noticeId };
  }, "取り込みました");
  if (result.ok && result.data) redirect(`/reconcile/${result.data.noticeId}?done=import`);
  return result;
}

/** 見本（架空の A物流・2026年10月分）を入れて試す */
export async function loadSampleAction(_prev: ActionResult<{ noticeId: string }> | undefined, _form: FormData): Promise<ActionResult<{ noticeId: string }>> {
  const result = await runAction(async () => {
    const user = await requireUser("staff");
    const db = await getDb();
    const client = await findSampleClient(db, user.tenantId);
    if (!client) throw new UserError("見本は、デモ（架空の会社・架空の A物流）でだけ試せます。お手元のお支払通知を上げてください");
    const res = await importNotice(db, user.tenantId, user.id, {
      clientId: client.id,
      month: SAMPLE_NOTICE_MONTH,
      fileName: SAMPLE_NOTICE_FILE,
      bytes: await readSampleNotice(),
      replace: true,
    });
    revalidateAll();
    return { noticeId: res.noticeId };
  }, "見本を取り込みました");
  if (result.ok && result.data) redirect(`/reconcile/${result.data.noticeId}?done=sample`);
  return result;
}

// ---------------------------------------------------------------- 突き合わせ・行の当て方・列

export async function rerunAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const noticeId = idSchema.parse(form.get("noticeId"));
    const db = await getDb();
    await runReconcile(db, user.tenantId, noticeId, user.id);
    revalidateAll();
  }, "今の記録で突き合わせ直しました");
}

const lineTargetSchema = z.union([z.literal("extra"), z.literal("ignore"), z.literal("auto"), z.string().regex(/^project:[0-9a-f-]{36}$/, "案件を選んでください")]);

export async function setLineMappingAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = z
      .object({ noticeId: idSchema, key: z.string().min(1).max(500), target: lineTargetSchema })
      .parse({ noticeId: form.get("noticeId"), key: form.get("key"), target: form.get("target") });
    const db = await getDb();
    await setLineMapping(db, user.tenantId, user.id, { noticeId: input.noticeId, key: input.key, target: input.target as LineTarget | "auto" });
    revalidateAll();
  }, "決めました。来月から同じ名前は自動で当てます");
}

export async function setDriverMappingAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = z
      .object({ noticeId: idSchema, key: z.string().min(1).max(500), driverId: z.union([idSchema, z.literal("none"), z.literal("auto")]) })
      .parse({ noticeId: form.get("noticeId"), key: form.get("key"), driverId: form.get("driverId") });
    const db = await getDb();
    await setDriverMapping(db, user.tenantId, user.id, input);
    revalidateAll();
  }, "決めました。来月から同じ名前は自動で当てます");
}

const colSchema = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(199).nullable());

export async function updateColumnsAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const shape = Object.fromEntries(COLUMN_ROLES.map((r) => [r, colSchema])) as Record<keyof ColumnMap, typeof colSchema>;
    const input = z
      .object({ noticeId: idSchema, headerRow: z.coerce.number().int().min(1, "見出しの行を選んでください").max(5000), ...shape })
      .parse({ noticeId: form.get("noticeId"), headerRow: form.get("headerRow"), ...Object.fromEntries(COLUMN_ROLES.map((r) => [r, form.get(r)])) });
    const columns = Object.fromEntries(COLUMN_ROLES.map((r) => [r, input[r] as number | null])) as ColumnMap;
    const db = await getDb();
    await updateNoticeColumns(db, user.tenantId, user.id, { noticeId: input.noticeId, headerRow: input.headerRow, columns });
    revalidateAll();
  }, "列の対応を覚えて、読み直しました");
}

// ---------------------------------------------------------------- 入金の記録・状態

export async function updateNoticeMetaAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const fee = String(form.get("feeDeducted") ?? "")
      .normalize("NFKC")
      .replace(/[,\s円¥]/g, "");
    const input = z
      .object({
        noticeId: idSchema,
        paidOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "入金日は日付で入れてください")]),
        feeDeducted: z.union([z.literal(""), z.string().regex(/^\d{1,9}$/, "手数料は円の数だけで入れてください（例：660）")]),
      })
      .parse({ noticeId: form.get("noticeId"), paidOn: String(form.get("paidOn") ?? ""), feeDeducted: fee });
    const db = await getDb();
    await updateNoticeMeta(db, user.tenantId, user.id, { noticeId: input.noticeId, paidOn: input.paidOn || null, feeDeducted: input.feeDeducted ? Number(input.feeDeducted) : 0 });
    revalidateAll();
  }, "入金の記録を保存しました");
}

export async function setItemStatusAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const recovered = String(form.get("recoveredAmount") ?? "")
      .normalize("NFKC")
      .replace(/[,\s円¥]/g, "");
    const input = z
      .object({
        itemId: idSchema,
        status: z.enum(ITEM_STATUSES, "状態を選んでください"),
        note: z.string().trim().max(500, "メモは 500 文字までにしてください"),
        recoveredAmount: z.union([z.literal(""), z.string().regex(/^\d{1,10}$/, "取り戻せた額は円の数だけで入れてください（例：81700）")]),
      })
      .parse({ itemId: form.get("itemId"), status: form.get("status"), note: String(form.get("note") ?? ""), recoveredAmount: recovered });
    const db = await getDb();
    await setItemStatus(db, user.tenantId, user.id, {
      itemId: input.itemId,
      status: input.status,
      note: input.note || null,
      recoveredAmount: input.recoveredAmount ? Number(input.recoveredAmount) : null,
    });
    revalidateAll();
  }, "保存しました");
}

export async function markAskedAction(_prev: ActionResult<{ count: number }> | undefined, form: FormData): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const noticeId = idSchema.parse(form.get("noticeId"));
    const itemIds = z.array(idSchema).max(500).parse(form.getAll("itemIds"));
    if (itemIds.length === 0) throw new UserError("「問い合わせ済み」にする差を選んでください");
    const db = await getDb();
    const count = await markItemsAsked(db, user.tenantId, user.id, { noticeId, itemIds });
    revalidateAll();
    return { count };
  }, "「問い合わせ済み」にしました");
}

export async function deleteNoticeAction(_prev: ActionResult<{ month: string }> | undefined, form: FormData): Promise<ActionResult<{ month: string }>> {
  const result = await runAction(async () => {
    const user = await requireUser("staff");
    const noticeId = idSchema.parse(form.get("noticeId"));
    if (form.get("confirm") !== "1") throw new UserError("削除するときは「削除してよい」にチェックを入れてください");
    const db = await getDb();
    const res = await deleteNotice(db, user.tenantId, user.id, noticeId);
    revalidateAll();
    return res;
  }, "削除しました");
  if (result.ok && result.data) redirect(`/reconcile?m=${result.data.month.slice(0, 7)}&done=deleted`);
  return result;
}
