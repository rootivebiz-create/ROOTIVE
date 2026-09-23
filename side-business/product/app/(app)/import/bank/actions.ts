"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { applyBankImport, assignBankRow, createBankDraft, discardBankDraft } from "~/server/features/import/bank";
import { idSchema, monthInputSchema } from "~/server/features/import/schemas";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "~/server/features/import/types";
import { monthParam } from "~/server/month";

/**
 * 口座の取り込みの Server Action。どれも：役割の確認（事務以上）→ 入力の確かめ → server/features/import/bank → 記録 → 画面の読み直し。
 */

type State = ActionResult<unknown> | undefined;

const batchIdSchema = idSchema("口座の取り込みが見つかりません。画面を読み直してください");
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

function refresh(batchId?: string) {
  revalidatePath("/", "layout");
  if (batchId) revalidatePath(`/import/bank/${batchId}`);
}

/** 口座のファイルを置く → 確かめの画面へ */
export async function bankUploadAction(_prev: State, form: FormData): Promise<State> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const pageMonth = monthInputSchema.parse(text(form, "month"));
    const file = form.get("file");
    if (!(file instanceof File) || file.name === "") throw new UserError("ファイルを選んでください");
    if (file.size > MAX_FILE_BYTES) throw new UserError(`ファイルが大きすぎます（${MAX_FILE_LABEL} まで）`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const db = await getDb();
    const draft = await createBankDraft(db, user.tenantId, user, { fileName: file.name, bytes, pageMonth });
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.bank.upload",
      entity: "import_batch",
      entityId: draft.id,
      detail: { fileName: file.name, size: bytes.byteLength, rows: draft.rows },
    });
    refresh();
    return draft.id;
  });
  if (res.ok && res.data) redirect(`/import/bank/${res.data}`);
  return res;
}

/** 当たらなかった行を、台帳のドライバーに当てる（まだ台帳には書かない） */
export async function bankAssignAction(_prev: State, form: FormData): Promise<State> {
  let message = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const row = z.coerce.number().int().min(0).max(5000).parse(text(form, "row"));
    const raw = text(form, "driverId").trim();
    const driverId = raw ? idSchema("ドライバーを選んでください").parse(raw) : null;
    const db = await getDb();
    message = await assignBankRow(db, user.tenantId, batchId, row, driverId);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.bank.assign", entity: "import_batch", entityId: batchId, detail: { row, driverId } });
    refresh(batchId);
  });
  return res.ok ? { ...res, message } : res;
}

/** チェックした人の口座を台帳に書く */
export async function bankApplyAction(_prev: State, form: FormData): Promise<State> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const rows = form
      .getAll("row")
      .map((v) => (typeof v === "string" ? Number(v) : NaN))
      .filter((n) => Number.isInteger(n) && n >= 0);
    const seen: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      const m = k.match(/^seen-(\d+)$/);
      if (m && typeof v === "string") seen[m[1]] = v.slice(0, 64);
    }
    const db = await getDb();
    const result = await applyBankImport(db, user.tenantId, user, batchId, { rows, seen });
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.bank.apply",
      entity: "import_batch",
      entityId: batchId,
      detail: { created: result.created, updated: result.updated, drivers: result.drivers.map((d) => d.name) },
    });
    refresh(batchId);
    return batchId;
  });
  if (res.ok && res.data) redirect(`/import/bank/${res.data}?done=applied`);
  return res;
}

/** 口座の取り込みをやめる → 取り込みの画面（口座）へ */
export async function bankDiscardAction(_prev: State, form: FormData): Promise<State> {
  let back = "/import?kind=bank";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const month = monthInputSchema.safeParse(text(form, "month"));
    if (month.success) back = `/import?m=${monthParam(month.data)}&kind=bank`;
    const db = await getDb();
    await discardBankDraft(db, user.tenantId, user, batchId);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.bank.discard", entity: "import_batch", entityId: batchId });
    refresh(batchId);
    return true;
  });
  if (res.ok) redirect(back);
  return res;
}
