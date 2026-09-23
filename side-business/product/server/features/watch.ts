import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { loadWatchContext, todayJst } from "~/server/features/watch/context";
import { evaluateRules } from "~/server/features/watch/rules";
import type { WatchIssue } from "~/server/features/watch-types";

export type { WatchIssue } from "~/server/features/watch-types";

export type WatchOptions = {
  /** 今日（日本時間の YYYY-MM-DD）。テストで日付を決めるときに渡す */
  today?: string;
};

/** 確認済みの記録のキー */
export function ackKey(code: string, subjectId: string): string {
  return `${code}\u0000${subjectId}`;
}

export type WatchMonth = {
  issues: WatchIssue[];
  closed: boolean;
  /** この月に明細の対象になる人（稼働か調整がある人）の数 */
  drivers: number;
  /** この月に稼働があるか */
  hasWork: boolean;
};

/** 見張り番の結果と、画面の案内に使うその月の様子 */
export async function watchMonth(db: Db, tenantId: string, month: string, options: WatchOptions = {}): Promise<WatchMonth> {
  const ctx = await loadWatchContext(db, tenantId, month, options.today ?? todayJst());
  const drafts = evaluateRules(ctx);
  const acks = await db
    .select({ code: s.watchAcks.code, subjectId: s.watchAcks.subjectId, note: s.watchAcks.note })
    .from(s.watchAcks)
    .where(and(eq(s.watchAcks.tenantId, tenantId), eq(s.watchAcks.month, month)));
  const noteBy = new Map(acks.map((a) => [ackKey(a.code, a.subjectId), a.note]));
  const issues = drafts.map((i) => {
    const key = ackKey(i.code, i.subjectId);
    const acked = noteBy.has(key);
    return { ...i, acked, ackNote: acked ? noteBy.get(key) ?? null : null, blocksClose: i.severity === "red" && !acked };
  });
  return { issues, closed: ctx.closed, drivers: ctx.drafts.length, hasWork: ctx.drafts.some((d) => d.hasWork) };
}

/**
 * 締め前の見張り番。その会社・その月の記録を見て、指摘の一覧を返す（重い順：赤 → 黄 → お知らせ）。
 * 確認済み（watch_acks）の印とメモを付け、確認済みの赤は締めを止めない。
 * 締めた月も同じように読める（見るだけ）。
 * （この関数の形は変えない。締め・ホーム・利益の画面がここを呼ぶ）
 */
export async function runWatch(db: Db, tenantId: string, month: string, options: WatchOptions = {}): Promise<WatchIssue[]> {
  return (await watchMonth(db, tenantId, month, options)).issues;
}
