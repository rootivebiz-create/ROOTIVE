"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { createInvite, requireUser } from "~/server/auth";
import { importTenantData, previewTenantImport, type ImportSummary } from "~/server/features/export-all";
import { requestOrigin } from "~/server/features/statements/request";

/** 全データの画面の Server Action（オーナーだけ。中身は server/features/export-all.ts） */

/** この画面から送れる大きさ（Server Action の上限 10MB に、送るときの余白を見る） */
const ACTION_MAX_BYTES = 9 * 1024 * 1024;

export type RestoreInvite = { name: string; email: string; url: string };
export type RestoreState = ActionResult<{ mode: "check" | "apply"; summary: ImportSummary; invites: RestoreInvite[] }> | undefined;

async function fileBytes(form: FormData): Promise<Uint8Array> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError("書き出しの ZIP を選んでください");
  if (file.size > ACTION_MAX_BYTES) throw new UserError("ファイルが大きすぎます（この画面からは 9MB まで）。大きいときは、しめ日ラボの窓口にご相談ください。");
  if (!/\.zip$/i.test(file.name)) throw new UserError("ZIP のファイル（.zip）を選んでください");
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * 読み戻し：mode=check は中身を確かめるだけ（書き込まない）。mode=apply で新しい会社として読み込み、
 * 読み込んだ会社のオーナーに招待のリンクを作る（パスワードは書き出していないため）。
 */
export async function restoreAction(_prev: RestoreState, form: FormData): Promise<RestoreState> {
  const mode = form.get("mode") === "apply" ? "apply" : "check";
  return runAction(
    async () => {
      const user = await requireUser("owner");
      // デモは架空の会社を 24 時間で消すため、読み戻し（消えない会社を作る）は使わない
      if (process.env.DEMO_MODE === "1") throw new UserError("デモでは読み戻しは使えません（書き出しは試せます）");
      const bytes = await fileBytes(form);
      const db = await getDb();
      if (mode === "check") {
        const summary = await previewTenantImport(db, bytes);
        return { mode, summary, invites: [] };
      }
      if (form.get("confirm") !== "on") throw new UserError("「この内容で読み込みます」に印を付けてください");
      const summary = await importTenantData(db, bytes, { restoredBy: `${user.name}（${user.email}）` });
      // 読み込んだ会社のオーナーへ、パスワードを決めるための招待のリンク（7 日で切れる）
      const origin = await requestOrigin();
      const invites: RestoreInvite[] = [];
      for (const o of summary.owners) {
        if (!o.email) continue;
        const token = await createInvite(summary.tenantId, o.email, o.name || o.email, "owner");
        invites.push({ name: o.name, email: o.email, url: `${origin}/invite/${token}` });
      }
      await audit(db, {
        tenantId: user.tenantId,
        userId: user.id,
        action: "data.import",
        entity: "tenant",
        entityId: summary.tenantId,
        detail: { restoredTenantId: summary.tenantId, tenantName: summary.tenantName, rows: summary.rows, versions: summary.versions, invites: invites.length },
      });
      revalidatePath("/data");
      return { mode, summary, invites };
    },
    mode === "check" ? "読み込める ZIP です。中身を確かめてから「読み込む」を押してください。" : "読み込みました。下の招待のリンクから、読み込んだ会社に入れます。",
  );
}
