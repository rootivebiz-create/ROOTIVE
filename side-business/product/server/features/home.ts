import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { buildStatementDrafts, payDateFor, profitOf, type StatementDraft } from "~/server/calc/statement";
import { loadOnboarding } from "~/server/features/onboarding";
import { deemedDaysOf, statementStatus } from "~/server/features/statements/status";
import { loadTransferPlan } from "~/server/features/transfer";
import { runWatch as defaultRunWatch } from "~/server/features/watch";
import type { WatchIssue } from "~/server/features/watch-types";
import { getTenant, loadBuildInput } from "~/server/repo";
import { readSnapshot, snapshotHash } from "~/server/statements-core";
import type { HomeStatus } from "~/server/features/home/types";

export type { HomeStatus } from "~/server/features/home/types";
export * from "~/server/features/home/steps";

/**
 * ホーム（今月の締め）の状態を 1 回で集める。どの数も、その会社・その月だけを読む。
 * 開いている月は「今の稼働から作ると」の見込み、締めた月は保存した明細の写しを使う。
 */

export type HomeDeps = {
  /** 見張り番（テストでは差し替える） */
  runWatch?: (db: Db, tenantId: string, month: string) => Promise<WatchIssue[]>;
  now?: Date;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export async function loadHomeStatus(db: Db, tenantId: string, month: string, deps: HomeDeps = {}): Promise<HomeStatus> {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
  const tenant = await getTenant(db, tenantId);
  const runWatch = deps.runWatch ?? defaultRunWatch;
  const now = deps.now ?? new Date();

  const [closeRows, workRows, [adjCount], batches, saved, plan, notices, onboarding] = await Promise.all([
    db
      .select()
      .from(s.monthCloses)
      .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, month)))
      .limit(1),
    db
      .select({ driverId: s.workEntries.driverId })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month))),
    db
      .select({ n: count() })
      .from(s.adjustments)
      .where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, month))),
    db
      .select({
        id: s.importBatches.id,
        fileName: s.importBatches.fileName,
        createdAt: s.importBatches.createdAt,
        status: s.importBatches.status,
        rowCount: s.importBatches.rowCount,
        kind: s.importBatches.kind,
      })
      .from(s.importBatches)
      .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.month, month)))
      .orderBy(desc(s.importBatches.createdAt)),
    db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
    loadTransferPlan(db, tenantId, month),
    db
      .select({ id: s.paymentNotices.id })
      .from(s.paymentNotices)
      .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.month, month))),
    loadOnboarding(db, tenantId),
  ]);
  const mc = closeRows[0];
  const closed = mc?.status === "closed";
  let closedByName: string | null = null;
  if (mc?.closedBy) {
    const [u] = await db
      .select({ name: s.users.name })
      .from(s.users)
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, mc.closedBy)))
      .limit(1);
    closedByName = u?.name ?? null;
  }

  // ① 取り込み（稼働表の取り込みだけ。取り消したものは数えない）
  const workBatches = batches.filter((b) => b.kind === "work" && b.status !== "discarded");
  const latest = workBatches.find((b) => b.status === "applied") ?? workBatches[0] ?? null;
  const openDrafts = workBatches.filter((b) => b.status === "draft").map((b) => ({ id: b.id, fileName: b.fileName }));

  // ② 見張り番
  let watch: HomeStatus["watch"];
  try {
    const issues = await runWatch(db, tenantId, month);
    const red = issues.filter((i) => i.severity === "red" && !i.acked);
    watch = {
      red: red.length,
      redAcked: issues.filter((i) => i.severity === "red" && i.acked).length,
      yellow: issues.filter((i) => i.severity === "yellow" && !i.acked).length,
      error: null,
      topRed: red.slice(0, 3).map((i) => ({ title: i.title, subjectLabel: i.subjectLabel, href: i.fixHref ?? null })),
    };
  } catch (error) {
    console.error("watch failed", error instanceof Error ? error.message : error);
    watch = { red: 0, redAcked: 0, yellow: 0, error: "見張り番を動かせませんでした。時間をおいて開き直してください。", topRed: [] };
  }

  // ③ 明細：開いている月（と、明細を保存せずに締めた月）は、今の稼働から作った見込みと比べる
  const needDrafts = !closed || saved.length === 0;
  const drafts: StatementDraft[] = needDrafts ? buildStatementDrafts(await loadBuildInput(db, tenantId, month)) : [];
  const savedBy = new Map(saved.map((r) => [r.driverId, r]));
  let missing = 0;
  let stale = 0;
  let orphan = 0;
  if (!closed) {
    for (const d of drafts) {
      const r = savedBy.get(d.driverId);
      if (!r) missing++;
      else if (r.hash !== snapshotHash(d)) stale++;
    }
    const expectedIds = new Set(drafts.map((d) => d.driverId));
    orphan = saved.filter((r) => !expectedIds.has(r.driverId)).length;
  }

  const ids = saved.map((r) => r.id);
  const [confs, msgs] = ids.length
    ? await Promise.all([
        db
          .select({ statementId: s.statementConfirmations.statementId, version: s.statementConfirmations.version, createdAt: s.statementConfirmations.createdAt })
          .from(s.statementConfirmations)
          .where(and(eq(s.statementConfirmations.tenantId, tenantId), inArray(s.statementConfirmations.statementId, ids))),
        db
          .select({
            statementId: s.statementMessages.statementId,
            body: s.statementMessages.body,
            createdAt: s.statementMessages.createdAt,
            resolvedAt: s.statementMessages.resolvedAt,
            readAt: s.statementMessages.readAt,
          })
          .from(s.statementMessages)
          .where(and(eq(s.statementMessages.tenantId, tenantId), inArray(s.statementMessages.statementId, ids), eq(s.statementMessages.author, "driver"))),
      ])
    : [[], []];
  const deemedDays = deemedDaysOf(tenant.settings);
  const statuses = saved.map((r) =>
    statementStatus(
      {
        version: r.version,
        sentAt: r.sentAt,
        viewedAt: r.viewedAt,
        updatedAt: r.updatedAt,
        confirmations: confs.filter((c) => c.statementId === r.id),
        driverMessages: msgs.filter((x) => x.statementId === r.id),
      },
      now,
      deemedDays,
    ),
  );
  const countKey = (k: string) => statuses.filter((x) => x.key === k).length;

  // 未解決の質問（新しい順に 3 件）
  const nameByStatement = new Map(saved.map((r) => [r.id, readSnapshot(r).driver?.name ?? "（名前なし）"]));
  const openMsgs = msgs.filter((x) => !x.resolvedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // ④ 振込：振込データの画面と同じ判定（作ったあとに明細が変わったか・まだ入っていない人・口座の無い人）
  const transfers = plan.batches;
  const notInBatch = plan.included.filter((r) => r.inBatches.length === 0);

  // 突合：まだ解決していない差（open・asked）
  const noticeIds = notices.map((n) => n.id);
  const items = noticeIds.length
    ? await db
        .select({ diff: s.reconciliationItems.diff, status: s.reconciliationItems.status })
        .from(s.reconciliationItems)
        .where(and(eq(s.reconciliationItems.tenantId, tenantId), inArray(s.reconciliationItems.noticeId, noticeIds)))
    : [];
  const openItems = items.filter((i) => i.status === "open" || i.status === "asked");

  // 金額（締めた月は保存した写し、開いている月は今の計算）
  const useSaved = closed && saved.length > 0;
  const money = useSaved ? saved.map((r) => readSnapshot(r)) : drafts;

  return {
    month,
    closed,
    closedAt: mc?.closedAt ?? null,
    closedByName,
    payDate: payDateFor(month, tenant),
    work: {
      entries: workRows.length,
      drivers: new Set(workRows.map((r) => r.driverId)).size,
      adjustments: adjCount?.n ?? 0,
      latestBatch: latest ? { id: latest.id, fileName: latest.fileName, createdAt: latest.createdAt, status: latest.status, rowCount: latest.rowCount } : null,
      openDrafts,
    },
    watch,
    statements: {
      expected: closed ? saved.length : drafts.length,
      saved: saved.length,
      missing,
      stale,
      orphan,
      upToDate: closed ? saved.length > 0 : missing === 0 && stale === 0 && orphan === 0 && saved.length > 0,
      unsent: countKey("unsent"),
      needsResend: statuses.filter((x) => x.needsResend).length,
      sent: saved.length - countKey("unsent"),
      viewed: countKey("viewed"),
      confirmed: countKey("confirmed"),
      deemed: countKey("deemed"),
      changed: countKey("changed"),
      openQuestions: openMsgs.length,
    },
    transfer: {
      batches: transfers.length,
      people: transfers.reduce((a, b) => a + b.count, 0),
      total: transfers.reduce((a, b) => a + b.total, 0),
      executed: transfers.filter((b) => b.executedOn).length,
      changed: transfers.filter((b) => b.changed && !b.executedOn).length,
      changedExecuted: transfers.filter((b) => b.changed && b.executedOn).length,
      includable: plan.included.length,
      notInBatch: notInBatch.length,
      notInBatchTotal: notInBatch.reduce((a, r) => a + r.amount, 0),
      excluded: plan.excluded.map((r) => ({ name: r.driverName, reason: r.reason })),
      latestTransferDate: transfers[0]?.transferDate ?? null,
    },
    totals: { drivers: money.length, total: money.reduce((a, d) => a + d.total, 0), source: useSaved ? "saved" : "calc" },
    profit: {
      sales: money.reduce((a, d) => a + d.sales, 0),
      subtotal: money.reduce((a, d) => a + d.subtotal, 0),
      profit: money.reduce((a, d) => a + profitOf(d), 0),
      source: useSaved ? "snapshot" : "calc",
    },
    reconcile: {
      notices: notices.length,
      items: items.length,
      openItems: openItems.length,
      openDiff: openItems.reduce((a, i) => a + i.diff, 0),
      short: openItems.filter((i) => i.diff < 0).reduce((a, i) => a - i.diff, 0),
      over: openItems.filter((i) => i.diff > 0).reduce((a, i) => a + i.diff, 0),
    },
    questions: {
      count: openMsgs.length,
      items: openMsgs.slice(0, 3).map((x) => ({
        statementId: x.statementId,
        driverName: nameByStatement.get(x.statementId) ?? "（名前なし）",
        body: x.body.length > 80 ? `${x.body.slice(0, 80)}…` : x.body,
        createdAt: x.createdAt,
      })),
    },
    onboarding,
  };
}

/** 未読の質問の数（メニューなどで使える小さな問い合わせ） */
export async function unresolvedQuestionCount(db: Db, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(s.statementMessages)
    .where(and(eq(s.statementMessages.tenantId, tenantId), eq(s.statementMessages.author, "driver"), isNull(s.statementMessages.resolvedAt)));
  return row?.n ?? 0;
}
