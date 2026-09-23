import "server-only";
import { and, count, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { Role } from "~/server/auth";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { buildStatementDrafts } from "~/server/calc/statement";
import { listTransferBatches, lockTenant } from "~/server/features/transfer";
import { runWatch as defaultRunWatch } from "~/server/features/watch";
import type { WatchIssue } from "~/server/features/watch-types";
import { getTenant, isMonthClosed, loadBuildInput } from "~/server/repo";
import { generateStatements, statementsStatus, type GenerateResult } from "~/server/statements-core";

/**
 * 月の締め：締める前の確かめ（チェックリスト）・締める・締めを外す（オーナーだけ・理由つき）・この月の操作の記録。
 * 締めたあとは、稼働・調整・明細を DB の引き金が止める（MONTH_CLOSED）。
 */

export type CloseDeps = {
  /** 見張り番（テストでは差し替える） */
  runWatch?: (db: Db, tenantId: string, month: string) => Promise<WatchIssue[]>;
};

/** 締めるときの任意の入力 */
export type CloseOptions = {
  /** 締める人の役割（赤い指摘が残ったまま締められるのはオーナーだけ） */
  role?: Role;
  /** 赤い指摘が残ったまま締めるときの理由（オーナーだけ。10 文字以上。操作の記録に残す） */
  overrideReason?: string | null;
  /** この月の締めにかかった分数（任意） */
  minutesSpent?: number | null;
};

/** 赤い指摘が残ったまま締めるときの理由の最低の文字数 */
export const OVERRIDE_REASON_MIN = 10;
/** 締めにかかった分数の上限（入れ間違いを防ぐ。100 時間） */
export const MINUTES_MAX = 6000;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
}

/** 締めを止める指摘：赤で、まだ確認済みにしていないもの */
export function blockingIssues(issues: WatchIssue[]): WatchIssue[] {
  return issues.filter((i) => i.severity === "red" && !i.acked);
}

// ---------------------------------------------------------------- 締める前の確かめ

export type CloseChecklist = {
  month: string;
  closed: boolean;
  closedAt: Date | null;
  closedByName: string | null;
  reopenedAt: Date | null;
  /** 最後に締めを外したときの理由 */
  reopenReason: string | null;
  /** 締めにかかった分数（締めたときに入れたもの） */
  minutesSpent: number | null;
  /** 赤い指摘が残ったままオーナーが締めたときの理由（締めた月だけ） */
  override: { reason: string; byName: string | null; at: Date; issues: string[] } | null;
  /** 締められない理由が「見張り番の赤（未確認）」だけか（オーナーなら理由を書いて締められる） */
  overridable: boolean;
  /** ① 稼働 */
  work: { entries: number; drivers: number; adjustments: number };
  /** ② 明細（締めた月は見ない） */
  statements: { skipped: boolean; expected: number; saved: number; missing: number; stale: number; orphan: number; upToDate: boolean };
  /** ③ 見張り番 */
  watch: { blocking: WatchIssue[]; redAcked: number; yellow: number; error: string | null };
  /** ④ Excel との比べ合わせ（差があるもの） */
  parallel: { rows: number; diffs: { driverId: string; driverName: string; excelTotal: number; ourTotal: number; diff: number }[] };
  /**
   * ⑤ 振込データ。people・total は、どれかの振込データに入っている明細（同じ人は 1 回だけ数える）の今の振込額。
   * changed は作ったあとに明細が変わったもの、notIncluded は振込額が 1 円以上なのにどの振込データにも入っていない人。
   */
  transfer: { batches: number; people: number; total: number; executed: number; changed: number; notIncluded: number };
  /** ⑥ ドライバーの確認（今の版を確認した人） */
  confirm: { statements: number; confirmed: number; sent: number };
  /** 締めたときの明細（開いている月は今の稼働から作った見込み、締めた月は保存した明細） */
  totals: { drivers: number; subtotal: number; tax: number; total: number };
  /** 締められない理由（空なら締められる） */
  blockers: string[];
};

