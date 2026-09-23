import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { unresolvedQuestionCount } from "~/server/features/home";
import { jpMonthLabel, jpShortDateTime, lineKeyLabel, toDriverView } from "~/server/features/statements/view";
import { readSnapshot } from "~/server/statements-core";

/**
 * 質問の一覧（会社の側）：すべての月の、まだ解決していないドライバーからの質問。
 * 明細 × 行（lineKey）ごとに 1 件にまとめ、新しい質問が上。どの関数も会社で絞る。
 */

/** 未解決の質問の数（ホーム・メニュー・明細の一覧で使う。数え方はホームと同じ関数） */
export { unresolvedQuestionCount };
export const unresolvedQuestions = unresolvedQuestionCount;

const EXCERPT_MAX = 80;

/** 「たった今」「5分前」「3時間前」「3日前」 */
export function ageText(from: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

/** 本文の頭だけ（改行は空白に。長ければ「…」） */
export function excerpt(body: string, max = EXCERPT_MAX): string {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** 明細の画面で、その行のやりとりの場所へ飛ぶための目印 */
export function threadAnchor(lineKey: string | null): string {
  return `thread-${lineKey ?? "all"}`;
}

export type InboxItem = {
  statementId: string;
  month: string;
  monthLabel: string;
  driverId: string;
  driverName: string;
  driverCode: string | null;
  lineKey: string | null;
  lineLabel: string;
  /** いちばん新しい、解決していない質問の頭 */
  excerpt: string;
  /** この行の、解決していない質問の数 */
  open: number;
  /** 事務がまだ読んでいない数 */
  unread: number;
  /** いちばん新しい質問の日時と「3日前」 */
  askedAt: Date;
  askedAtText: string;
  ageText: string;
  /** いちばん古い、解決していない質問から何日か（待たせている長さ） */
  waitingSince: Date;
  waitingText: string;
  /** いちばん新しい質問のあとに、会社が返事をしている */
  replied: boolean;
  href: string;
};

export type InboxFilter = "all" | "unreplied";

export type QuestionInbox = {
  items: InboxItem[];
  /** 解決していない質問の数（ホームの数と同じ数え方） */
  total: number;
  /** 質問のある人の数 */
  drivers: number;
  /** まだ返事をしていない行の数 */
  unreplied: number;
};

export function parseInboxFilter(value: string | string[] | undefined): InboxFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "unreplied" ? "unreplied" : "all";
}

export async function loadQuestionInbox(db: Db, tenantId: string, now = new Date()): Promise<QuestionInbox> {
  const open = await db
    .select({
      statementId: s.statementMessages.statementId,
      lineKey: s.statementMessages.lineKey,
      body: s.statementMessages.body,
      createdAt: s.statementMessages.createdAt,
      readAt: s.statementMessages.readAt,
    })
    .from(s.statementMessages)
    .where(and(eq(s.statementMessages.tenantId, tenantId), eq(s.statementMessages.author, "driver"), isNull(s.statementMessages.resolvedAt)));
  if (open.length === 0) return { items: [], total: 0, drivers: 0, unreplied: 0 };

  const ids = [...new Set(open.map((m) => m.statementId))];
  const [statements, replies] = await Promise.all([
    db
      .select()
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), inArray(s.statements.id, ids))),
    db
      .select({ statementId: s.statementMessages.statementId, lineKey: s.statementMessages.lineKey, createdAt: s.statementMessages.createdAt })
      .from(s.statementMessages)
      .where(and(eq(s.statementMessages.tenantId, tenantId), inArray(s.statementMessages.statementId, ids), eq(s.statementMessages.author, "staff"))),
  ]);
  const byId = new Map(statements.map((st) => [st.id, { st, view: toDriverView(readSnapshot(st), st) }]));
  const keyOf = (statementId: string, lineKey: string | null) => `${statementId}\u0000${lineKey ?? ""}`;
  const lastReply = new Map<string, number>();
  for (const r of replies) {
    const k = keyOf(r.statementId, r.lineKey);
    lastReply.set(k, Math.max(lastReply.get(k) ?? 0, r.createdAt.getTime()));
  }

  const groups = new Map<string, typeof open>();
  for (const m of open) {
    if (!byId.has(m.statementId)) continue;
    const k = keyOf(m.statementId, m.lineKey);
    const list = groups.get(k);
    if (list) list.push(m);
    else groups.set(k, [m]);
  }

  const items: InboxItem[] = [];
  for (const [k, msgs] of groups) {
    const sorted = [...msgs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const latest = sorted[sorted.length - 1];
    const oldest = sorted[0];
    const { st, view } = byId.get(latest.statementId)!;
    items.push({
      statementId: st.id,
      month: st.month,
      monthLabel: jpMonthLabel(st.month),
      driverId: st.driverId,
      driverName: view.driver.name,
      driverCode: view.driver.code,
      lineKey: latest.lineKey,
      lineLabel: lineKeyLabel(view, latest.lineKey),
      excerpt: excerpt(latest.body),
      open: sorted.length,
      unread: sorted.filter((m) => !m.readAt).length,
      askedAt: latest.createdAt,
      askedAtText: jpShortDateTime(latest.createdAt),
      ageText: ageText(latest.createdAt, now),
      waitingSince: oldest.createdAt,
      waitingText: ageText(oldest.createdAt, now),
      replied: (lastReply.get(k) ?? 0) >= latest.createdAt.getTime(),
      href: `/statements/${st.id}#${threadAnchor(latest.lineKey)}`,
    });
  }
  items.sort((a, b) => b.askedAt.getTime() - a.askedAt.getTime() || a.driverName.localeCompare(b.driverName, "ja"));

  return {
    items,
    total: items.reduce((n, i) => n + i.open, 0),
    drivers: new Set(items.map((i) => i.driverId)).size,
    unreplied: items.filter((i) => !i.replied).length,
  };
}
