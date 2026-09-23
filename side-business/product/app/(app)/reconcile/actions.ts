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
  removeNoticeFile,
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
import { MAX_PASTE_CHARS, pastedTableToTsv, pasteFileName } from "~/server/features/reconcile/paste";
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

/**
 * 同じ元請・同じ月のお支払通知がすでにあるとき：
 * new（止める）・replace（全部を入れ替える）・add（足す。営業所ごとなど）・replaceFile（そのファイルだけ入れ替える。fileId が要る）
 */
const UPLOAD_MODES = ["new", "replace", "add", "replaceFile"] as const;

const uploadSchema = z
  .object({
    clientId: z.uuid("元請を選んでください"),
    month: monthSchema,
    mode: z.enum(UPLOAD_MODES, "すでにあるときの扱いを選んでください"),
    fileId: z.union([z.literal(""), idSchema]),
  })
  .refine((v) => v.mode !== "replaceFile" || v.fileId !== "", { message: "入れ替えるファイルが分かりません。画面を読み込み直してください", path: ["fileId"] });

/** ファイルか、貼り付けた表（TSV にする）。どちらも無ければ断る */
async function uploadedBytes(form: FormData): Promise<{ fileName: string; bytes: Uint8Array }> {
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_NOTICE_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）。不要なシートを消すか、CSV にしてから上げてください");
    return { fileName: file.name || "お支払通知.csv", bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  const pasted = String(form.get("pasted") ?? "");
  if (pasted.trim()) {
    if (pasted.length > MAX_PASTE_CHARS) throw new UserError("貼り付けた表が長すぎます。ファイル（CSV か Excel）にしてから上げてください");
    const table = pastedTableToTsv(pasted);
    if (table.rows < 2 || table.columns < 2) {
      throw new UserError("貼り付けた文字から、表を読み取れませんでした。見出しの行（品目・数量・単価・金額など）から下を、まとめてコピーして貼り付けてください");
    }
    return { fileName: pasteFileName(String(form.get("pasteName") ?? "")), bytes: new TextEncoder().encode(table.tsv) };
  }
  throw new UserError("元請から届いたファイル（CSV か Excel）を選ぶか、表を貼り付けてください");
}

function uploadModeOf(form: FormData): string {
  const mode = form.get("mode");
  if (typeof mode === "string" && mode) return mode;
  // 前の画面（「すでにあれば入れ替える」のチェック）から送られたとき
  return form.get("replace") === "1" ? "replace" : "new";
}

export async function uploadNoticeAction(_prev: ActionResult<{ noticeId: string; done: string }> | undefined, form: FormData): Promise<ActionResult<{ noticeId: string; done: string }>> {
  const result = await runAction(async () => {
    const user = await requireUser("staff");
    const input = uploadSchema.parse({ clientId: form.get("clientId"), month: form.get("month"), mode: uploadModeOf(form), fileId: String(form.get("fileId") ?? "") });
    const { fileName, bytes } = await uploadedBytes(form);
    const db = await getDb();
    const res = await importNotice(db, user.tenantId, user.id, {
      clientId: input.clientId,
      month: `${input.month}-01`,
      fileName,
      bytes,
      replace: input.mode === "replace",
      add: input.mode === "add",
      replaceFileId: input.mode === "replaceFile" ? input.fileId : null,
      allowSameContent: form.get("allowSameContent") === "1",
    });
    revalidateAll();
    // 結果の画面の知らせ：足した・1 つのファイルだけ入れ替えた・取り込んだ（新しく・全部を入れ替えて）
    return { noticeId: res.noticeId, done: res.added ? "add" : res.replacedFile ? "replaceFile" : "import" };
  }, "取り込みました");
  if (result.ok && result.data) redirect(`/reconcile/${result.data.noticeId}?done=${result.data.done}`);
  return result;
}

/** 何通かを足したお支払通知から、ファイルを 1 つ外す（まちがえて足したとき） */
export async function removeNoticeFileAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = z.object({ noticeId: idSchema, fileId: idSchema }).parse({ noticeId: form.get("noticeId"), fileId: form.get("fileId") });
    if (form.get("confirm") !== "1") throw new UserError("外すときは「外してよい」にチェックを入れてください");
    const db = await getDb();
    await removeNoticeFile(db, user.tenantId, user.id, input);
    revalidateAll();
  }, "ファイルを外して、残りのファイルで突き合わせ直しました");
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
      .object({ noticeId: idSchema, fileId: z.union([z.literal(""), idSchema]), headerRow: z.coerce.number().int().min(1, "見出しの行を選んでください").max(5000), ...shape })
      .parse({
        noticeId: form.get("noticeId"),
        fileId: String(form.get("fileId") ?? ""),
        headerRow: form.get("headerRow"),
        ...Object.fromEntries(COLUMN_ROLES.map((r) => [r, form.get(r)])),
      });
    const columns = Object.fromEntries(COLUMN_ROLES.map((r) => [r, input[r] as number | null])) as ColumnMap;
    const db = await getDb();
    await updateNoticeColumns(db, user.tenantId, user.id, { noticeId: input.noticeId, headerRow: input.headerRow, columns, fileId: input.fileId || null });
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