export async function loadCloseChecklist(db: Db, tenantId: string, month: string, deps: CloseDeps = {}): Promise<CloseChecklist> {
  assertMonth(month);
  await getTenant(db, tenantId);
  const runWatch = deps.runWatch ?? defaultRunWatch;

  const [closeRows, workRows, adjRows, saved, parallelRows, batches, users, drivers] = await Promise.all([
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
    db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
    db.select().from(s.parallelChecks).where(and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.month, month))),
    listTransferBatches(db, tenantId, month),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
    db.select({ id: s.drivers.id, name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
  ]);
  const mc = closeRows[0];
  const closed = mc?.status === "closed";
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const driverName = new Map(drivers.map((d) => [d.id, d.name]));

  // ② 明細：開いている月は「今の稼働から作ると」と比べる
  const drafts = closed ? [] : buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  let statements: CloseChecklist["statements"];
  if (closed) {
    statements = { skipped: true, expected: saved.length, saved: saved.length, missing: 0, stale: 0, orphan: 0, upToDate: true };
  } else {
    const st = await statementsStatus(db, tenantId, month);
    statements = {
      skipped: false,
      expected: st.expected,
      saved: st.saved,
      missing: st.missing.length,
      stale: st.stale.length,
      orphan: st.orphan.length,
      upToDate: st.upToDate,
    };
  }

  // 締めたときの金額
  const totals = closed
    ? {
        drivers: saved.length,
        subtotal: saved.reduce((a, r) => a + r.subtotal, 0),
        tax: saved.reduce((a, r) => a + r.tax, 0),
        total: saved.reduce((a, r) => a + r.total, 0),
      }
    : {
        drivers: drafts.length,
        subtotal: drafts.reduce((a, d) => a + d.subtotal, 0),
        tax: drafts.reduce((a, d) => a + d.tax, 0),
        total: drafts.reduce((a, d) => a + d.total, 0),
      };

  // ③ 見張り番
  let watch: CloseChecklist["watch"];
  try {
    const issues = await runWatch(db, tenantId, month);
    watch = {
      blocking: blockingIssues(issues),
      redAcked: issues.filter((i) => i.severity === "red" && i.acked).length,
      yellow: issues.filter((i) => i.severity === "yellow" && !i.acked).length,
      error: null,
    };
  } catch (error) {
    console.error("watch failed", error instanceof Error ? error.message : error);
    watch = { blocking: [], redAcked: 0, yellow: 0, error: "見張り番を動かせませんでした。時間をおいて開き直してください。" };
  }

  // ④ Excel との比べ合わせ：開いている月は締めたときの見込み、締めた月は保存した明細と比べる
  const ourTotal = new Map<string, number>(closed ? saved.map((r) => [r.driverId, r.total]) : drafts.map((d) => [d.driverId, d.total]));
  const diffs = parallelRows
    .map((p) => {
      const ours = ourTotal.get(p.driverId) ?? 0;
      return { driverId: p.driverId, driverName: driverName.get(p.driverId) ?? "（不明）", excelTotal: p.excelTotal, ourTotal: ours, diff: ours - p.excelTotal };
    })
    .filter((d) => d.diff !== 0)
    .sort((a, b) => a.driverName.localeCompare(b.driverName, "ja"));

  // ⑥ 今の版を確認した明細の数
  let confirmed = 0;
  if (saved.length) {
    const conf = await db
      .select({ statementId: s.statementConfirmations.statementId, version: s.statementConfirmations.version })
      .from(s.statementConfirmations)
      .where(
        and(
          eq(s.statementConfirmations.tenantId, tenantId),
          inArray(
            s.statementConfirmations.statementId,
            saved.map((r) => r.id),
          ),
        ),
      );
    const versionById = new Map(saved.map((r) => [r.id, r.version]));
    confirmed = new Set(conf.filter((c) => versionById.get(c.statementId) === c.version).map((c) => c.statementId)).size;
  }

  // ⑤ 振込データ：人で数える（同じ人を二重に数えない。明細が作り直されて id が変わっていても入っていると分かる）
  const inAnyBatch = new Set(batches.flatMap((b) => b.driverIds));
  const covered = saved.filter((r) => inAnyBatch.has(r.driverId));

  const blockers: string[] = [];
  let hardBlockers = 0;
  if (closed) {
    blockers.push("この月はすでに締めてあります");
    hardBlockers++;
  } else {
    if (drafts.length === 0) {
      blockers.push("この月は稼働も調整もありません。取り込みか稼働の入力をしてから締めてください");
      hardBlockers++;
    }
    if (watch.error) {
      blockers.push(watch.error);
      hardBlockers++;
    }
    if (watch.blocking.length) blockers.push(`見張り番の赤い指摘が ${watch.blocking.length} 件あります。直すか、内容を確かめて「確認済み」にしてください`);
  }

  // 赤い指摘が残ったまま締めたときの理由（最後に締めたときの記録から）
  let override: CloseChecklist["override"] = null;
  if (closed) {
    const [last] = await db
      .select({ userId: s.auditLog.userId, detail: s.auditLog.detail, createdAt: s.auditLog.createdAt })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "month.close"), eq(s.auditLog.entityId, month)))
      .orderBy(desc(s.auditLog.id))
      .limit(1);
    const o = last?.detail?.override as { reason?: unknown; issues?: unknown } | undefined;
    if (o && typeof o.reason === "string") {
      override = {
        reason: o.reason,
        byName: last.userId ? userName.get(last.userId) ?? null : null,
        at: last.createdAt,
        issues: Array.isArray(o.issues) ? o.issues.map((i) => (i && typeof i === "object" && typeof (i as { title?: unknown }).title === "string" ? String((i as { title: string }).title) : "")).filter(Boolean) : [],
      };
    }
  }

  return {
    month,
    closed,
    closedAt: mc?.closedAt ?? null,
    closedByName: mc?.closedBy ? userName.get(mc.closedBy) ?? null : null,
    reopenedAt: mc?.reopenedAt ?? null,
    reopenReason: mc?.reopenReason ?? null,
    minutesSpent: mc?.minutesSpent ?? null,
    override,
    overridable: !closed && hardBlockers === 0 && watch.blocking.length > 0,
    work: { entries: workRows.length, drivers: new Set(workRows.map((w) => w.driverId)).size, adjustments: adjRows[0]?.n ?? 0 },
    statements,
    watch,
    parallel: { rows: parallelRows.length, diffs },
    transfer: {
      batches: batches.length,
      people: covered.length,
      total: covered.reduce((a, r) => a + r.total, 0),
      executed: batches.filter((b) => b.executedOn).length,
      changed: batches.filter((b) => b.changed).length,
      notIncluded: batches.length ? saved.filter((r) => r.total > 0 && !inAnyBatch.has(r.driverId)).length : 0,
    },
    confirm: { statements: saved.length, confirmed, sent: saved.filter((r) => r.sentAt).length },
    totals,
    blockers,
  };
}

// ---------------------------------------------------------------- 締める

export type CloseResult = {
  generated: GenerateResult;
  drivers: number;
  subtotal: number;
  tax: number;
  deductions: number;
  withholding: number;
  total: number;
};

/**
 * 月を締める。順序：締め済みなら断る → 見張り番の赤（未確認）があれば断る → 明細を最新にする →
 * 明細が今の稼働と同じか確かめる → 締める。明細の作り直しと締めは 1 つのトランザクションで行う。
 */
