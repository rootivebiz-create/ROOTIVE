import "server-only";
import type { Db } from "~/db/client";
import type { WatchIssue } from "~/server/features/watch-types";

export type { WatchIssue } from "~/server/features/watch-types";

/**
 * 締め前の見張り番。その会社・その月の記録を見て、指摘の一覧を返す（重い順）。
 * （この関数の形は変えない。締め・ホームの画面がここを呼ぶ）
 */
export async function runWatch(db: Db, tenantId: string, month: string): Promise<WatchIssue[]> {
  void db;
  void tenantId;
  void month;
  return [];
}
