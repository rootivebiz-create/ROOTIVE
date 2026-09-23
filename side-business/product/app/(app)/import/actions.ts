"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { idSchema, monthInputSchema, quickDriverSchema, quickProjectSchema, roleSchema } from "~/server/features/import/schemas";
import {
  applyBatch,
  createDraftFromFile,
  deleteProfile,
  discardDraft,
  readSampleFile,
  resolveName,
  selectSheet,
  setBatchMonth,
  setHeaderRow,
  undoBatch,
  updateMapping,
} from "~/server/features/import/service";
import { MAX_FILE_BYTES, type ColumnRole } from "~/server/features/import/types";
import { monthParam } from "~/server/month";

/**
 * 取り込みの Server Action。どれも：役割の確認 → 入力の確かめ → server/features/import の処理 → 記録 → 画面の読み直し。
 */

type State = ActionResult<unknown> | undefined;

const batchIdSchema = idSchema("取り込みが見つかりません。画面を読み直してください");
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

function refresh(batchId?: string) {
  // 稼働が変わると、ホーム・明細・見張り番の表示も変わる
  revalidatePath("/", "layout");
  if (batchId) revalidatePath(`/import/${batchId}`);
}

/** ファイルを置く（または見本で試す）→ 確認の画面へ */
export async function uploadAction(_prev: State, form: FormData): Promise<State> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const pageMonth = monthInputSchema.parse(text(form, "month"));
    const sample = text(form, "sample");
    let fileName: string;
    let bytes: Uint8Array;
    if (sample === "long" || sample === "wide") {
      ({ fileName, bytes } = await readSampleFile(sample));
    } else {
      const file = form.get("file");
      if (!(file instanceof File) || file.name === "") throw new UserError("ファイルを選んでください");
      if (file.size > MAX_FILE_BYTES) throw new UserError("ファイルが大きすぎます（10MB まで）。使っていないシートや画像を消してから置いてください");
      fileName = file.name;
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    const db = await getDb();
    const draft = await createDraftFromFile(db, user.tenantId, user, { fileName, bytes, pageMonth, sample: sample === "long" || sample === "wide" });
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.upload",
      entity: "import_batch",
      entityId: draft.id,
      detail: { fileName, size: bytes.byteLength, month: draft.month, sample: sample || null },
    });
    refresh();
    return draft.id;
  });
  if (res.ok && res.data) redirect(`/import/${res.data}`);
  return res;
}

export async function selectSheetAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const sheet = z.coerce.number().int().min(0).parse(text(form, "sheet"));
    const db = await getDb();
    await selectSheet(db, user.tenantId, batchId, sheet);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.sheet", entity: "import_batch", entityId: batchId, detail: { sheet } });
    refresh(batchId);
  }, "シートを切り替えました");
}

export async function headerRowAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const headerRow = z.coerce.number().int().min(0).parse(text(form, "headerRow"));
    const db = await getDb();
    await setHeaderRow(db, user.tenantId, batchId, headerRow);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.header", entity: "import_batch", entityId: batchId, detail: { headerRow } });
    refresh(batchId);
  }, "見出しの行を変えて、読み直しました");
}

export async function mappingAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const width = z.coerce.number().int().min(1).max(200).parse(text(form, "width"));
    const roles: ColumnRole[] = [];
    for (let i = 0; i < width; i++) roles.push(roleSchema.catch("ignore").parse(text(form, `role-${i}`) || "ignore"));
    const fixed = text(form, "fixedProjectId").trim();
    const fixedProjectId = fixed ? idSchema("案件を選び直してください").parse(fixed) : null;
    const useDates = text(form, "useDates") === "on";
    const remember = text(form, "remember") === "on";
    const db = await getDb();
    const { problem } = await updateMapping(db, user.tenantId, batchId, { roles, fixedProjectId, useDates, remember });
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.mapping",
      entity: "import_batch",
      entityId: batchId,
      detail: { roles, fixedProjectId, useDates, remember },
    });
    refresh(batchId);
    if (problem) throw new UserError(`保存しました。ただし、このままでは取り込めません：${problem}`);
  }, "読み方を保存しました。下で結果を確かめてください");
}

export async function monthAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const month = monthInputSchema.parse(text(form, "month"));
    const db = await getDb();
    await setBatchMonth(db, user.tenantId, batchId, month);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.month", entity: "import_batch", entityId: batchId, detail: { month } });
    refresh(batchId);
  }, "書き込む月を変えました");
}

