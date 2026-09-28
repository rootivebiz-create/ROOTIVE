import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { changes, countWhere, findNameConflict } from "./common";
import { fieldError } from "./errors";
import { driverBadges, hasBank } from "./format";
import { looseKey, type DriverInput } from "./schemas";

/**
 * ドライバーの台帳（事務が変える）。会社（tenant）で必ず絞る。
 * 稼働・明細などの記録がある人は消さずに「無効」にする（記録を残すため）。
 */

export type DriverRow = typeof s.drivers.$inferSelect;

export type DriverFilter = { q?: string; status?: "active" | "inactive" | "all"; flag?: "unregistered" | "no_bank" | "no_terms" | "" };

export type DriverCounts = { total: number; active: number; unregistered: number; noBank: number; noTerms: number };

function sortDrivers(a: DriverRow, b: DriverRow): number {
  // 有効な人 → 番号のある人（番号順）→ フリガナ順
  return (
    Number(b.active) - Number(a.active) ||
    Number(!a.code) - Number(!b.code) ||
    (a.code ?? "").localeCompare(b.code ?? "", "ja", { numeric: true }) ||
    (a.kana ?? a.name).localeCompare(b.kana ?? b.name, "ja")
  );
}

/** 検索の言葉が、名前・フリガナ・番号・別名のどれかに入っているか */
export function driverMatches(d: Pick<DriverRow, "name" | "kana" | "code" | "aliases" | "email">, q: string): boolean {
  const key = looseKey(q);
  if (!key) return true;
  return [d.name, d.kana ?? "", d.code ?? "", d.email ?? "", ...d.aliases].some((v) => looseKey(v).includes(key));
}

export async function listDrivers(db: Db, tenantId: string, filter: DriverFilter = {}): Promise<{ rows: DriverRow[]; counts: DriverCounts }> {
  const all = (await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))).sort(sortDrivers);
  const active = all.filter((d) => d.active);
  const counts: DriverCounts = {
    total: all.length,
    active: active.length,
    unregistered: active.filter((d) => !d.invoiceRegistered).length,
    noBank: active.filter((d) => !hasBank(d)).length,
    noTerms: active.filter((d) => !d.termsIssuedOn).length,
  };
  const status = filter.status ?? "active";
  const rows = all.filter((d) => {
    if (status === "active" && !d.active) return false;
    if (status === "inactive" && d.active) return false;
    if (filter.flag === "unregistered" && d.invoiceRegistered) return false;
    if (filter.flag === "no_bank" && hasBank(d)) return false;
    if (filter.flag === "no_terms" && d.termsIssuedOn) return false;
    return driverMatches(d, filter.q ?? "");
  });
  return { rows, counts };
}

export { driverBadges };

export async function getDriver(db: Db, tenantId: string, id: string): Promise<DriverRow | null> {
  const rows = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function mustGetDriver(db: Db, tenantId: string, id: string): Promise<DriverRow> {
  const d = await getDriver(db, tenantId, id);
  if (!d) throw new UserError("そのドライバーは見つかりません。一覧から開き直してください");
  return d;
}

/** この人を使っている記録の数（消せるかどうかの説明に使う） */
export async function driverReferences(db: Db, tenantId: string, id: string) {
  const [work, adjustments, statements, versions, terms, parallel, noticeLines, reconItems, overrides, rules] = await Promise.all([
    countWhere(db, s.workEntries, and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.driverId, id))),
    countWhere(db, s.adjustments, and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.driverId, id))),
    countWhere(db, s.statements, and(eq(s.statements.tenantId, tenantId), eq(s.statements.driverId, id))),
    countWhere(db, s.statementVersions, and(eq(s.statementVersions.tenantId, tenantId), eq(s.statementVersions.driverId, id))),
    countWhere(db, s.termsRecords, and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, id))),
    countWhere(db, s.parallelChecks, and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.driverId, id))),
    countWhere(db, s.paymentNoticeLines, and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.driverId, id))),
    countWhere(db, s.reconciliationItems, and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.driverId, id))),
    countWhere(db, s.rateOverrides, and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, id))),
    countWhere(db, s.deductionRules, and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.driverId, id))),
  ]);
  const history = [
    work && `稼働 ${work}件`,
    adjustments && `調整 ${adjustments}件`,
    statements + versions && `支払明細 ${Math.max(statements, versions)}件`,
    terms && `取引条件の記録 ${terms}件`,
    parallel && `Excel との比べ合わせ ${parallel}件`,
    noticeLines + reconItems && `元請の支払通知・突合 ${noticeLines + reconItems}件`,
  ].filter((x): x is string => typeof x === "string");
  return { history, attached: { overrides, rules }, canDelete: history.length === 0 };
}

