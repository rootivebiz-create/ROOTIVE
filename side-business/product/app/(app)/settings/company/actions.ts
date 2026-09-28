"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { AI_CONSENT_ACTION, setAiConsent, updateCompany } from "~/server/features/settings/company";
import { companySchema, formObject } from "~/server/features/settings/schemas";

/** 会社の設定（オーナーだけ）。役割の確認 → 入力の確かめ → 保存 → 記録 → 読み直し */

type State = ActionResult<unknown> | undefined;

export async function saveCompanyAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("owner");
    const input = companySchema.parse(formObject(form));
    const db = await getDb();
    const { changed } = await updateCompany(db, user.tenantId, input);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "settings.company.update", entity: "tenant", entityId: user.tenantId, detail: { changed } });
    revalidatePath("/", "layout");
  }, "会社の設定を保存しました。まだ締めていない月の明細は、作り直すと反映されます");
}

export async function setAiConsentAction(_prev: State, form: FormData): Promise<State> {
  const on = form.get("on") === "1";
  return runAction(
    async () => {
      const user = await requireUser("owner");
      const db = await getDb();
      const r = await setAiConsent(db, user.tenantId, on);
      await audit(db, { tenantId: user.tenantId, userId: user.id, action: AI_CONSENT_ACTION, entity: "tenant", entityId: user.tenantId, detail: { on, before: r.before } });
      revalidatePath("/", "layout");
    },
    on ? "AI の読み取りを使うことに同意しました（いつでも止められます）" : "AI の読み取りを止めました。これからは AI に送りません",
  );
}