export async function closeMonth(
  db: Db,
  tenantId: string,
  month: string,
  userId: string | null,
  deps: CloseDeps & CloseOptions = {},
): Promise<CloseResult> {
  assertMonth(month);
  await getTenant(db, tenantId);
  const minutes = normalizeMinutes(deps.minutesSpent);
  const reason = (deps.overrideReason ?? "").trim();
  if (reason.length > 500) throw new UserError("理由は 500 文字までにしてください");
  if (await isMonthClosed(db, tenantId, month)) throw new UserError("この月はすでに締めてあります");

  const runWatch = deps.runWatch ?? defaultRunWatch;
  let issues: WatchIssue[];
  try {
    issues = await runWatch(db, tenantId, month);
  } catch (error) {
    console.error("watch failed", error instanceof Error ? error.message : error);
    throw new UserError("見張り番を確かめられなかったため、締めていません。時間をおいてもう一度お試しください。");
  }
  const blocking = blockingIssues(issues);
  if (blocking.length) {
    const list = blocking
      .slice(0, 5)
      .map((i) => `・${i.title}${i.subjectLabel ? `（${i.subjectLabel}）` : ""}`)
      .join("\n");
    const more = blocking.length > 5 ? `\nほか ${blocking.length - 5} 件` : "";
    // オーナーだけは、理由を書けば赤が残ったまま締められる（理由は操作の記録に残る）
    if (deps.role !== "owner") {
      throw new UserError(
        `見張り番の赤い指摘が ${blocking.length} 件あるため、締めていません。直すか、内容を確かめて「確認済み」にしてから締めてください（オーナーは、理由を書いて締めることもできます）。\n${list}${more}`,
      );
    }
    if (reason.length < OVERRIDE_REASON_MIN) {
      throw new UserError(
        `見張り番の赤い指摘が ${blocking.length} 件残っています。このまま締めるときは、理由を ${OVERRIDE_REASON_MIN} 文字以上で書いてください（操作の記録に残ります）。\n${list}${more}`,
      );
    }
  }

  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  if (drafts.length === 0) throw new UserError("この月は稼働も調整もありません。取り込みか稼働の入力をしてから締めてください。");

  const result = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // 同じ会社の「締める」「振込データを作る」を 1 つずつにする（2 回押されても二重に締めない）
    await lockTenant(t, tenantId);
    if (await isMonthClosed(t, tenantId, month)) throw new UserError("この月はすでに締めてあります");
    const generated = await generateStatements(t, tenantId, month, userId);
    // 作り直しのあいだに稼働が変わっていないか
    const st = await statementsStatus(t, tenantId, month);
    if (!st.upToDate) throw new UserError("締めている途中で稼働や設定が変わりました。もう一度「締める」を押してください。");

    const rows = await t
      .select()
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
    const now = new Date();
    // 分数は入れたときだけ書く（入れずに締め直したときは、前の値を残す）
    await t
      .insert(s.monthCloses)
      .values({ tenantId, month, status: "closed", closedAt: now, closedBy: userId, minutesSpent: minutes })
      .onConflictDoUpdate({
        target: [s.monthCloses.tenantId, s.monthCloses.month],
        set: minutes === null ? { status: "closed", closedAt: now, closedBy: userId } : { status: "closed", closedAt: now, closedBy: userId, minutesSpent: minutes },
      });
    const sum = (k: "subtotal" | "tax" | "deductions" | "withholding" | "total") => rows.reduce((a, r) => a + r[k], 0);
    const out: CloseResult = {
      generated,
      drivers: rows.length,
      subtotal: sum("subtotal"),
      tax: sum("tax"),
      deductions: sum("deductions"),
      withholding: sum("withholding"),
      total: sum("total"),
    };
    await audit(t, {
      tenantId,
      userId,
      action: "month.close",
      entity: "month",
      entityId: month,
      detail: {
        month,
        drivers: out.drivers,
        subtotal: out.subtotal,
        tax: out.tax,
        deductions: out.deductions,
        withholding: out.withholding,
        total: out.total,
        acked: issues.filter((i) => i.severity === "red" && i.acked).map((i) => ({ code: i.code, subjectId: i.subjectId })),
        statements: rows.map((r) => ({ id: r.id, driverId: r.driverId, version: r.version, hash: r.hash, total: r.total })),
        minutesSpent: minutes,
        // 赤が残ったまま締めた（オーナーだけ）：理由と、そのときの指摘
        ...(blocking.length
          ? {
              override: {
                reason,
                issues: blocking.map((i) => ({ code: i.code, subjectId: i.subjectId, title: i.title, subject: i.subjectLabel ?? null })),
              },
            }
          : {}),
      },
    });
    return out;
  });
  return result;
}

/** 締めにかかった分数（空なら null。1〜6000 の整数だけ） */
export function normalizeMinutes(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize("NFKC").trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) throw new UserError("締めにかかった時間は、分の数（例：90）で入れてください");
  const n = Number(text);
  if (n < 1 || n > MINUTES_MAX) throw new UserError(`締めにかかった時間は 1〜${MINUTES_MAX} 分で入れてください`);
  return n;
}

// ---------------------------------------------------------------- 締めを外す

export const REOPEN_REASON_MIN = 5;

export async function reopenMonth(
  db: Db,
  tenantId: string,
  month: string,
  user: { id: string | null; role: Role },
  reason: string,
): Promise<void> {
  assertMonth(month);
  if (user.role !== "owner") throw new UserError("締めを外せるのはオーナーだけです");
  const why = reason.trim();
  if (why.length < REOPEN_REASON_MIN) throw new UserError(`締めを外す理由を ${REOPEN_REASON_MIN} 文字以上で書いてください（操作の記録に残ります）`);
  if (why.length > 500) throw new UserError("理由は 500 文字までにしてください");

  const rows = await db
    .select()
    .from(s.monthCloses)
    .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, month)))
    .limit(1);
  const mc = rows[0];
  if (mc?.status !== "closed") throw new UserError("この月は締めていません");

  const statements = await db
    .select({ id: s.statements.id, total: s.statements.total, version: s.statements.version })
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
  const confirmations = statements.length
    ? await db
        .select({ n: count() })
        .from(s.statementConfirmations)
        .where(
          and(
            eq(s.statementConfirmations.tenantId, tenantId),
            inArray(
              s.statementConfirmations.statementId,
              statements.map((r) => r.id),
            ),
          ),
        )
    : [{ n: 0 }];
  const executed = await db
    .select({ n: count() })
    .from(s.transferBatches)
    .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, month), isNotNull(s.transferBatches.executedOn)));

  const now = new Date();
  // 締めてある行だけを外す（同時に 2 回押されても、記録は 1 回だけ）
  const updated = await db
    .update(s.monthCloses)
    .set({ status: "open", reopenedAt: now, reopenReason: why })
    .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, month), eq(s.monthCloses.status, "closed")))
    .returning({ month: s.monthCloses.month });
  if (updated.length === 0) throw new UserError("この月は締めていません（ほかの人がすでに外したかもしれません。画面を開き直してください）");
  await audit(db, {
    tenantId,
    userId: user.id,
    action: "month.reopen",
    entity: "month",
    entityId: month,
    detail: {
      month,
      reason: why,
      closedAt: mc.closedAt?.toISOString() ?? null,
      drivers: statements.length,
      total: statements.reduce((a, r) => a + r.total, 0),
      confirmations: confirmations[0]?.n ?? 0,
      executedTransfers: executed[0]?.n ?? 0,
    },
  });
}

