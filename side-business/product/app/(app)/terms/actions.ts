"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import {
  bulkCreateTerms,
  createTermsVersion,
  markTermsSent,
  recreateTermsLink,
  type BulkTermsResult,
  type CreateTermsResult,
} from "~/server/features/terms";
import { isUuid, termsChannelSchema, type TermsChannel } from "~/server/features/terms/schema";

/**
 * 取引条件の明示書（会社の側）の操作。どれも最初に役割を確かめ、会社で絞った機能の関数を呼ぶだけ。
 * 入力の確かめ（zod）は機能の関数の中で 1 か所にまとめている。
 */

function refresh() {
  revalidatePath("/terms");
  revalidatePath("/terms/[driverId]", "page");
  revalidatePath("/");
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

function flag(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "1" || v === "on" || v === "true";
}

export type CreateTermsState = ActionResult<CreateTermsResult> | undefined;

/** 1 人の新しい版を作る */
export async function createTermsAction(_prev: CreateTermsState, form: FormData): Promise<ActionResult<CreateTermsResult>> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const db = await getDb();
    const base = str(form, "baseVersion");
    const driverId = str(form, "driverId");
    const result = await createTermsVersion(db, user.tenantId, { userId: user.id, role: user.role }, {
      driverId,
      baseVersion: base === "" ? null : Number(base),
      projectIds: form.getAll("projectIds").filter((v): v is string => typeof v === "string"),
      serviceDescription: str(form, "serviceDescription"),
      place: str(form, "place"),
      periodFrom: str(form, "periodFrom"),
      periodTo: str(form, "periodTo"),
      commissionedOn: str(form, "commissionedOn"),
      receipt: str(form, "receipt"),
      other: str(form, "other"),
      deemed: flag(form, "deemed"),
      isSubcontract: flag(form, "isSubcontract"),
      originalClient: str(form, "originalClient"),
      originalPayDate: str(form, "originalPayDate"),
      documentName: str(form, "documentName"),
      issuedOn: str(form, "issuedOn"),
    });
    refresh();
    return result;
  });
  if (res.ok && res.data) {
    const r = res.data;
    res.message = r.created
      ? `版 ${r.version} を保存しました。次は「ドライバーへ送る」から、リンクを送ってください${r.firstIssuedOnSet ? "（台帳の「取引条件を明示した日」にも入れました）" : ""}`
      : `前の版（版 ${r.version}）と中身が同じなので、新しい版は作りませんでした`;
  }
  return res;
}

export type BulkTermsState = ActionResult<BulkTermsResult> | undefined;

/** 未作成の人の明示書（版 1）をまとめて作る */
export async function bulkCreateTermsAction(_prev: BulkTermsState, form: FormData): Promise<ActionResult<BulkTermsResult>> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const db = await getDb();
    const result = await bulkCreateTerms(db, user.tenantId, { userId: user.id, role: user.role }, {
      issuedOn: str(form, "issuedOn"),
      place: str(form, "place"),
      deemed: flag(form, "deemed"),
    });
    refresh();
    return result;
  });
  if (res.ok && res.data) {
    const r = res.data;
    const skipped = r.skipped.length ? `作れなかった人 ${r.skipped.length}人：${r.skipped.map((x) => `${x.name}（${x.reason}）`).join("、")}` : "";
    res.message =
      r.created.length === 0
        ? `新しく作る人はいませんでした。${skipped}`
        : `${r.created.length}人分の明示書（版 1）を作りました。1 人ずつ開いて、中身を確かめてからリンクを送ってください。${skipped}`;
  }
  return res;
}

/** 送った記録をつける（コピー・LINE・SMS・メールのボタン、紙で渡したとき） */
export async function markTermsSentAction(recordId: string, channel: TermsChannel): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    if (!isUuid(recordId)) throw new UserError("明示書が見つかりません。一覧から開き直してください");
    const ch = termsChannelSchema.parse(channel);
    const db = await getDb();
    await markTermsSent(db, user.tenantId, { userId: user.id, role: user.role }, recordId, ch);
    refresh();
  }, "送った記録をつけました");
}

/** リンクを作り直す（今までのリンクは使えなくなる） */
export async function recreateTermsLinkAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = str(form, "id");
    if (!isUuid(id)) throw new UserError("明示書が見つかりません。一覧から開き直してください");
    const db = await getDb();
    await recreateTermsLink(db, user.tenantId, { userId: user.id, role: user.role }, id);
    refresh();
  }, "リンクを作り直しました。今までのリンクは使えません。新しいリンクを送ってください");
}
