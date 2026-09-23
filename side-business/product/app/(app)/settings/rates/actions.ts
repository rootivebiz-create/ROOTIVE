"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import type { ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { deleteOverride, upsertOverride } from "~/server/features/settings/rates";
import { confirmKeyOf, impactDetail, runSettingsAction, withOpenMonthCheck } from "~/server/features/settings/open-months";
import { formObject, idSchema, overrideSchema } from "~/server/features/settings/schemas";

/** ドライバー別の単価（事務から）。同じ人 × 案件は上書き */

type State = ActionResult<unknown> | undefined;

export async function saveOverrideAction(_prev: State, form: FormData): Promise<State> {
  return runSettingsAction(async () => {
    const user = await requireUser("staff");
    const input = overrideSchema.parse(formObject(form));
    const db = await getDb();
    // まだ締めていない月の明細が変わるときは、変わる月と額を見せ、「反映する」を選んだときだけ保存する
    const {
      result: { before, after, driver, project, created },
      impact,
    } = await withOpenMonthCheck(db, user.tenantId, confirmKeyOf(form), (t) => upsertOverride(t, user.tenantId, input));
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: created ? "rate_override.create" : "rate_override.update",
      entity: "rate_override",
      entityId: after.id,
      detail: {
        driver: driver.name,
        project: project.name,
        standard: project.payRate,
        before: before ? { payRate: before.payRate, agreedOn: before.agreedOn } : null,
        after: { payRate: after.payRate, agreedOn: after.agreedOn },
        ...impactDetail(impact),
      },
    });
    revalidatePath("/", "layout");
  }, "保存しました。まだ締めていない月の明細は、作り直すと反映されます");
}

export async function deleteOverrideAction(_prev: State, form: FormData): Promise<State> {
  return runSettingsAction(async () => {
    const user = await requireUser("staff");
    const id = idSchema("その単価は見つかりません。画面を読み直してください").parse(String(form.get("id") ?? ""));
    const db = await getDb();
    const { result: before, impact } = await withOpenMonthCheck(db, user.tenantId, confirmKeyOf(form), (t) => deleteOverride(t, user.tenantId, id));
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "rate_override.delete",
      entity: "rate_override",
      entityId: id,
      detail: { driverId: before.driverId, projectId: before.projectId, payRate: before.payRate, agreedOn: before.agreedOn, ...impactDetail(impact) },
    });
    revalidatePath("/", "layout");
  }, "消しました。この人は案件の標準の単価に戻ります");
}
