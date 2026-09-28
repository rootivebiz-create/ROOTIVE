import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { Rounding } from "@/lib/payroll/types";
import { buildStatementDrafts, type StatementDraft } from "~/server/calc/statement";
import { buildTermsContentMany, compareTermsContent, latestTermsByDriver, type TermsContent } from "~/server/features/terms-content";
import { questionLine, readTermsContent } from "~/server/features/watch/rules";
import type { WatchBatch, WatchContext, WatchDriver, WatchQuestion, WatchStatement, WatchTerms } from "~/server/features/watch/types";
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

/** 保存した写しを、足りない項目があっても読めるようにそろえる（古い写しでも見張り番が止まらないように） */
function normalizeDraft(d: StatementDraft): StatementDraft {
  const lines = Array.isArray(d.lines) ? d.lines : [];
  return {
    ...d,
    lines,
    deductions: Array.isArray(d.deductions) ? d.deductions : [],
    adjustments: Array.isArray(d.adjustments) ? d.adjustments : [],
    subtotal: d.subtotal ?? 0,
    tax: d.tax ?? 0,
    deductionTotal: d.deductionTotal ?? 0,
    deductionTax: d.deductionTax ?? 0,
    adjustmentTotal: d.adjustmentTotal ?? 0,
    adjustmentTax: d.adjustmentTax ?? 0,
    total: d.total ?? 0,
    invoiceBurden: d.invoiceBurden ?? 0,
    deductibleRate: d.deductibleRate ?? 1,
    hasWork: d.hasWork ?? lines.length > 0,
    driver: { name: d.driver?.name ?? "", code: d.driver?.code ?? null, registrationNo: d.driver?.registrationNo ?? null, invoiceRegistered: d.driver?.invoiceRegistered ?? false },
  };
}

/** 名前の一覧が社内の番号の順になるように（D01, D02, …） */
function byCode(drafts: StatementDraft[]): StatementDraft[] {
  return drafts.sort((a, b) => (a.driver.code ?? "").localeCompare(b.driver.code ?? "", "ja") || a.driver.name.localeCompare(b.driver.name, "ja"));
}

/** その月の明細：締めた月で写しがあれば写し、それ以外は今の稼働から作る */
async function draftsOf(db: Db, tenantId: string, month: string, closed: boolean, saved: SavedRow[]): Promise<StatementDraft[]> {
  return byCode(closed && saved.length ? saved.map((r) => normalizeDraft(readSnapshot(r))) : buildStatementDrafts(await loadBuildInput(db, tenantId, month)));
}

/**
 * 前の月の明細（比べるもと）：保存した写しがある人は写し（ドライバーに見せた中身）、無い人は今の稼働から作った見込み。
 * 締めた月で写しがあれば、写しだけ
 */
async function prevDraftsOf(db: Db, tenantId: string, month: string, closed: boolean, saved: SavedRow[]): Promise<StatementDraft[]> {
  if (closed && saved.length) return draftsOf(db, tenantId, month, closed, saved);
  const savedBy = new Map(saved.map((r) => [r.driverId, normalizeDraft(readSnapshot(r))]));
  const computed = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  const merged = computed.map((d) => savedBy.get(d.driverId) ?? d);
  const seen = new Set(merged.map((d) => d.driverId));
  for (const [driverId, d] of savedBy) if (!seen.has(driverId)) merged.push(d);
  return byCode(merged);
}

/** 保存した明細の支払日と振込額 */
function statementRowsOf(saved: SavedRow[]): WatchStatement[] {
  return saved.map((r) => ({ id: r.id, driverId: r.driverId, total: r.total, payDate: readSnapshot(r).payDate }));
}

/** 振込データ（入っている明細は、その会社・その月のものだけに絞る） */
function batchRowsOf(rows: (typeof s.transferBatches.$inferSelect)[], saved: SavedRow[]): WatchBatch[] {
  const ids = new Set(saved.map((r) => r.id));
  return rows.map((b) => ({ id: b.id, fileName: b.fileName, transferDate: b.transferDate, executedOn: b.executedOn, statementIds: b.statementIds.filter((id) => ids.has(id)) }));
}

/**
 * その人たちのいちばん新しい取引条件の記録と、今の台帳から作った中身との違い。
 * 比べる案件は、記録にある案件（新しく担当した案件は「変わった」に数えない）
 */
