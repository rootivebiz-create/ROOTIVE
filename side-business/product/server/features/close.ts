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
  action: string;
  label: string;
  summary: string | null;
};

export async function monthAuditLog(db: Db, tenantId: string, month: string, limit = 50): Promise<AuditRow[]> {
  assertMonth(month);
  const [rows, users] = await Promise.all([
    db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), or(eq(s.auditLog.entityId, month), sql`${s.auditLog.detail}->>'month' = ${month}`)))
      .orderBy(desc(s.auditLog.id))
      .limit(limit),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    userName: r.userId ? userName.get(r.userId) ?? null : r.detail?.by === "driver" ? "ドライバー" : null,
    action: r.action,
    label: auditLabel(r.action),
    summary: auditSummary(r.action, r.detail ?? {}),
  }));
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
  "export.ceo_pdf": "社長の 1 枚（PDF）を出した",
  "export.statement_pdf": "明細の PDF を出した",
  "export.statements_pdf": "明細の PDF をまとめて出した",
  "export.statement_confirmations": "確認の記録（CSV）を出した",
  "export.reconcile_items": "突合の差の一覧を出した",
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
  "notice.import": "元請の支払通知を取り込んだ",
  "export.accounting": "会計ソフト向けに出力した",
};

const PREFIX_LABELS: [string, string][] = [
  ["month.", "締め"],
  ["statement.", "明細"],
  ["transfer.", "振込データ"],
  ["watch.", "見張り番"],
  ["import.", "取り込み"],
  ["work.", "稼働"],
  ["adjustment.", "調整"],
  ["parallel.", "Excel との比べ合わせ"],
  ["reconcile.", "元請との突合"],
  ["notice.", "元請の支払通知"],
  ["export.", "出力"],
  ["profit.", "利益"],
];

/** 操作の名前を、読める日本語に */
export function auditLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const prefix = PREFIX_LABELS.find(([p]) => action.startsWith(p));
  return prefix ? `${prefix[1]}の操作` : "操作";
}

const yenOf = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("ja-JP")}円` : null);

/** 記録の中身を 1 行に（金額・人数・理由など） */
export function auditSummary(action: string, detail: Record<string, unknown>): string | null {
  const d = detail;
  switch (action) {
    case "month.close":
      return [typeof d.drivers === "number" ? `${d.drivers}人` : null, yenOf(d.total) && `振込額の合計 ${yenOf(d.total)}`].filter(Boolean).join("・") || null;
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
    case "transfer.create":
    case "transfer.delete":
      return [typeof d.fileName === "string" ? d.fileName : null, typeof d.count === "number" ? `${d.count}人` : null, yenOf(d.total)].filter(Boolean).join("・") || null;
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
    default:
      return null;
  }
}