export type DriverReferences = Awaited<ReturnType<typeof driverReferences>>;

async function others(db: Db, tenantId: string, exceptId?: string) {
  return db
    .select({ id: s.drivers.id, name: s.drivers.name, aliases: s.drivers.aliases, code: s.drivers.code })
    .from(s.drivers)
    .where(exceptId ? and(eq(s.drivers.tenantId, tenantId), ne(s.drivers.id, exceptId)) : eq(s.drivers.tenantId, tenantId));
}

function values(input: DriverInput) {
  return {
    code: input.code,
    name: input.name,
    kana: input.kana,
    aliases: input.aliases,
    email: input.email,
    phone: input.phone,
    invoiceRegistered: input.invoiceRegistered,
    registrationNo: input.registrationNo,
    registrationCheckedOn: input.registrationCheckedOn,
    isCorporation: input.isCorporation,
    withholdingCategory: input.withholdingCategory,
    bankCode: input.bankCode,
    bankNameKana: input.bankNameKana,
    branchCode: input.branchCode,
    branchNameKana: input.branchNameKana,
    accountType: input.accountType,
    accountNumber: input.accountNumber,
    holderKana: input.holderKana,
    termsIssuedOn: input.termsIssuedOn,
    startedOn: input.startedOn,
    endOn: input.endOn,
    endNoticedOn: input.endNoticedOn,
    active: input.active,
    notes: input.notes,
  };
}

const KEYS = Object.keys(values({} as DriverInput)) as (keyof ReturnType<typeof values>)[];

export async function createDriver(db: Db, tenantId: string, input: DriverInput): Promise<DriverRow> {
  const conflict = findNameConflict(input, await others(db, tenantId), "ドライバー");
  if (conflict) throw fieldError(conflict.field, conflict.message);
  const [row] = await db
    .insert(s.drivers)
    .values({ tenantId, ...values(input) })
    .returning();
  return row;
}

export async function updateDriver(db: Db, tenantId: string, id: string, input: DriverInput) {
  const before = await mustGetDriver(db, tenantId, id);
  const conflict = findNameConflict(input, await others(db, tenantId, id), "ドライバー");
  if (conflict) throw fieldError(conflict.field, conflict.message);
  const next = values(input);
  const [after] = await db
    .update(s.drivers)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, id)))
    .returning();
  if (!after) throw new UserError("そのドライバーは見つかりません。一覧から開き直してください");
  return { before, after, changed: maskAccount(changes(before, next, KEYS)) };
}

/** 操作の記録（消せない表）に口座番号を残さない：下 3 桁だけにする（キーはそのまま。振込の画面が変わったことを読む） */
function maskAccount(changed: Record<string, { from: unknown; to: unknown }>) {
  const tail = (v: unknown) => (typeof v === "string" && v ? `…${v.slice(-3)}` : v);
  if (changed.accountNumber) changed.accountNumber = { from: tail(changed.accountNumber.from), to: tail(changed.accountNumber.to) };
  return changed;
}

/** 無効にする・有効に戻す（記録はそのまま残る） */
export async function setDriverActive(db: Db, tenantId: string, id: string, active: boolean) {
  const before = await mustGetDriver(db, tenantId, id);
  const [after] = await db
    .update(s.drivers)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, id)))
    .returning();
  return { before, after };
}

/**
 * 消す。稼働・明細・取引条件などの記録が 1 件でもあれば消さない（無効にするよう案内する）。
 * この人だけの単価と控除は一緒に消える（画面で先に知らせる）。
 */
export async function deleteDriver(db: Db, tenantId: string, id: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // 確かめているあいだに稼働などが足されないよう、この人の行を押さえる
    const [before] = await t
      .select()
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, id)))
      .for("update");
    if (!before) throw new UserError("そのドライバーは見つかりません。一覧から開き直してください");
    const refs = await driverReferences(t, tenantId, id);
    if (!refs.canDelete) {
      throw new UserError(
        `${before.name}さんには記録（${refs.history.join("・")}）があるので消せません。記録を残すため、「無効にする」を使ってください。`,
      );
    }
    await t.delete(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, id)));
    return { before, refs };
  });
}
