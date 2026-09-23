import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { buildStatementDrafts, payDateFor, profitOf, type StatementDraft } from "~/server/calc/statement";
import { loadOnboarding } from "~/server/features/onboarding";
import { byKana, driverTermsFlags } from "~/server/features/onboarding/terms";
import { goLiveFrom } from "~/server/features/parallel/gate";
import { foundFromCells } from "~/server/features/profit";
import { futureBurden } from "~/server/features/profit/summary";
import { loadReport as defaultLoadReport, type Report } from "~/server/features/reconcile";
import { deemedDaysOf, statementStatus } from "~/server/features/statements/status";
import { deemedClauseMap } from "~/server/features/terms-content";
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
  /** 突合のまとめ（テストでは差し替える） */
  loadReport?: (db: Db, tenantId: string, from: string, to: string) => Promise<Pick<Report, "cells">>;
  now?: Date;
};

const RECONCILE_ERROR = "突合の結果を読めませんでした。元請との突合の画面で確かめてください。";

/**
 * 突合のセル（その月の支払通知のあるもの）から、ホームの「突合」と「見つけたお金」を出す（純関数）。
 * 突合の画面・利益の画面・社長の 1 枚と同じ数え方（差は今の記録で出し、状態は保存したもの）。見つけたお金は foundFromCells そのもの
 */
export function homeReconcileFromCells(cells: Pick<Report, "cells">["cells"], month: string): { reconcile: HomeStatus["reconcile"]; found: HomeStatus["found"] } {
  const own = cells.filter((c) => c.notice && c.month === month);
  const f = foundFromCells(own, month);
  const short = own.reduce((a, c) => a + c.short, 0);
  const over = own.reduce((a, c) => a + c.over, 0);
  return {
    reconcile: {
      notices: own.length,
      items: own.reduce((a, c) => a + c.items.length, 0),
      openItems: own.reduce((a, c) => a + c.open + c.asked, 0),
      openDiff: over - short,
      short,
      over,
      unread: own.filter((c) => c.notice!.lineCount === 0).length,
      error: null,
    },
    found: { confirmed: f.confirmed, confirmedCount: f.confirmedCount, estimated: f.estimated, estimatedCount: f.estimatedCount },
  };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export async function loadHomeStatus(db: Db, tenantId: string, month: string, deps: HomeDeps = {}): Promise<HomeStatus> {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
  const tenant = await getTenant(db, tenantId);
  const runWatch = deps.runWatch ?? defaultRunWatch;
  const now = deps.now ?? new Date();

  // 取引条件の明示の記録があるか（ホームで足す問い合わせはこれ 1 つ。最初の設定の案内も同じ結果を使う）
  const termsFlagsP = driverTermsFlags(db, tenantId);
  const [closeRows, workRows, [adjCount], batches, saved, plan, notices, onboarding, termsFlags] = await Promise.all([
    db
      .select()
      .from(s.monthCloses)
      .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, month)))
      .limit(1),
    db
      .select({ driverId: s.workEntries.driverId, qty: s.workEntries.qty })
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
    loadOnboarding(db, tenantId, { onboarding: tenant.onboarding, termsFlags: termsFlagsP }),
    termsFlagsP,
  ]);
  // 突合は重いので、支払通知がある月だけ、ほかの読み出し（見張り番・明細）と同時に始める（失敗してもホームは開く）
  const reportP =
    notices.length > 0
      ? (deps.loadReport ?? defaultLoadReport)(db, tenantId, month, month).then(
          (report) => ({ report, error: null }),
          (error: unknown) => ({ report: null, error }),
        )
      : null;
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
  // みなし確認は、取引条件にその条項がある人だけ（明細の画面と同じ判定）
  const clauses = await deemedClauseMap(db, tenantId, saved.map((r) => r.driverId));
  const statuses = saved.map((r) =>
    statementStatus(
      {
        version: r.version,
        sentAt: r.sentAt,
        viewedAt: r.viewedAt,
        updatedAt: r.updatedAt,
        confirmations: confs.filter((c) => c.statementId === r.id),
        driverMessages: msgs.filter((x) => x.statementId === r.id),
        deemedClause: clauses.get(r.driverId) === true,
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

  // 突合と見つけたお金：この月に支払通知があるときだけ、突合の画面と同じ読み方（loadReport）で数える。
  // まだ「突き合わせる」を押していなくても、突合の画面・利益の画面と同じ額になる。確定と見込みは足し合わせない
  let rec: { reconcile: HomeStatus["reconcile"]; found: HomeStatus["found"] } = {
    reconcile: { notices: 0, items: 0, openItems: 0, openDiff: 0, short: 0, over: 0, unread: 0, error: null },
    found: { confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0 },
  };
  if (reportP) {
    const { report, error } = await reportP;
    if (report) rec = homeReconcileFromCells(report.cells, month);
    else {
      console.error("home: reconcile failed", error instanceof Error ? error.message : error);
      rec = { ...rec, reconcile: { ...rec.reconcile, notices: notices.length, error: RECONCILE_ERROR } };
    }
  }

  // 金額（締めた月は保存した写し、開いている月は今の計算）
  const useSaved = closed && saved.length > 0;
  const money = useSaved ? saved.map((r) => readSnapshot(r)) : drafts;
  // 免税の方への支払で会社がかぶる消費税：今月は明細の額、次の段階は利益の画面と同じ目安の出し方
  const future = futureBurden(money, month, tenant.taxMethod);

  // 取引条件の明示：この月に稼働した人（数量が 1 以上）のうち、記録が見つからない人
  const workedIds = new Set(workRows.filter((r) => r.qty > 0).map((r) => r.driverId));
  const termsMissing = termsFlags
    .filter((d) => workedIds.has(d.id) && !d.hasTerms)
    .sort(byKana)
    .map((d) => ({ driverId: d.id, name: d.name }));

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
    reconcile: rec.reconcile,
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
    found: rec.found,
    burden: {
      affected: future.affected,
      people: future.people,
      current: money.reduce((a, d) => a + d.invoiceBurden, 0),
      next: future.next ? { from: future.next.from, label: future.next.label, monthly: future.next.monthly, diffMonthly: future.next.diffMonthly } : null,
    },
    terms: { worked: workedIds.size, missing: termsMissing },
    golive: goLiveFrom(tenant.onboarding),
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