async function termsOf(db: Db, tenantId: string, month: string, driverIds: string[], compare: boolean): Promise<WatchTerms[]> {
  if (!driverIds.length) return [];
  const latest = await latestTermsByDriver(db, tenantId, driverIds);
  const recordedBy = new Map([...latest].map(([driverId, r]) => [driverId, readTermsContent(r.content)]));
  // 今の台帳からの中身は、まとめて 1 回で組み立てる（比べられないときは「古い」と言わない。見張り番は止めない）
  let currentBy = new Map<string, TermsContent>();
  if (compare) {
    const items = [...latest]
      .filter(([driverId]) => recordedBy.get(driverId))
      .map(([driverId, r]) => ({ driverId, projectIds: recordedBy.get(driverId)!.services.map((x) => x.projectId), deemed: r.deemedClause }));
    try {
      currentBy = await buildTermsContentMany(db, tenantId, items, month);
    } catch (error) {
      console.error("watch terms compare failed", error instanceof Error ? error.message : error);
    }
  }
  return [...latest].map(([driverId, r]): WatchTerms => {
    const recorded = recordedBy.get(driverId) ?? null;
    const current = currentBy.get(driverId) ?? null;
    return {
      driverId,
      version: r.version,
      issuedOn: r.issuedOn,
      recorded,
      current,
      changes: recorded && current ? compareTermsContent(recorded, current) : [],
      subcontract: r.subcontract ?? null,
    };
  });
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
  const statementIds = saved.map((r) => r.id);
  const [drafts, prevDrafts, drivers, terms, firstWork, rules, overrides, adjustments, batches, status, workRows, messages, prevBatches] = await Promise.all([
    draftsOf(db, tenantId, month, closed, saved),
    prevDraftsOf(db, tenantId, prevMonth, prevClosed, prevSaved),
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
    // 日付のある稼働の行（同じ日・同じ案件の重なりを見る）
    db
      .select({
        driverId: s.workEntries.driverId,
        projectId: s.workEntries.projectId,
        workDate: s.workEntries.workDate,
        qty: s.workEntries.qty,
        batchId: s.workEntries.importBatchId,
      })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month), isNotNull(s.workEntries.workDate), gt(s.workEntries.qty, 0))),
    // この月の明細への、まだ解決にしていないドライバーの質問
    statementIds.length
      ? db
          .select({ statementId: s.statementMessages.statementId, lineKey: s.statementMessages.lineKey, createdAt: s.statementMessages.createdAt })
          .from(s.statementMessages)
          .where(
            and(
              eq(s.statementMessages.tenantId, tenantId),
              eq(s.statementMessages.author, "driver"),
              isNull(s.statementMessages.resolvedAt),
              inArray(s.statementMessages.statementId, statementIds),
            ),
          )
      : Promise.resolve([]),
    db
      .select()
      .from(s.transferBatches)
      .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, prevMonth))),
  ]);
  // この月に反映した稼働の取り込みのうち、Excel に振込手数料の列があったもの
  const feeColumnRows = await db
    .select({ id: s.importBatches.id, fileName: s.importBatches.fileName, columns: sql<string[] | null>`${s.importBatches.summary}->'applied'->'feeColumns'` })
    .from(s.importBatches)
    .where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.month, month), eq(s.importBatches.kind, "work"), eq(s.importBatches.status, "applied")));
  const feeColumns = feeColumnRows
    .map((r) => ({ batchId: r.id, fileName: r.fileName, columns: Array.isArray(r.columns) ? r.columns.filter((c): c is string => typeof c === "string") : [] }))
    .filter((r) => r.columns.length > 0);
  // 取引条件の記録（この月に明細がある人だけ）。今の台帳と比べるのは、まだ締めていない月だけ（締めた月は見るだけ）
  const termsRows = await termsOf(db, tenantId, month, drafts.map((d) => d.driverId), !closed);

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

  const savedBy = new Map(saved.map((r) => [r.id, r]));
  const questions: WatchQuestion[] = messages.flatMap((q) => {
    const st = savedBy.get(q.statementId);
    if (!st) return [];
    return [{ statementId: st.id, driverId: st.driverId, lineKey: q.lineKey, askedOn: dateOf(q.createdAt), line: questionLine(normalizeDraft(readSnapshot(st)), q.lineKey) }];
  });

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
      amountRounding: tenant.amountRounding as Rounding,
    },
    drafts,
    prevDrafts,
    feeColumns,
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
      onlyWhenWorked: r.onlyWhenWorked,
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
    statements: statementRowsOf(saved),
    batches: batchRowsOf(batches, saved),
    statementsStatus: status
      ? { saved: status.saved, missing: status.missing.length, stale: status.stale.length, orphan: status.orphan.length, upToDate: status.upToDate }
      : null,
    workRows: workRows.filter((w): w is typeof w & { workDate: string } => w.workDate !== null),
    questions,
    prevStatements: statementRowsOf(prevSaved),
    prevBatches: batchRowsOf(prevBatches, prevSaved),
    terms: termsRows,
  };
}

