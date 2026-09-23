"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { createInvite, requireUser } from "~/server/auth";
import { formObject, idSchema, inviteSchema, roleSchema } from "~/server/features/settings/schemas";
import { changeUserRole, prepareInvite, revokeInvite, setUserDisabled } from "~/server/features/settings/users";
import { requestOrigin } from "~/server/features/statements/request";

/** 利用者（オーナーだけ）。招待はメールを送らず、リンクを画面に出してコピーしてもらう */

type State = ActionResult<unknown> | undefined;

const idOf = (form: FormData) => idSchema("その利用者は見つかりません。画面を読み直してください").parse(String(form.get("id") ?? ""));

export async function changeRoleAction(_prev: State, form: FormData): Promise<State> {
  let self = false;
  const res = await runAction(async () => {
    const user = await requireUser("owner");
    const id = idOf(form);
    const role = roleSchema.parse(String(form.get("role") ?? ""));
    const db = await getDb();
    const { before, after, changed } = await changeUserRole(db, user.tenantId, id, role);
    if (changed) {
      await audit(db, { tenantId: user.tenantId, userId: user.id, action: "user.role", entity: "user", entityId: id, detail: { name: after.name, from: before.role, to: after.role } });
    }
    self = id === user.id && role !== "owner";
    revalidatePath("/", "layout");
  }, "役割を変えました。次に画面を開いたときから効きます");
  // 自分をオーナーから外したら、この画面はもう開けないので設定のはじめへ
  if (res?.ok && self) redirect("/settings");
  return res;
}

export async function setUserDisabledAction(_prev: State, form: FormData): Promise<State> {
  const disabled = form.get("disabled") === "1";
  let hasPassword = true;
  const res = await runAction(
    async () => {
      const user = await requireUser("owner");
      const id = idOf(form);
      const db = await getDb();
      const { after } = await setUserDisabled(db, user.tenantId, user.id, id, disabled);
      hasPassword = !!after.passwordHash;
      await audit(db, { tenantId: user.tenantId, userId: user.id, action: disabled ? "user.disable" : "user.enable", entity: "user", entityId: id, detail: { name: after.name, email: after.email } });
      revalidatePath("/", "layout");
    },
    disabled ? "止めました。この方はもうログインできません（記録に名前は残ります）" : "再開しました。前のパスワードでログインできます",
  );
  // パスワードをまだ決めていない人は、再開しても入れないので、招待し直しを案内する
  if (res?.ok && !disabled && !hasPassword) {
    return { ...res, message: "再開しました。この方はパスワードをまだ決めていないので、下の「招待する」からリンクを作って送ってください" };
  }
  return res;
}

export type InviteResult = { url: string; email: string; name: string; expiresAt: string; reactivates: boolean };

export async function inviteAction(_prev: ActionResult<InviteResult> | undefined, form: FormData): Promise<ActionResult<InviteResult>> {
  return runAction(async () => {
    const user = await requireUser("owner");
    const input = inviteSchema.parse(formObject(form));
    const db = await getDb();
    const { reactivates } = await prepareInvite(db, user.tenantId, input);
    const token = await createInvite(user.tenantId, input.email, input.name, input.role);
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    // 招待リンクの値そのものは記録に残さない（ハッシュだけが DB にある）
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "invite.create", entity: "invite", detail: { email: input.email, name: input.name, role: input.role, reactivates } });
    revalidatePath("/settings/users");
    return { url: `${await requestOrigin()}/invite/${token}`, email: input.email, name: input.name, expiresAt, reactivates };
  }, "招待のリンクを作りました。下のリンクをコピーして、ご本人に送ってください");
}

export async function revokeInviteAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("owner");
    const tokenHash = z
      .string()
      .regex(/^[0-9a-f]{64}$/, "その招待は見つかりません。画面を読み直してください")
      .parse(String(form.get("token") ?? ""));
    const db = await getDb();
    const row = await revokeInvite(db, user.tenantId, tokenHash);
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: "invite.revoke", entity: "invite", detail: { email: row.email, name: row.name, role: row.role } });
    revalidatePath("/settings/users");
  }, "招待を取り消しました。そのリンクはもう使えません");
}
