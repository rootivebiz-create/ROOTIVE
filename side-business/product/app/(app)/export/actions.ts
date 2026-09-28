"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import { saveAccountingSettings } from "~/server/features/accounting";

/** 会計ソフトへの出力の画面の Server Action（薄い包み。中身は server/features/accounting.ts） */

export type SaveAccountingState = ActionResult | undefined;

const softwareSchema = z.enum(["yayoi", "freee", "mf", "generic"], { message: "会計ソフトを選んでください" });
const valueSchema = z.string().max(200, "長すぎます");

export async function saveAccountingAction(_prev: SaveAccountingState, form: FormData): Promise<SaveAccountingState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const software = softwareSchema.parse(form.get("software"));
    const accounts: Record<string, string> = {};
    const taxLabels: Record<string, string> = {};
    for (const [name, raw] of form.entries()) {
      if (typeof raw !== "string") continue;
      if (name.startsWith("account.")) accounts[name.slice("account.".length)] = valueSchema.parse(raw);
      else if (name.startsWith("tax.")) taxLabels[name.slice("tax.".length)] = valueSchema.parse(raw);
    }
    const db = await getDb();
    await saveAccountingSettings(db, user.tenantId, { software, accounts, taxLabels, payableSubByDriver: form.get("payableSub") === "on" }, user.id);
    revalidatePath("/export");
    return undefined;
  }, "保存しました。次からは、この勘定科目と税区分で出します。");
}
