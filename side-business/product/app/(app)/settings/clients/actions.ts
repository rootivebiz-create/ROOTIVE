"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import {
  CLIENT_ACTIVATE_ACTION,
  CLIENT_DEACTIVATE_ACTION,
  clientsDoneHref,
  createClient,
  deactivateClient,
  deleteClient,
  restoreClient,
  updateClient,
} from "~/server/features/settings/clients";
import { checkbox, clientSchema, formObject, idSchema } from "~/server/features/settings/schemas";

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

/** 取引をやめる（無効にする）・戻す。案件も一緒に「使わない」にする／戻すかを選べる */
export async function setClientActiveAction(_prev: State, form: FormData): Promise<State> {
  const active = form.get("active") === "1";
  const withProjects = checkbox.parse(String(form.get("withProjects") ?? ""));
  let projects = 0;
  let clientId = "";
  const result = await runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    clientId = id;
    const db = await getDb();
    const r = active ? await restoreClient(db, user.tenantId, id, { withProjects }) : await deactivateClient(db, user.tenantId, id, { withProjects });
    projects = r.projectIds.length;
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: active ? CLIENT_ACTIVATE_ACTION : CLIENT_DEACTIVATE_ACTION,
      entity: "client",
      entityId: id,
      // 一緒に切り替えた案件の id（戻すときに、この案件だけを戻す）
      detail: { name: r.before.name, projectIds: r.projectIds },
    });
    revalidatePath("/", "layout");
  });
  if (!result.ok) return result;
  // 元請は「取引している」と「無効の元請」の間を移るので、押した場所の知らせは消えてしまう。上の知らせで結果を伝える
  redirect(clientsDoneHref(active ? "on" : "off", clientId, projects));
}