// ---------------------------------------------------------------- この月の操作の記録

export type AuditRow = {
  id: number;
  at: Date;
  /** した人（利用者の名前・「ドライバー」。どちらでもなければ null＝自動） */
  userName: string | null;
  /** した人を 1 行で（「デモ 事務さん」「青木 翔太さん（ドライバー）」「自動」） */
  actor: string;
  action: string;
  label: string;
  summary: string | null;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown>;
};

/** 記録の範囲：month＝この月の締めに関わる操作／period＝この月（日本時間の暦の月）に行った操作すべて */
export type AuditScope = "month" | "period";

/** 種類の絞り込み（操作の名前の頭で分ける） */
export const AUDIT_CATEGORIES: { key: string; label: string; prefixes: string[] }[] = [
  { key: "import", label: "取り込み", prefixes: ["import."] },
  { key: "work", label: "稼働と調整", prefixes: ["work.", "adjustment."] },
  { key: "statement", label: "明細とドライバーの確認", prefixes: ["statement.", "portal."] },
  { key: "terms", label: "取引条件の明示", prefixes: ["terms."] },
  { key: "watch", label: "見張り番", prefixes: ["watch."] },
  { key: "transfer", label: "振込データ", prefixes: ["transfer."] },
  { key: "month", label: "締めと解除", prefixes: ["month."] },
  { key: "reconcile", label: "元請との突合", prefixes: ["reconcile.", "notice."] },
  { key: "parallel", label: "Excel との比べ合わせ", prefixes: ["parallel."] },
  {
    key: "settings",
    label: "設定・利用者",
    prefixes: [
      "settings.",
      "driver.",
      "client.",
      "project.",
      "rate_override.",
      "deduction_rule.",
      "rule.",
      "accounting.",
      "onboarding.",
      "user.",
      "invite.",
      "setup",
      "login",
    ],
  },
  { key: "export", label: "出力・書き出し", prefixes: ["export.", "data.", "profit."] },
];

export function auditCategoryOf(action: string): string {
  return AUDIT_CATEGORIES.find((c) => c.prefixes.some((p) => action.startsWith(p)))?.key ?? "other";
}

export function auditCategoryLabel(key: string): string {
  return AUDIT_CATEGORIES.find((c) => c.key === key)?.label ?? "その他";
}

/** 「した人」の絞り込みの値：user:<id>・driver（ドライバー）・system（自動） */
export type AuditWho = string;

export type AuditQuery = {
  month: string;
  scope?: AuditScope;
  /** 種類（AUDIT_CATEGORIES の key・other） */
  kind?: string | null;
  who?: AuditWho | null;
  page?: number;
  pageSize?: number;
};

export type AuditSearchResult = {
  rows: AuditRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  /** 絞り込みの候補（今の範囲の中の件数つき） */
  kinds: { key: string; label: string; count: number }[];
  people: { key: string; label: string; count: number }[];
};

const LIKE_ESCAPE = /[\\%_]/g;

/** 範囲の条件（会社で必ず絞る） */
function scopeWhere(tenantId: string, month: string, scope: AuditScope) {
  if (scope === "period") {
    // 日本時間のその月の 1 日 0 時から、翌月の 1 日 0 時まで
    const [y, m] = month.slice(0, 7).split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600_000);
    const to = new Date(Date.UTC(y, m, 1) - 9 * 3600_000);
    return and(eq(s.auditLog.tenantId, tenantId), sql`"audit_log"."created_at" >= ${from.toISOString()}::timestamptz`, sql`"audit_log"."created_at" < ${to.toISOString()}::timestamptz`);
  }
  // この月のもの：月そのもの・中身に月がある・この月の取り込み／明細（消えたものも版から）／支払通知／振込データ
  return and(
    eq(s.auditLog.tenantId, tenantId),
    sql`(
      "audit_log"."entity_id" = ${month}
      or "audit_log"."detail"->>'month' = ${month}
      or ("audit_log"."entity" = 'import_batch' and "audit_log"."entity_id" in (select ib."id"::text from "import_batches" ib where ib."tenant_id" = ${tenantId} and ib."month" = ${month}))
      or ("audit_log"."detail" ? 'batchId' and "audit_log"."detail"->>'batchId' in (select ib."id"::text from "import_batches" ib where ib."tenant_id" = ${tenantId} and ib."month" = ${month}))
      or ("audit_log"."entity" = 'statement' and "audit_log"."entity_id" in (
        select sv."statement_id"::text from "statement_versions" sv where sv."tenant_id" = ${tenantId} and sv."month" = ${month}
        union select st."id"::text from "statements" st where st."tenant_id" = ${tenantId} and st."month" = ${month}
      ))
      or ("audit_log"."entity" = 'payment_notice' and "audit_log"."entity_id" in (select pn."id"::text from "payment_notices" pn where pn."tenant_id" = ${tenantId} and pn."month" = ${month}))
      or ("audit_log"."entity" = 'transfer_batch' and "audit_log"."entity_id" in (select tb."id"::text from "transfer_batches" tb where tb."tenant_id" = ${tenantId} and tb."month" = ${month}))
    )`,
  );
}

