"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { createDriver, deleteDriver, setDriverActive, updateDriver } from "~/server/features/settings/drivers";
import { driverSchema, formObject, idSchema } from "~/server/features/settings/schemas";

/** ドライバーの台帳（事務から）。役割 → 入力 → 保存（会社で絞る）→ 記録 → 読み直し */

type State = ActionResult<unknown> | undefined;

function idOf(form: FormData): string {
  return idSchema("そのドライバーは見つかりません。一覧から開き直してください").parse(String(form.get("id") ?? ""));
}

export async function createDriverAction(_prev: State, form: FormData): Promise<State> {
  let next = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const input = driverSchema.parse(formObject(form));
    const db = await getDb();
    const row = await createDriver(db, user.tenantId, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "driver.create",
      entity: "driver",
      entityId: row.id,
      detail: { name: row.name, code: row.code, invoiceRegistered: row.invoiceRegistered, hasBank: !!row.accountNumber },
    });
    revalidatePath("/", "layout");
    next = `/settings/drivers/${row.id}?saved=created`;
  });
  if (res?.ok) redirect(next);
  return res;
}

export async function updateDriverAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const input = driverSchema.parse(formObject(form));
    const db = await getDb();
    const { after, changed } = await updateDriver(db, user.tenantId, id, input);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "driver.update", entity: "driver", entityId: id, detail: { name: after.name, changed } });
    revalidatePath("/", "layout");
  }, "保存しました。まだ締めていない月の明細は、作り直すと反映されます");
}

export async function setDriverActiveAction(_prev: State, form: FormData): Promise<State> {
  const active = form.get("active") === "1";
  return runAction(
    async () => {
      const user = await requireUser("staff");
      const id = idOf(form);
      const db = await getDb();
      const { before } = await setDriverActive(db, user.tenantId, id, active);
      await audit(db, {
        tenantId: user.tenantId,
        userId: user.id,
        action: active ? "driver.activate" : "driver.deactivate",
        entity: "driver",
        entityId: id,
        detail: { name: before.name },
      });
      revalidatePath("/", "layout");
    },
    active ? "有効に戻しました" : "無効にしました。記録はそのまま残ります",
  );
}

export async function deleteDriverAction(_prev: State, form: FormData): Promise<State> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const db = await getDb();
    const { before, refs } = await deleteDriver(db, user.tenantId, id);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "driver.delete",
      entity: "driver",
      entityId: id,
      detail: { name: before.name, code: before.code, removedOverrides: refs.attached.overrides, removedRules: refs.attached.rules },
    });
    revalidatePath("/", "layout");
  });
  if (res?.ok) redirect("/settings/drivers?saved=deleted");
  return res;
}
