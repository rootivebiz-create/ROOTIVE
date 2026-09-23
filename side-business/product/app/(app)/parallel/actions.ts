"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/lib/payroll/money";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import {
  clearParallelChecks,
  goLive,
  MAX_EXCEL_TOTAL,
  MAX_PARALLEL_FILE_BYTES,
  readParallelFile,
  readParallelPaste,
  saveParallelChecks,
  undoGoLive,
  type AmountTable,
} from "~/server/features/parallel";

/**
 * Excel との比べ合わせの Server Action（薄い包み。中身は server/features/parallel.ts）。
 * 役割の確認 → 入力の確かめ → 保存（会社で絞る・記録を残す）→ 画面の読み直し。
 */

const monthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, "月の指定が正しくありません")
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

/** 「357,555」「３５７，５５５円」「-1,200」→ 円の整数。空なら null（消す） */
const excelAmountSchema = z
  .string()
  .max(30, "金額が長すぎます")
  .transform((v, ctx) => {
    const t = v.normalize("NFKC").trim();
    if (!t) return null;
    const n = parseAmount(t);
    if (n === null || !Number.isInteger(n)) {
      ctx.addIssue({ code: "custom", message: `「${v}」は 1 円単位の数で入れてください` });
      return z.NEVER;
    }
    if (Math.abs(n) > MAX_EXCEL_TOTAL) {
      ctx.addIssue({ code: "custom", message: `「${v}」は大きすぎます。桁を確かめてください` });
      return z.NEVER;
    }
    return n;
  });

const entriesSchema = z
  .array(
    z.object({
      driverId: z.string().trim().min(1),
      excelTotal: excelAmountSchema,
      note: z.string().max(200, "メモは 200 文字までにしてください").optional(),
    }),
  )
  .min(1, "入れた額がありません")
  .max(1000, "一度に保存できるのは 1,000人までです");

function refresh() {
  // 締めの画面の「Excel との比べ合わせ」、最初の設定の進み具合にも出る
  revalidatePath("/parallel");
  revalidatePath("/close");
  revalidatePath("/");
  revalidatePath("/onboarding");
}

export type SaveParallelState = ActionResult<{ saved: number; removed: number }> | undefined;

export async function saveParallelAction(_prev: SaveParallelState, form: FormData): Promise<SaveParallelState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const month = monthSchema.parse(text(form, "month"));
    let raw: unknown;
    try {
      raw = JSON.parse(text(form, "entries"));
    } catch {
      throw new UserError("入れた額を読めませんでした。画面を読み直してください");
    }
    const entries = entriesSchema.parse(raw);
    const db = await getDb();
    const result = await saveParallelChecks(
      db,
      user.tenantId,
      month,
      entries.map((e) => ({ driverId: e.driverId, excelTotal: e.excelTotal, note: e.note ?? null })),
      user.id,
    );
    refresh();
    return result;
  }, "保存しました。");
}

export type ReadParallelState = ActionResult<AmountTable & { sheetName?: string; source: string }> | undefined;

const colSchema = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{1,3}$/.test(v) ? Number(v) : null));

/** 貼り付け・ファイルの「名前・金額」を読む（まだ保存しない。画面の入力欄に入れる） */
export async function readParallelAction(_prev: ReadParallelState, form: FormData): Promise<ReadParallelState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const opts = { nameCol: colSchema.parse(text(form, "nameCol") || undefined), amountCol: colSchema.parse(text(form, "amountCol") || undefined) };
    const db = await getDb();
    const file = form.get("file");
    if (file instanceof File && file.name && file.size > 0) {
      if (file.size > MAX_PARALLEL_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）");
      const t = await readParallelFile(db, user.tenantId, file.name, new Uint8Array(await file.arrayBuffer()), opts);
      return { ...t, source: file.name };
    }
    const t = await readParallelPaste(db, user.tenantId, text(form, "paste"), opts);
    return { ...t, source: "貼り付け" };
  });
}

export type ClearParallelState = ActionResult<number> | undefined;

export async function clearParallelAction(_prev: ClearParallelState, form: FormData): Promise<ClearParallelState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const month = monthSchema.parse(text(form, "month"));
    const db = await getDb();
    const n = await clearParallelChecks(db, user.tenantId, month, user.id);
    refresh();
    return n;
  }, "この月の Excel の額を消しました。");
}

export type GoLiveState = ActionResult | undefined;

/** 「Excel をやめて、しめ日ラボで締める」を記録する（オーナーが決める） */
export async function goLiveAction(_prev: GoLiveState, form: FormData): Promise<GoLiveState> {
  return runAction(async () => {
    const user = await requireUser("owner");
    const month = monthSchema.parse(text(form, "month"));
    const db = await getDb();
    await goLive(db, user.tenantId, month, user.id);
    refresh();
    return undefined;
  }, "切り替えを記録しました。これからは、しめ日ラボで締めてください。");
}

/** 切り替えの記録を取り消す（Excel との並行に戻す） */
export async function undoGoLiveAction(_prev: GoLiveState, _form: FormData): Promise<GoLiveState> {
  return runAction(async () => {
    const user = await requireUser("owner");
    const db = await getDb();
    await undoGoLive(db, user.tenantId, user.id);
    refresh();
    return undefined;
  }, "切り替えの記録を取り消しました。");
}