function kindWhere(kind: string | null | undefined) {
  if (!kind) return undefined;
  const likeOf = (p: string) => `${p.replace(LIKE_ESCAPE, (c) => `\\${c}`)}%`;
  if (kind === "other") {
    const all = AUDIT_CATEGORIES.flatMap((c) => c.prefixes);
    return and(...all.map((p) => sql`"audit_log"."action" not like ${likeOf(p)}`));
  }
  const cat = AUDIT_CATEGORIES.find((c) => c.key === kind);
  if (!cat) return sql`false`;
  return or(...cat.prefixes.map((p) => sql`"audit_log"."action" like ${likeOf(p)}`));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whoWhere(who: string | null | undefined) {
  if (!who) return undefined;
  if (who === "driver") return and(sql`"audit_log"."user_id" is null`, sql`"audit_log"."detail"->>'by' = 'driver'`);
  if (who === "system") return and(sql`"audit_log"."user_id" is null`, sql`coalesce("audit_log"."detail"->>'by', '') <> 'driver'`);
  const id = who.startsWith("user:") ? who.slice(5) : "";
  if (!UUID_RE.test(id)) return sql`false`;
  return eq(s.auditLog.userId, id);
}

/** 会社の利用者とドライバーの名前（記録の「した人」に使う） */
async function actorNames(db: Db, tenantId: string) {
  const [users, drivers] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
    db.select({ id: s.drivers.id, name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
  ]);
  return { userName: new Map(users.map((u) => [u.id, u.name])), driverName: new Map(drivers.map((d) => [d.id, d.name])) };
}

function toAuditRow(r: typeof s.auditLog.$inferSelect, names: Awaited<ReturnType<typeof actorNames>>): AuditRow {
  const detail = r.detail ?? {};
  const byDriver = !r.userId && detail.by === "driver";
  const userName = r.userId ? names.userName.get(r.userId) ?? null : byDriver ? "ドライバー" : null;
  const driverName = typeof detail.driverId === "string" ? names.driverName.get(detail.driverId) : undefined;
  const actor = r.userId
    ? userName
      ? `${userName}さん`
      : "（消えた利用者）"
    : byDriver
      ? driverName
        ? `${driverName}さん（ドライバー）`
        : "ドライバー"
      : "自動";
  return {
    id: r.id,
    at: r.createdAt,
    userName,
    actor,
    action: r.action,
    label: auditLabel(r.action),
    summary: auditSummary(r.action, detail),
    entity: r.entity,
    entityId: r.entityId,
    detail,
  };
}

/** この月の操作の記録（新しい順・締めの画面の一覧） */
export async function monthAuditLog(db: Db, tenantId: string, month: string, limit = 50): Promise<AuditRow[]> {
  assertMonth(month);
  const [rows, names] = await Promise.all([
    db
      .select()
      .from(s.auditLog)
      .where(scopeWhere(tenantId, month, "month"))
      .orderBy(desc(s.auditLog.id))
      .limit(limit),
    actorNames(db, tenantId),
  ]);
  return rows.map((r) => toAuditRow(r, names));
}

/** 操作の記録を探す（範囲・種類・した人で絞る。新しい順にページで区切る） */
export async function searchAuditLog(db: Db, tenantId: string, q: AuditQuery): Promise<AuditSearchResult> {
  assertMonth(q.month);
  const scope: AuditScope = q.scope === "period" ? "period" : "month";
  const pageSize = Math.min(500, Math.max(1, Math.floor(q.pageSize ?? 50)));
  const base = scopeWhere(tenantId, q.month, scope);
  const where = and(base, kindWhere(q.kind), whoWhere(q.who));

  const byPerson = sql<string>`case when "audit_log"."user_id" is not null then 'user:' || "audit_log"."user_id"::text when "audit_log"."detail"->>'by' = 'driver' then 'driver' else 'system' end`;
  const [[{ n: total }], actionCounts, personCounts, names] = await Promise.all([
    db.select({ n: count() }).from(s.auditLog).where(where),
    db.select({ action: s.auditLog.action, n: count() }).from(s.auditLog).where(base).groupBy(s.auditLog.action),
    db.select({ key: byPerson, n: count() }).from(s.auditLog).where(base).groupBy(byPerson),
    actorNames(db, tenantId),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(q.page ?? 1)));
  const rows = await db
    .select()
    .from(s.auditLog)
    .where(where)
    .orderBy(desc(s.auditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const kindCount = new Map<string, number>();
  for (const a of actionCounts) kindCount.set(auditCategoryOf(a.action), (kindCount.get(auditCategoryOf(a.action)) ?? 0) + a.n);
  const kinds = [...AUDIT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })), { key: "other", label: "その他" }]
    .map((c) => ({ ...c, count: kindCount.get(c.key) ?? 0 }))
    .filter((c) => c.count > 0 || c.key === q.kind);
  const people = personCounts
    .map((p) => ({
      key: p.key,
      label:
        p.key === "driver"
          ? "ドライバー"
          : p.key === "system"
            ? "自動（しくみ）"
            : `${names.userName.get(p.key.slice(5)) ?? "（消えた利用者）"}さん`,
      count: p.n,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
  return { rows: rows.map((r) => toAuditRow(r, names)), total, page, pages, pageSize, kinds, people };
}

/** 操作の記録の CSV（絞り込みはそのまま。ページで区切らない） */
export async function auditCsvRows(db: Db, tenantId: string, q: Omit<AuditQuery, "page" | "pageSize">): Promise<(string | number)[][]> {
  assertMonth(q.month);
  const scope: AuditScope = q.scope === "period" ? "period" : "month";
  const [rows, names] = await Promise.all([
    db
      .select()
      .from(s.auditLog)
      .where(and(scopeWhere(tenantId, q.month, scope), kindWhere(q.kind), whoWhere(q.who)))
      .orderBy(desc(s.auditLog.id)),
    actorNames(db, tenantId),
  ]);
  const all = rows.map((r) => toAuditRow(r, names));
  const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return [
    ["番号", "日時（日本時間）", "した人", "操作", "内容", "種類", "操作の名前", "対象", "対象の id", "記録の中身（JSON）"],
    ...all.map((r) => [
      r.id,
      jst.format(r.at),
      r.actor,
      r.label,
      r.summary ?? "",
      auditCategoryLabel(auditCategoryOf(r.action)),
      r.action,
      r.entity,
      r.entityId ?? "",
      JSON.stringify(r.detail),
    ]),
  ];
}

const ACTION_LABELS: Record<string, string> = {
  "month.close": "月を締めた",
  "month.reopen": "締めを外した",
  "statement.generate": "明細を作った・作り直した",
  "statement.remove": "明細を消した（稼働が無くなったため）",
  "statement.send": "明細をドライバーへ送った",
  "statement.sent": "明細をドライバーへ送った",
  "statement.link": "明細のリンクを作った",
  "statement.relink": "明細のリンクを作り直した",
  "statement.view": "ドライバーが明細を開いた",
  "statement.confirm": "ドライバーが明細を確認した",
  "statement.message": "明細について連絡があった",
  "statement.question": "ドライバーから明細について連絡があった",
  "statement.reply": "明細の連絡に返事をした",
  "statement.resolve": "明細の質問を「解決」にした",
  "statement.reopen_question": "明細の質問を「未解決」に戻した",
  "statement.pdf": "明細の PDF を出した",
  "statement.annual_csv": "1 年分の支払の一覧を出した",
  "transfer.create": "振込データを作った",
  "transfer.delete": "振込データを取り消した",
  "transfer.executed": "振り込んだ日を記録した",
  "transfer.download": "振込データをダウンロードした",
  "watch.ack": "見張り番の指摘を確認済みにした",
  "watch.unack": "見張り番の確認済みを外した",
  "import.apply": "Excel の取り込みを反映した",
  "import.discard": "取り込みを取り消した",
  "import.undo": "取り込みを元に戻した",
  "import.upload": "Excel を取り込んだ",
  "import.month": "取り込む月を選んだ",
  "import.sheet": "取り込むシートを選んだ",
  "import.header": "見出しの行を選んだ",
  "import.mapping": "取り込む列の対応を決めた",
  "import.profile.delete": "覚えた列の対応を消した",
  "import.name.match": "取り込みの名前を、登録済みの人・案件に対応づけた",
  "import.name.skip": "取り込まない名前を決めた",
  "import.name.unskip": "取り込まないとした名前を、取り込む対象に戻した",
  "import.name.create": "取り込みの名前から、新しく登録した",
  "import.name.createAllDrivers": "取り込みの名前から、ドライバーをまとめて登録した",
  "work.add": "稼働を足した",
  "work.create": "稼働を足した",
  "work.update": "稼働を直した",
  "work.delete": "稼働を消した",
  "adjustment.add": "調整を足した",
  "adjustment.create": "調整を足した",
  "adjustment.update": "調整を直した",
  "adjustment.delete": "調整を消した",
  "parallel.save": "Excel の振込額を入れた",
  "parallel.clear": "Excel の振込額を消した",
  "parallel.golive": "本番の運用に切り替えた",
  "parallel.golive_undo": "本番の運用への切り替えを元に戻した",
  "export.ceo_pdf": "社長の 1 枚（PDF）を出した",
  "export.statement_pdf": "明細の PDF を出した",
  "export.statements_pdf": "明細の PDF をまとめて出した",
  "export.statement_confirmations": "確認の記録（CSV）を出した",
  "export.reconcile_items": "突合の差の一覧を出した",
  "export.accounting": "会計ソフト向けに出力した",
  "export.payments_csv": "支払の一覧（CSV）を出した",
  "export.audit_csv": "操作の記録（CSV）を出した",
  "data.export": "全データを書き出した",
  "data.import": "全データを読み戻した（別の場所から移した）",
  "reconcile.run": "元請の支払通知と突き合わせた",
  "reconcile.update": "突合の差の扱いを変えた",
  "reconcile.item_status": "突合の差の扱いを変えた",
  "reconcile.items_asked": "突合の差を元請に問い合わせた",
  "reconcile.item_removed": "突合の差を一覧から外した",
  "reconcile.columns": "支払通知の列の対応を覚えた",
  "reconcile.driver_mapping": "支払通知のドライバー名を対応づけた",
  "reconcile.line_mapping": "支払通知の行を案件に対応づけた",
  "reconcile.notice_meta": "支払通知の入金日などを入れた",
  "reconcile.notice_delete": "支払通知を消した",
  "reconcile.notice_import": "元請の支払通知を取り込んだ",
  "reconcile.notice_replace": "元請の支払通知を取り込み直した",
  "notice.import": "元請の支払通知を取り込んだ",
  "terms.create": "取引条件の記録を作った",
  "terms.bulk_create": "取引条件の記録をまとめて作った",
  "terms.send": "取引条件をドライバーへ送った",
  "terms.relink": "取引条件のリンクを作り直した",
  "terms.view": "ドライバーが取引条件を開いた",
  "terms.receive": "ドライバーが取引条件を受け取った",
  "terms.received": "ドライバーが取引条件を受け取った",
  "terms.pdf": "取引条件の PDF を出した",
  "export.terms_pdf": "取引条件の PDF を出した",
  "driver.create": "ドライバーを登録した",
  "driver.bulk_create": "ドライバーをまとめて登録した",
  "driver.update": "ドライバーの設定を直した",
  "driver.delete": "ドライバーを消した",
  "driver.activate": "ドライバーを有効に戻した",
  "driver.deactivate": "ドライバーを無効にした",
  "client.create": "元請を登録した",
  "client.update": "元請の設定を直した",
  "client.delete": "元請を消した",
  "client.activate": "元請を有効に戻した",
  "client.deactivate": "元請を無効にした",
  "project.create": "案件を登録した",
  "project.bulk_create": "案件をまとめて登録した",
  "project.update": "案件の設定を直した",
  "project.delete": "案件を消した",
  "project.activate": "案件を有効に戻した",
  "project.deactivate": "案件を無効にした",
  "rate_override.create": "ドライバーごとの単価を決めた",
  "rate_override.update": "ドライバーごとの単価を直した",
  "rate_override.delete": "ドライバーごとの単価を消した",
  "deduction_rule.create": "控除のルールを足した",
  "deduction_rule.update": "控除のルールを直した",
  "deduction_rule.delete": "控除のルールを消した",
  "deduction_rule.activate": "控除のルールを有効に戻した",
  "deduction_rule.deactivate": "控除のルールを止めた",
  "rule.bulk_create": "控除のルールをまとめて登録した",
  "accounting.settings": "会計ソフトへの出力の設定を変えた",
  "settings.company.update": "会社の設定を変えた",
  "settings.ai_consent": "AI の読み取りの同意を変えた",
  "onboarding.step": "最初の設定を進めた",
  "onboarding.company": "最初の設定で会社の情報を入れた",
  "onboarding.finish": "最初の設定を終えた",
  "onboarding.reopen": "最初の設定をやり直した",
  "user.role": "利用者の役割を変えた",
  "user.disable": "利用者を止めた",
  "user.enable": "利用者を再開した",
  "invite.create": "利用者を招待した",
  "invite.revoke": "招待を取り消した",
  "invite.accept": "招待から使い始めた",
  setup: "会社を作った（最初の設定）",
  login: "ログインした",
};

const PREFIX_LABELS: [string, string][] = [
  ["month.", "締め"],
  ["statement.", "明細"],
  ["portal.", "ドライバーの画面"],
  ["transfer.", "振込データ"],
  ["watch.", "見張り番"],
  ["import.name.", "取り込みの名前の対応"],
  ["import.", "取り込み"],
  ["work.", "稼働"],
  ["adjustment.", "調整"],
  ["parallel.", "Excel との比べ合わせ"],
  ["reconcile.", "元請との突合"],
  ["notice.", "元請の支払通知"],
  ["terms.", "取引条件"],
  ["export.", "出力"],
  ["data.", "全データ"],
  ["profit.", "利益"],
  ["driver.", "ドライバーの設定"],
  ["client.", "元請の設定"],
  ["project.", "案件の設定"],
  ["rate_override.", "単価の設定"],
  ["deduction_rule.", "控除のルール"],
  ["rule.", "控除のルール"],
  ["accounting.", "会計ソフトへの出力"],
  ["settings.", "会社の設定"],
  ["onboarding.", "最初の設定"],
  ["user.", "利用者"],
  ["invite.", "招待"],
];

/** 操作の名前を、読める日本語に */
export function auditLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const prefix = PREFIX_LABELS.find(([p]) => action.startsWith(p));
  return prefix ? `${prefix[1]}の操作` : "操作";
}

const yenOf = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("ja-JP")}円` : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const join = (parts: (string | null | undefined | false)[], sep = "・") => parts.filter(Boolean).join(sep) || null;

/** 設定の画面で直した項目（changed のキー）→ 日本語 */
const FIELD_LABELS: Record<string, string> = {
  name: "名前",
  code: "番号",
  kana: "ふりがな",
  aliases: "別名",
  email: "メール",
  phone: "電話",
  invoiceRegistered: "インボイスの登録",
  registrationNo: "登録番号",
  registrationCheckedOn: "登録を確かめた日",
  isCorporation: "法人か",
  withholdingCategory: "源泉徴収",
  bankCode: "銀行コード",
  bankNameKana: "銀行名",
  branchCode: "支店コード",
  branchNameKana: "支店名",
  accountType: "預金の種類",
  accountNumber: "口座番号",
  holderKana: "口座名義",
  termsIssuedOn: "取引条件を明示した日",
  startedOn: "委託を始めた日",
  endOn: "委託の終了日",
  endNoticedOn: "終了を伝えた日",
  active: "有効・無効",
  notes: "メモ",
  clientId: "元請",
  unit: "単位",
  billRate: "受注単価",
  payRate: "支払単価",
  kind: "種類",
  rate: "率",
  amount: "金額",
  onlyWhenWorked: "稼働がある月だけ",
  taxable: "消費税",
  agreedInWriting: "書面の合意",
  agreedOn: "合意した日",
  basis: "根拠",
  closingDay: "締め日",
  payMonthOffset: "支払月",
  payDay: "支払日",
  taxMethod: "消費税の計算",
  payTaxToExempt: "免税の方への消費税相当額",
  taxRounding: "消費税の端数",
  amountRounding: "金額の端数",
  settings: "細かい設定",
};

function changedFields(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const keys = Object.keys(v as object);
  if (keys.length === 0) return "変更なし";
  return `変えたところ：${keys.map((k) => FIELD_LABELS[k] ?? k).join("・")}`;
}

const ROLE_JA: Record<string, string> = { owner: "オーナー", staff: "事務", viewer: "閲覧" };

/** 記録の中身を 1 行に（金額・人数・理由など） */
export function auditSummary(action: string, detail: Record<string, unknown>): string | null {
  const d = detail;
  switch (action) {
    case "month.close": {
      const o = d.override as { reason?: unknown } | undefined;
      return join([
        typeof d.drivers === "number" ? `${d.drivers}人` : null,
        yenOf(d.total) && `振込額の合計 ${yenOf(d.total)}`,
        num(d.minutesSpent) !== null && `かかった時間 ${d.minutesSpent}分`,
        o && typeof o.reason === "string" && `赤い指摘が残ったまま締めた（理由：${o.reason}）`,
      ]);
    }
    case "month.reopen":
      return typeof d.reason === "string" ? `理由：${d.reason}` : null;
    case "statement.generate": {
      const parts = [
        typeof d.created === "number" && d.created ? `新しく ${d.created}人` : null,
        typeof d.updated === "number" && d.updated ? `変わった ${d.updated}人` : null,
        typeof d.unchanged === "number" && d.unchanged ? `変わらない ${d.unchanged}人` : null,
        typeof d.removed === "number" && d.removed ? `消した ${d.removed}人` : null,
      ].filter(Boolean);
      return parts.join("・") || null;
    }
    case "statement.confirm":
      return join([num(d.version) !== null && `第${d.version}版`, yenOf(d.total) && `振込額 ${yenOf(d.total)}`]);
    case "statement.view":
      return join([num(d.version) !== null && `第${d.version}版`, d.again === true && "2 回目以降"]);
    case "statement.send":
    case "statement.relink":
      return join([num(d.version) !== null && `第${d.version}版`, str(d.channel) && `送り方：${d.channel}`]);
    case "statement.question":
    case "statement.reply":
      return num(d.length) !== null ? `${d.length}文字` : null;
    case "statement.remove":
      return num(d.version) !== null ? `第${d.version}版まであった明細` : null;
    case "transfer.create":
    case "transfer.delete":
      return join([
        typeof d.fileName === "string" ? d.fileName : null,
        typeof d.count === "number" ? `${d.count}人` : null,
        yenOf(d.total),
        Array.isArray(d.bankChanged) && d.bankChanged.length > 0 && `口座が変わった人 ${d.bankChanged.length}人を確かめた`,
      ]);
    case "transfer.executed":
      return typeof d.executedOn === "string" ? `振り込んだ日：${d.executedOn}` : "振り込んだ日を消した";
    case "transfer.download":
      return d.format === "csv" ? "振込の一覧（CSV）" : "全銀の振込データ";
    case "watch.ack":
      return [typeof d.title === "string" ? d.title : typeof d.code === "string" ? d.code : null, typeof d.subject === "string" ? `（${d.subject}）` : null, typeof d.note === "string" ? `：${d.note}` : null].filter(Boolean).join("") || null;
    case "watch.unack":
      return [typeof d.title === "string" ? d.title : typeof d.code === "string" ? d.code : null, typeof d.previousNote === "string" ? `（前のメモ：${d.previousNote}）` : null].filter(Boolean).join("") || null;
    case "work.add":
    case "work.update":
    case "work.delete":
    case "adjustment.add":
    case "adjustment.update":
    case "adjustment.delete":
      return [typeof d.driver === "string" ? `${d.driver}さん` : null, typeof d.label === "string" ? d.label : null, yenOf(d.amount)].filter(Boolean).join("・") || null;
    case "import.upload":
      return str(d.fileName);
    case "import.apply":
      return join([
        d.mode === "replaceAll" ? "月の稼働をすべて入れ替え" : d.mode === "add" ? "今ある稼働に足した" : d.mode === "replace" ? "同じ形の取り込みを入れ替え" : null,
        num(d.entries) !== null && `${d.entries}件を入れた`,
        num(d.removedEntries) ? `${d.removedEntries}件を消した` : null,
      ]);
    case "import.undo":
      return join([num(d.deleted) !== null && `${d.deleted}件を消した`, num(d.restored) ? `${d.restored}件を戻した` : null]);
    case "reconcile.run":
      return join([yenOf(d.ourTotal) && `こちら ${yenOf(d.ourTotal)}`, yenOf(d.theirTotal) && `元請 ${yenOf(d.theirTotal)}`]);
    case "reconcile.notice_import":
    case "reconcile.notice_replace":
      return join([str(d.fileName), num(d.lines) !== null && `${d.lines}行`, yenOf(d.total)]);
    case "reconcile.item_status":
      return join([str(d.label), yenOf(d.diff) && `差 ${yenOf(d.diff)}`, yenOf(d.recoveredAmount) && `取り戻せた額 ${yenOf(d.recoveredAmount)}`]);
    case "driver.create":
    case "driver.delete":
    case "driver.activate":
    case "driver.deactivate":
    case "client.create":
    case "client.delete":
    case "project.create":
    case "project.delete":
    case "project.activate":
    case "project.deactivate":
    case "deduction_rule.create":
    case "deduction_rule.delete":
    case "deduction_rule.activate":
    case "deduction_rule.deactivate":
      return str(d.name);
    case "driver.update":
    case "client.update":
    case "project.update":
    case "deduction_rule.update":
      return join([str(d.name), changedFields(d.changed)], "：");
    case "settings.company.update":
      return changedFields(d.changed);
    case "user.role":
      return join([str(d.name), typeof d.from === "string" && typeof d.to === "string" && `${ROLE_JA[d.from] ?? d.from} → ${ROLE_JA[d.to] ?? d.to}`], "：");
    case "user.disable":
    case "user.enable":
      return str(d.name);
    case "invite.create":
    case "invite.revoke":
      return join([str(d.name), typeof d.role === "string" && (ROLE_JA[d.role] ?? d.role)]);
    case "terms.create":
    case "terms.send":
    case "terms.relink":
      return num(d.version) !== null ? `第${d.version}版` : null;
    case "terms.bulk_create":
      return num(d.created) !== null ? `${d.created}人ぶん` : null;
    case "export.accounting":
    case "export.payments_csv":
      return join([str(d.fileName), num(d.rows) !== null && `${d.rows}行`]);
    case "export.audit_csv":
      return num(d.rows) !== null ? `${d.rows}件` : null;
    case "data.export":
      return join([str(d.fileName), num(d.rows) !== null && `${d.rows}行`, num(d.versions) !== null && `明細の版 ${d.versions}件`]);
    case "data.import":
      return join([str(d.tenantName), num(d.rows) !== null && `${d.rows}行`, num(d.versions) !== null && `明細の版 ${d.versions}件`]);
    default:
      return null;
  }
}
