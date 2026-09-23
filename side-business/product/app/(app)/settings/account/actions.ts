"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import {
  changeOwnPassword,
  PASSWORD_CHANGE_ACTION,
  passwordChangeSchema,
  SESSION_COOKIE,
  sessionIdFromToken,
  SIGN_OUT_OTHERS_ACTION,
  signOutOtherSessions,
} from "~/server/features/settings/account";
import { formObject } from "~/server/features/settings/schemas";
import { tooMany } from "~/server/rate-limit";

/** 自分のアカウント（どの役割の人も、自分のぶんだけ） */

type State = ActionResult<unknown> | undefined;

/** いまの端末のセッションの id（クッキーの値のハッシュ） */
async function currentSessionId(): Promise<string | null> {
  const jar = await cookies();
  return sessionIdFromToken(jar.get(SESSION_COOKIE)?.value);
}

function noDemo() {
  if (process.env.DEMO_MODE === "1") throw new UserError("デモではパスワードを使いません（ログインの設定は変えられません）");
}

export async function changePasswordAction(_prev: State, form: FormData): Promise<State> {
  let signedOut = 0;
  const result = await runAction(async () => {
    // 見るだけの人も、自分のパスワードは変えられる
    const user = await requireUser("viewer");
    noDemo();
    // 今のパスワードの当てずっぽうを遅らせる（1 人あたり 15 分で 10 回まで）
    if (tooMany(`password-change:${user.id}`, 10, 15 * 60_000)) throw new UserError("何度も試したので、15 分ほどおいてからお試しください");
    const input = passwordChangeSchema.parse(formObject(form));
    const db = await getDb();
    const r = await changeOwnPassword(db, user.tenantId, user.id, input, await currentSessionId());
    signedOut = r.signedOut;
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: PASSWORD_CHANGE_ACTION, entity: "user", entityId: user.id, detail: { signedOutOthers: r.signedOut } });
    revalidatePath("/settings/account");
  });
  if (!result.ok) return result;
  return {
    ...result,
    message: `パスワードを変えました。次からは新しいパスワードでログインしてください。${signedOut ? `ほかの端末（${signedOut}か所）のログインは切りました。` : ""}`,
  };
}

export async function signOutOthersAction(_prev: State): Promise<State> {
  let count = 0;
  const result = await runAction(async () => {
    const user = await requireUser("viewer");
    noDemo();
    const db = await getDb();
    count = await signOutOtherSessions(db, user.tenantId, user.id, await currentSessionId());
    await audit(db, { tenantId: user.tenantId, userId: user.id, action: SIGN_OUT_OTHERS_ACTION, entity: "user", entityId: user.id, detail: { count } });
    revalidatePath("/settings/account");
  });
  if (!result.ok) return result;
  return { ...result, message: count ? `ほかの端末（${count}か所）からログアウトしました。この端末はそのままです。` : "ほかの端末ではログインしていませんでした。" };
}