const resolveBase = z.object({
  batchId: batchIdSchema,
  kind: z.enum(["driver", "project"]),
  key: z.string().min(1).max(300),
});

/** 名前を決める：候補を選ぶ・新しく登録する・取り込まない */
export async function resolveAction(_prev: State, form: FormData): Promise<State> {
  let message = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const base = resolveBase.parse({ batchId: text(form, "batchId"), kind: text(form, "kind"), key: text(form, "key") });
    const action = text(form, "action");
    const db = await getDb();
    let out;
    if (action === "match") {
      const targetId = idSchema(base.kind === "driver" ? "ドライバーを選んでください" : "案件を選んでください").parse(text(form, "targetId"));
      out = await resolveName(db, user.tenantId, base.batchId, { kind: base.kind, key: base.key, action: "match", targetId });
    } else if (action === "skip" || action === "unskip") {
      out = await resolveName(db, user.tenantId, base.batchId, { kind: base.kind, key: base.key, action });
    } else if (action === "create" && base.kind === "driver") {
      const d = quickDriverSchema.parse({ name: text(form, "name"), kana: text(form, "kana"), code: text(form, "code") });
      out = await resolveName(db, user.tenantId, base.batchId, { kind: "driver", key: base.key, action: "create", ...d });
    } else if (action === "create" && base.kind === "project") {
      const p = quickProjectSchema.parse({
        name: text(form, "name"),
        unit: text(form, "unit"),
        billRate: text(form, "billRate"),
        payRate: text(form, "payRate"),
        clientId: text(form, "clientId"),
      });
      out = await resolveName(db, user.tenantId, base.batchId, { kind: "project", key: base.key, action: "create", ...p });
    } else {
      throw new UserError("操作が分かりませんでした。画面を読み直してください");
    }
    message = out.message;
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: `import.name.${action}`,
      entity: base.kind,
      entityId: out.learned?.id ?? null,
      detail: { batchId: base.batchId, key: base.key, learned: out.learned ?? null },
    });
    refresh(base.batchId);
  });
  return res.ok ? { ...res, message } : res;
}

/** 反映：稼働に書く → 反映済みの画面へ */
export async function applyAction(_prev: State, form: FormData): Promise<State> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const mode = z.enum(["replace", "replaceAll", "add"], { error: "入れ替え方を選んでください" }).parse(text(form, "mode"));
    const confirmDuplicates = text(form, "confirmDuplicates") === "on";
    const db = await getDb();
    const result = await applyBatch(db, user.tenantId, user, batchId, { mode, confirmDuplicates });
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.apply",
      entity: "import_batch",
      entityId: batchId,
      detail: { mode, confirmDuplicates, ...result },
    });
    refresh(batchId);
    return batchId;
  });
  if (res.ok && res.data) redirect(`/import/${res.data}?done=applied`);
  return res;
}

/** 取り消し：この取り込みで入れた稼働を消し、入れ替えた前の分を戻す */
export async function undoAction(_prev: State, form: FormData): Promise<State> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const db = await getDb();
    const result = await undoBatch(db, user.tenantId, user, batchId);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.undo", entity: "import_batch", entityId: batchId, detail: result });
    refresh(batchId);
    return batchId;
  });
  if (res.ok && res.data) redirect(`/import/${res.data}?done=undone`);
  return res;
}

/** 下書きをやめる → 取り込みの一覧へ */
export async function discardAction(_prev: State, form: FormData): Promise<State> {
  let back = "/import";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const batchId = batchIdSchema.parse(text(form, "batchId"));
    const month = monthInputSchema.safeParse(text(form, "month"));
    if (month.success) back = `/import?m=${monthParam(month.data)}`;
    const db = await getDb();
    await discardDraft(db, user.tenantId, user, batchId);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "import.discard", entity: "import_batch", entityId: batchId });
    refresh(batchId);
    return true;
  });
  if (res.ok) redirect(back);
  return res;
}

/** 覚えた読み方を忘れる */
export async function deleteProfileAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const profileId = idSchema("見つかりません").parse(text(form, "profileId"));
    const db = await getDb();
    const name = await deleteProfile(db, user.tenantId, profileId);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.profile.delete",
      entity: "mapping_profile",
      entityId: profileId,
      detail: { name },
    });
    refresh();
  }, "読み方を忘れました。次に同じ形のファイルを置くと、読み方を推測し直します");
}
