import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { DEMO_MAX_FILE_BYTES, DEMO_MAX_FILE_LABEL } from "./types";

/**
 * デモ（DEMO_MODE=1。来た人ごとの架空の会社）で、1 つの会社が置けるファイルの上限。
 * デモの DB は小さな無料の Postgres のことが多いので、1 人（1 つのクッキー）が何度も置いて DB をいっぱいにし、
 * ほかの人のデモまで動かなくなることを防ぐ。回数の制限（tooMany）はサーバー 1 台の中だけなので、DB で数える。
 * デモの会社は 24 時間で消えるので、上限に届いたら新しいデモを始めてもらう。
 */
export const DEMO_MAX_UPLOADS = 15;
/** 取り込みの下書きに持つ中身（シートの文字）の合計の上限（1 つのデモの会社で） */
export const DEMO_MAX_STORED_BYTES = 1024 * 1024;

export function isDemo(): boolean {
  return process.env.DEMO_MODE === "1";
}

/** デモで大きすぎるファイル（本番の上限より小さくする） */
export function demoFileProblem(size: number, demo = isDemo()): string | null {
  if (!demo || size <= DEMO_MAX_FILE_BYTES) return null;
  return `デモでは ${DEMO_MAX_FILE_LABEL} までのファイルを置けます。使っていないシートを消すか、一部の行だけにして試してください（本番の環境では、もっと大きなファイルも置けます）`;
}

/**
 * デモの会社が、まだファイルを置けるか（置いた数と、保存している中身の大きさ）。
 * incomingBytes：これから保存する中身の大きさ（JSON の文字の長さ）
 */
export async function assertDemoUploadBudget(db: Db, tenantId: string, incomingBytes: number, demo = isDemo()): Promise<void> {
  if (!demo) return;
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(octet_length(${s.importBatches.summary}::text)), 0)::text`,
    })
    .from(s.importBatches)
    .where(eq(s.importBatches.tenantId, tenantId));
  const n = Number(row?.n ?? 0);
  const bytes = Number(row?.bytes ?? 0);
  const restart = "デモの会社は 24 時間で消えます。続けて試すときは、デモの入口（/demo/start）から新しいデモを始めてください";
  if (n >= DEMO_MAX_UPLOADS) throw new UserError(`このデモで置けるファイルは ${DEMO_MAX_UPLOADS} 件までです。${restart}`);
  if (bytes + incomingBytes > DEMO_MAX_STORED_BYTES) {
    throw new UserError(`このデモで置けるファイルの中身の量を超えます（小さめのファイルなら置けます）。${restart}`);
  }
}
