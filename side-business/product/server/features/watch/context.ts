import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts, type StatementDraft } from "~/server/calc/statement";
import type { WatchContext, WatchDriver } from "~/server/features/watch/types";
import { shiftMonth } from "~/server/month";
import { getTenant, isMonthClosed, loadBuildInput } from "~/server/repo";
import { readSnapshot, statementsStatus } from "~/server/statements-core";

/**
 * 見張り番の材料を、その会社・その月だけ DB から集める（判定はしない。判定は rules.ts）。
 * - 締めた月は保存した明細の写し、開いている月は今の稼働から作った見込みを見る
 * - 締めた月でも写しが無い（取り込みの前に締めた など）ときは、稼働から作った見込みで見る
 */

const jstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

/** 今日（日本時間）の YYYY-MM-DD */
export function todayJst(now: Date = new Date()): string {
  return jstDate.format(now);
}

/** 日時を日本時間の日付に */
function dateOf(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "1970-01-01" : jstDate.format(d);
}

type SavedRow = { id: string; driverId: string; total: number; snapshot: unknown };

/** その月の明細：締めた月で写しがあれば写し、それ以外は今の稼働から作る */
async function draftsOf(db: Db, tenantId: string, month: string, closed: boolean, saved: SavedRow[]): Promise<StatementDraft[]> {
  const drafts = closed && saved.length ? saved.map((r) => readSnapshot(r)) : buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  // 名前の一覧が社内の番号の順になるように（D01, D02, …）
  return drafts.sort((a, b) => (a.driver.code ?? "").localeCompare(b.driver.code ?? "", "ja") || a.driver.name.localeCompare(b.driver.name, "ja"));
}

async function savedStatements(db: Db, tenantId: string, month: string): Promise<SavedRow[]> {
  return db
    .select({ id: s.statements.id, driverId: s.statements.driverId, total: s.statements.total, snapshot: s.statements.snapshot })
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
}

export async function loadWatchContext(db: Db, tenantId: string, month: string, today: string = todayJst()): Promise<WatchContext> {
  const tenant = await getTenant(db, tenantId);
  const prevMonth = shiftMonth(month, -1);
  const [closed, prevClosed, saved, prevSaved] = await Promise.all([
    isMonthClosed(db, tenantId, month),
    isMonthClosed(db, tenantId, prevMonth),
    savedStatements(db, tenantId, month),
    savedStatements(db, tenantId, prevMonth),
  ]);
  const [drafts, prevDrafts, drivers, terms, firstWork, rules, overrides, adjustments, batches, status] = await Promise.all([
    draftsOf(db, tenantId, month, closed, saved),
    draftsOf(db, tenantId, prevMonth, prevClosed, prevSaved),
    db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    db
      .select({
        driverId: s.termsRecords.driverId,
        first: sql<string | null>`min(${s.termsRecords.issuedOn})::text`,
        last: sql<string | null>`max(${s.termsRecords.issuedOn})::text`,
      })
      .from(s.termsRecords)
      .where(eq(s.termsRecords.tenantId, tenantId))
      .groupBy(s.termsRecords.driverId),
    db
      .select({
        driverId: s.workEntries.driverId,
        month: sql<string>`${s.workEntries.month}::text`,
        minDate: sql<string | null>`min(${s.workEntries.workDate})::text`,
        undated: sql<number>`(count(*) filter (where ${s.workEntries.workDate} is null))::int`,
      })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), gt(s.workEntries.qty, 0)))
      .groupBy(s.workEntries.driverId, s.workEntries.month),
    db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
    db.select().from(s.rateOverrides).where(eq(s.rateOverrides.tenantId, tenantId)),
    db
      .select()
      .from(s.adjustments)
      .where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, month))),
    db
      .select()
      .from(s.transferBatches)
      .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, month))),
    closed ? Promise.resolve(null) : statementsStatus(db, tenantId, month),
  ]);

  const termsBy = new Map(terms.map((t) => [t.driverId, t]));
  // ドライバーごとの最初に稼働した月（とその月のいちばん早い日付）
  const firstBy = new Map<string, WatchDriver["firstWork"]>();
  for (const w of firstWork) {
    const m = w.month.slice(0, 10);
    const cur = firstBy.get(w.driverId);
    if (!cur || m < cur.month) firstBy.set(w.driverId, { month: m, minDate: w.minDate, hasUndated: Number(w.undated) > 0 });
  }

  const earliest = (...v: (string | null | undefined)[]) => v.filter((x): x is string => !!x).sort()[0] ?? null;
  const latest = (...v: (string | null | undefined)[]) => v.filter((x): x is string => !!x).sort().at(-1) ?? null;

  // 保存した明細の支払日（写しの payDate）
  const statementRows = saved.map((r) => {
    const snap = readSnapshot(r);
    return { id: r.id, driverId: r.driverId, total: r.total, payDate: snap.payDate };
  });

  // 振込データに入っている明細が、この会社のものか（念のため id で絞る）
  const statementIds = new Set(saved.map((r) => r.id));

  return {
    month,
    today,
    closed,
    tenant: {
      closingDay: tenant.closingDay,
      payMonthOffset: tenant.payMonthOffset,
      payDay: tenant.payDay,
      taxMethod: tenant.taxMethod,
      settings: tenant.settings ?? {},
    },
    drafts,
    prevDrafts,
    drivers: drivers.map((d) => {
      const t = termsBy.get(d.id);
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        active: d.active,
        invoiceRegistered: d.invoiceRegistered,
        registrationNo: d.registrationNo,
        registrationCheckedOn: d.registrationCheckedOn,
        termsFirstIssuedOn: earliest(t?.first, d.termsIssuedOn),
        termsLatestIssuedOn: latest(t?.last, d.termsIssuedOn),
        startedOn: d.startedOn,
        endOn: d.endOn,
        endNoticedOn: d.endNoticedOn,
        bank: {
          bankCode: (d.bankCode ?? "").trim(),
          bankNameKana: (d.bankNameKana ?? "").trim(),
          branchCode: (d.branchCode ?? "").trim(),
          branchNameKana: (d.branchNameKana ?? "").trim(),
          accountType: d.accountType === "checking" ? "checking" : "ordinary",
          accountNumber: (d.accountNumber ?? "").trim(),
          holderKana: (d.holderKana ?? "").trim(),
        },
        firstWork: firstBy.get(d.id) ?? null,
      };
    }),
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      driverId: r.driverId,
      kind: r.kind,
      agreedInWriting: r.agreedInWriting,
      agreedOn: r.agreedOn,
      basis: r.basis,
      active: r.active,
    })),
    overrides: overrides.map((o) => ({
      id: o.id,
      driverId: o.driverId,
      projectId: o.projectId,
      payRate: o.payRate,
      agreedOn: o.agreedOn,
      updatedOn: dateOf(o.updatedAt),
    })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      driverId: a.driverId,
      label: a.label,
      amount: a.amount,
      agreedInWriting: a.agreedInWriting,
      basis: a.basis,
    })),
    statements: statementRows,
    batches: batches.map((b) => ({
      id: b.id,
      fileName: b.fileName,
      transferDate: b.transferDate,
      executedOn: b.executedOn,
      statementIds: b.statementIds.filter((id) => statementIds.has(id)),
    })),
    statementsStatus: status
      ? { saved: status.saved, missing: status.missing.length, stale: status.stale.length, orphan: status.orphan.length, upToDate: status.upToDate }
      : null,
  };
}

