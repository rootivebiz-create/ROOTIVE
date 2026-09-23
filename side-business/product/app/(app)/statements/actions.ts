"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import { markStatementSent, recreateStatementLink, replyToDriver, resolveThread, type SendChannel } from "~/server/features/statements";
import { isUuid } from "~/server/features/statements/view";
import { generateStatements, type GenerateResult } from "~/server/statements-core";

/** 支払明細（会社の側）の操作。どれも最初に役割を確かめ、会社で絞った関数を呼ぶだけ */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "月の形が正しくありません");
const idSchema = z.string().refine(isUuid, "明細が見つかりません。一覧から開き直してください");
const lineKeySchema = z
  .string()
  .max(100)
  .optional()
  .transform((v) => (v ? v : null));

function refresh(id?: string) {
  revalidatePath("/statements");
  if (id) revalidatePath(`/statements/${id}`);
  revalidatePath("/");
}

export type GenerateState = ActionResult<GenerateResult> | undefined;

export async function generateStatementsAction(_prev: GenerateState, form: FormData): Promise<ActionResult<GenerateResult>> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const month = monthSchema.parse(String(form.get("month") ?? ""));
    const db = await getDb();
    const result = await generateStatements(db, user.tenantId, month, user.id);
    refresh();
    return result;
  });
  if (res.ok && res.data) {
    const r = res.data;
    res.message =
      r.total === 0 && r.removed === 0
        ? "この月は明細にする稼働・調整がありませんでした"
        : r.created + r.updated + r.removed === 0
          ? `変わった明細はありません（${r.unchanged}人分そのまま）`
          : `明細を作りました（新しく ${r.created}人・作り直し ${r.updated}人・変わらず ${r.unchanged}人${r.removed ? `・消した ${r.removed}人` : ""}）`;
  }
  return res;
}

const channelSchema = z.enum(["copy", "line", "sms", "mail", "paper"]);

/** 送った記録をつける（コピー・LINE・SMS・メールのボタン、紙で渡したとき） */
export async function markSentAction(id: string, channel: SendChannel): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const sid = idSchema.parse(id);
    const ch = channelSchema.parse(channel);
    const db = await getDb();
    await markStatementSent(db, user.tenantId, sid, user.id, ch);
    refresh(sid);
  }, "送った記録をつけました");
}

export async function recreateLinkAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const id = idSchema.parse(String(form.get("id") ?? ""));
    const db = await getDb();
    await recreateStatementLink(db, user.tenantId, id, user.id);
    refresh(id);
  }, "リンクを作り直しました。今までのリンクは使えません。新しいリンクを送ってください");
}

const replySchema = z.object({
  id: idSchema,
  lineKey: lineKeySchema,
  body: z.string().trim().min(1, "返事を書いてください").max(1000, "1,000 文字までにしてください"),
});

export async function replyAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const input = replySchema.parse({ id: form.get("id"), lineKey: form.get("lineKey") ?? undefined, body: form.get("body") ?? "" });
    const db = await getDb();
    await replyToDriver(db, user.tenantId, input.id, user.id, { lineKey: input.lineKey, body: input.body });
    refresh(input.id);
  }, "返事を送りました。ドライバーは同じリンクで読めます");
}

const resolveSchema = z.object({ id: idSchema, lineKey: lineKeySchema, resolved: z.enum(["1", "0"]) });

export async function resolveAction(_prev: ActionResult<void> | undefined, form: FormData): Promise<ActionResult<void>> {
  const resolved = form.get("resolved") === "1";
  return runAction(
    async () => {
      const user = await requireUser("staff");
      const input = resolveSchema.parse({ id: form.get("id"), lineKey: form.get("lineKey") ?? undefined, resolved: form.get("resolved") });
      const db = await getDb();
      await resolveThread(db, user.tenantId, input.id, user.id, input.lineKey, input.resolved === "1");
      refresh(input.id);
    },
    resolved ? "解決にしました" : "未解決に戻しました",
  );
}
