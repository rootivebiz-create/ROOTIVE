"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { createRule, deleteRule, setRuleActive, updateRule } from "~/server/features/settings/rules";
import { formObject, idSchema, ruleSchema } from "~/server/features/settings/schemas";

/** 控除のルール（事務から）。足したり額を変えたりしたら、前後の値を操作の記録に残す */

type State = ActionResult<unknown> | undefined;

const idOf = (form: FormData) => idSchema("その控除は見つかりません。画面を読み直してください").parse(String(form.get("id") ?? ""));

export async function createRuleAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = ruleSchema.parse(formObject(form));
    const db = await getDb();
    const row = await createRule(db, user.tenantId, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "deduction_rule.create",
      entity: "deduction_rule",
      entityId: row.id,
      detail: {
        name: row.name,
        driverId: row.driverId,
        kind: row.kind,
        rate: row.rate,
        amount: row.amount,
        onlyWhenWorked: row.onlyWhenWorked,
        taxable: row.taxable,
        agreedInWriting: row.agreedInWriting,
        agreedOn: row.agreedOn,
        basis: row.basis,
      },
    });
    revalidatePath("/", "layout");
  }, "控除を足しました。まだ締めていない月の明細は、作り直すと反映されます");
}

export async function updateRuleAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const input = ruleSchema.parse(formObject(form));
    const db = await getDb();
    const { after, changed } = await updateRule(db, user.tenantId, id, input);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "deduction_rule.update", entity: "deduction_rule", entityId: id, detail: { name: after.name, changed } });
    revalidatePath("/", "layout");
  }, "保存しました。まだ締めていない月の明細は、作り直すと反映されます");
}

export async function setRuleActiveAction(_prev: State, form: FormData): Promise<State> {
  const active = form.get("active") === "1";
  return runAction(
    async () => {
      const user = await requireUser("staff");
      const id = idOf(form);
      const db = await getDb();
      const { before } = await setRuleActive(db, user.tenantId, id, active);
      await audit(db, {
        tenantId: user.tenantId,
        userId: user.id,
        action: active ? "deduction_rule.activate" : "deduction_rule.deactivate",
        entity: "deduction_rule",
        entityId: id,
        detail: { name: before.name },
      });
      revalidatePath("/", "layout");
    },
    active ? "使うように戻しました" : "「使わない」にしました。これからの明細では引きません",
  );
}

export async function deleteRuleAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idOf(form);
    const db = await getDb();
    const { before } = await deleteRule(db, user.tenantId, id);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "deduction_rule.delete",
      entity: "deduction_rule",
      entityId: id,
      detail: { name: before.name, driverId: before.driverId, kind: before.kind, rate: before.rate, amount: before.amount },
    });
    revalidatePath("/", "layout");
  }, "消しました");
}
