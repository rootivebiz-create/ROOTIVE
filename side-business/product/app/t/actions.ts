"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { receiveTermsFromPortal, TERMS_LINK_UNUSABLE, type ReceiveResult } from "~/server/features/terms/portal";
import { termsRequestContext } from "~/server/features/terms/request";

/**
 * ドライバーの取引条件のページの操作（ログインなし）。
 * 送られてきたリンクの値を毎回確かめ直す（画面の hidden の id などは使わない）。
 */

export type ReceiveState = ActionResult<ReceiveResult> | undefined;

export async function receiveTermsAction(_prev: ReceiveState, form: FormData): Promise<ActionResult<ReceiveResult>> {
  return runAction(async () => {
    const raw = form.get("token");
    const token = typeof raw === "string" ? raw : "";
    if (!token || token.length > 600) throw new UserError(TERMS_LINK_UNUSABLE);
    const version = Number(form.get("version"));
    const db = await getDb();
    const result = await receiveTermsFromPortal(db, token, { version }, await termsRequestContext(db, token));
    revalidatePath("/t/[token]", "page");
    revalidatePath("/terms");
    revalidatePath("/terms/[driverId]", "page");
    return result;
  });
}
