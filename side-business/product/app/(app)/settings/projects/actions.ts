"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { createProject, deleteProject, setProjectActive, updateProject } from "~/server/features/settings/projects";
import { formObject, idSchema, projectSchema } from "~/server/features/settings/schemas";

/** 案件と標準の単価（事務から） */

type State = ActionResult<unknown> | undefined;

const idOf = (form: FormData) => idSchema("その案件は見つかりません。画面を読み直してください").parse(String(form.get("id") ?? ""));

export async function createProjectAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = projectSchema.parse(formObject(form));
    const db = await getDb();
    const row = await createProject(db, user.tenantId, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "project.create",
      entity: "project",
      entityId: row.id,
      detail: { name: row.name, clientId: row.clientId, unit: row.unit, billRate: row.billRate, payRate: row.payRate },
    });
    revalidatePath("/", "layout");
  }, "案件を足しました");
}

export async function updateProjectAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const input = projectSchema.parse(formObject(form));
    const db = await getDb();
    const { after, changed } = await updateProject(db, user.tenantId, id, input);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "project.update", entity: "project", entityId: id, detail: { name: after.name, changed } });
    revalidatePath("/", "layout");
  }, "保存しました。まだ締めていない月の明細は、作り直すと反映されます");
}

export async function setProjectActiveAction(_prev: State, form: FormData): Promise<State> {
  const active = form.get("active") === "1";
  return runAction(
    async () => {
      const user = await requireUser("staff");
      const id = idOf(form);
      const db = await getDb();
      const { before } = await setProjectActive(db, user.tenantId, id, active);
      await audit(db, {
        tenantId: user.tenantId,
        userId: user.id,
        action: active ? "project.activate" : "project.deactivate",
        entity: "project",
        entityId: id,
        detail: { name: before.name },
      });
      revalidatePath("/", "layout");
    },
    active ? "使うように戻しました" : "「使わない」にしました。記録はそのまま残ります",
  );
}

export async function deleteProjectAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const db = await getDb();
    const { before, refs } = await deleteProject(db, user.tenantId, id);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "project.delete",
      entity: "project",
      entityId: id,
      detail: { name: before.name, billRate: before.billRate, payRate: before.payRate, removedOverrides: refs.attached.overrides },
    });
    revalidatePath("/", "layout");
  }, "消しました");
}
