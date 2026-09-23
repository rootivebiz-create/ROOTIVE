"use server";

import { redirect } from "next/navigation";
import { getDb } from "~/db/client";
import { clientIpHash, createSession } from "~/server/auth";
import { DemoBusyError, isDemoMode, safeDemoNext, startDemoTenant } from "~/server/demo";
import { tooMany } from "~/server/rate-limit";

export type DemoStartState = { error?: string } | undefined;

/**
 * デモの会社を作り、そのオーナーとして入る（ログインなし）。
 * 押したときだけ作る（POST）。開いただけ（検索のロボット・リンクのプレビュー・クッキーを持たない相手）では作らない
 */
export async function startDemoAction(_prev: DemoStartState, form: FormData): Promise<DemoStartState> {
  if (!isDemoMode()) redirect("/login");
  const ip = (await clientIpHash()) ?? "unknown";
  if (tooMany(`demo:${ip}`, 10, 10 * 60 * 1000)) {
    return { error: "デモの作成が続いています。少し時間をおいてから、もう一度お試しください。" };
  }
  const db = await getDb();
  let started: { tenantId: string; userId: string };
  try {
    started = await startDemoTenant(db);
  } catch (e) {
    if (e instanceof DemoBusyError) return { error: e.message };
    console.error("demo start failed", e);
    return { error: "デモを作れませんでした。少し時間をおいてから、もう一度お試しください。" };
  }
  await createSession({ id: started.userId, tenantId: started.tenantId });
  redirect(safeDemoNext(String(form.get("next") ?? "")));
}
