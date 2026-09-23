"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { createClient, deleteClient, updateClient } from "~/server/features/settings/clients";
import { clientSchema, formObject, idSchema } from "~/server/features/settings/schemas";

/** 元請（事務から） */

type State = ActionResult<unknown> | undefined;

const idOf = (form: FormData) => idSchema("その元請は見つかりません。画面を読み直してください").parse(String(form.get("id") ?? ""));

export async function createClientAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = clientSchema.parse(formObject(form));
    const db = await getDb();
    const row = await createClient(db, user.tenantId, input);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "client.create", entity: "client", entityId: row.id, detail: { name: row.name, aliases: row.aliases } });
    revalidatePath("/", "layout");
  }, "元請を足しました。続けて案件と単価を登録してください");
}

export async function updateClientAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const input = clientSchema.parse(formObject(form));
    const db = await getDb();
    const { after, changed } = await updateClient(db, user.tenantId, id, input);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "client.update", entity: "client", entityId: id, detail: { name: after.name, changed } });
    revalidatePath("/", "layout");
  }, "保存しました");
}

export async function deleteClientAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const db = await getDb();
    const { before } = await deleteClient(db, user.tenantId, id);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "client.delete", entity: "client", entityId: id, detail: { name: before.name } });
    revalidatePath("/", "layout");
  }, "消しました");
}
