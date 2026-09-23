"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { askFromPortal, confirmFromPortal, recordPortalView, type ConfirmResult } from "~/server/features/portal";
import { portalRequestContext } from "~/server/features/statements/request";

/**
 * ドライバーの画面の操作（ログインなし）。
 * どれも、送られてきたリンクの値を毎回確かめ直す（画面の hidden の id などは使わない）。
 */

function tokenOf(value: FormDataEntryValue | null | string): string {
  const t = typeof value === "string" ? value : "";
  if (!t || t.length > 600) throw new UserError("このリンクは使えません（期限切れ・作り直し）。会社に新しいリンクをお願いしてください");
  return t;
}

function refresh() {
  revalidatePath("/s/[token]", "page");
  revalidatePath("/statements");
}

export type ConfirmState = ActionResult<ConfirmResult> | undefined;

export async function confirmAction(_prev: ConfirmState, form: FormData): Promise<ActionResult<ConfirmResult>> {
  return runAction(async () => {
    const token = tokenOf(form.get("token"));
    const version = Number(form.get("version"));
    const db = await getDb();
    const result = await confirmFromPortal(db, token, { version }, await portalRequestContext(db, token));
    refresh();
    return result;
  });
}

export type AskState = ActionResult<void> | undefined;

export async function askAction(_prev: AskState, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const token = tokenOf(form.get("token"));
    const lineKey = typeof form.get("lineKey") === "string" ? String(form.get("lineKey")) : "";
    const body = typeof form.get("body") === "string" ? String(form.get("body")) : "";
    const db = await getDb();
    await askFromPortal(db, token, { lineKey: lineKey || null, body }, await portalRequestContext(db, token));
    refresh();
  }, "送りました。会社からの返事は、このページに出ます");
}

/** 画面が開かれたことを記録する（ブラウザで開いたときだけ呼ばれる。失敗しても画面は止めない） */
export async function recordViewAction(token: string): Promise<void> {
  try {
    const t = tokenOf(token);
    const db = await getDb();
    await recordPortalView(db, t, await portalRequestContext(db, t));
  } catch (error) {
    console.error("portal view failed", error instanceof Error ? error.message : error);
  }
}
