import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { buildStatementDrafts } from "~/server/calc/statement";
import { isMonthClosed, loadBuildInput } from "~/server/repo";
import { readSnapshot } from "~/server/statements-core";
import { changes, countWhere } from "./common";
import { fieldError } from "./errors";
import { looseKey, type RuleInput } from "./schemas";

/**
 * 控除のルール（ロイヤリティ・管理費・リース・保険 など）。
 * 明細に使ったルールは消さずに「使わない」にする（明細の写しが ruleId を持っているため）。
 */

export type RuleRow = typeof s.deductionRules.$inferSelect;
export type RuleListItem = RuleRow & { driverName: string | null; driverActive: boolean | null };

export async function listRules(db: Db, tenantId: string): Promise<RuleListItem[]> {
  const [rules, drivers] = await Promise.all([
    db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)).orderBy(asc(s.deductionRules.sort), asc(s.deductionRules.name)),
    db.select({ id: s.drivers.id, name: s.drivers.name, active: s.drivers.active }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
  ]);
  const driver = new Map(drivers.map((d) => [d.id, d]));
  return rules
    .map((r) => ({ ...r, driverName: r.driverId ? (driver.get(r.driverId)?.name ?? "（不明）") : null, driverActive: r.driverId ? (driver.get(r.driverId)?.active ?? false) : null }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort || a.name.localeCompare(b.name, "ja"));
}

export async function getRule(db: Db, tenantId: string, id: string): Promise<RuleRow | null> {
  const rows = await db
    .select()
    .from(s.deductionRules)
    .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** このルールを使った明細の数（写しの deductions に ruleId がある明細） */
export async function ruleReferences(db: Db, tenantId: string, id: string): Promise<number> {
  const used = JSON.stringify([{ ruleId: id }]);
  const [statements, versions] = await Promise.all([
    countWhere(db, s.statements, and(eq(s.statements.tenantId, tenantId), sql`${s.statements.snapshot} -> 'deductions' @> ${used}::jsonb`)),
    countWhere(db, s.statementVersions, and(eq(s.statementVersions.tenantId, tenantId), sql`${s.statementVersions.snapshot} -> 'deductions' @> ${used}::jsonb`)),
  ]);
  return Math.max(statements, versions);
}

async function assertDriver(db: Db, tenantId: string, driverId: string | null) {
  if (!driverId) return;
  const rows = await db
    .select({ id: s.drivers.id })
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, driverId)))
    .limit(1);
  if (!rows[0]) throw fieldError("driverId", "そのドライバーは見つかりません。選び直してください");
}

/**
 * 同じ名前・同じ当て先（全員／同じ人）の、使っている控除を探す（二重に引かないように）。
 */
async function findDuplicate(db: Db, tenantId: string, rule: { name: string; driverId: string | null; active: boolean }, exceptId?: string) {
  if (!rule.active) return null;
  const rows = await db
    .select({ id: s.deductionRules.id, name: s.deductionRules.name, driverId: s.deductionRules.driverId, active: s.deductionRules.active })
    .from(s.deductionRules)
    .where(eq(s.deductionRules.tenantId, tenantId));
  const key = looseKey(rule.name);
  return rows.find((r) => r.id !== exceptId && r.active && r.driverId === rule.driverId && looseKey(r.name) === key) ?? null;
}

async function assertNoDuplicate(db: Db, tenantId: string, input: RuleInput, exceptId?: string) {
  const hit = await findDuplicate(db, tenantId, input, exceptId);
  if (hit) {
    throw fieldError(
      "name",
      `同じ名前の控除「${hit.name}」（${input.driverId ? "この人だけ" : "全員"}）がすでにあります。二重に引かれないよう、そちらを直すか、名前を変えてください`,
    );
  }
}

/** 入力欄から変える項目。「使う・使わない」は別のボタン（setRuleActive）だけで変える（画面の古い値で戻さないように） */
function values(input: RuleInput) {
  return {
    driverId: input.driverId,
    name: input.name,
    kind: input.kind,
    rate: input.rate,
    amount: input.amount,
    onlyWhenWorked: input.onlyWhenWorked,
    taxable: input.taxable,
    agreedInWriting: input.agreedInWriting,
    agreedOn: input.agreedOn,
    basis: input.basis,
    sort: input.sort,
  };
}

const KEYS = ["driverId", "name", "kind", "rate", "amount", "onlyWhenWorked", "taxable", "agreedInWriting", "agreedOn", "basis", "sort"] as const;

export async function createRule(db: Db, tenantId: string, input: RuleInput): Promise<RuleRow> {
  await assertDriver(db, tenantId, input.driverId);
  await assertNoDuplicate(db, tenantId, input);
  const [row] = await db
    .insert(s.deductionRules)
    .values({ tenantId, ...values(input), active: input.active })
    .returning();
  return row;
}

export async function updateRule(db: Db, tenantId: string, id: string, input: RuleInput) {
  const before = await getRule(db, tenantId, id);
  if (!before) throw new UserError("その控除は見つかりません。一覧から開き直してください");
  await assertDriver(db, tenantId, input.driverId);
  // 重なりは、いまの「使う・使わない」で確かめる（入力欄の値ではなく）
  await assertNoDuplicate(db, tenantId, { ...input, active: before.active }, id);
  const next = values(input);
  const [after] = await db
    .update(s.deductionRules)
    .set(next)
    .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.id, id)))
    .returning();
  if (!after) throw new UserError("その控除は見つかりません。一覧から開き直してください");
  return { before, after, changed: changes(before, next, KEYS) };
}

export async function setRuleActive(db: Db, tenantId: string, id: string, active: boolean) {
  const before = await getRule(db, tenantId, id);
  if (!before) throw new UserError("その控除は見つかりません。一覧から開き直してください");
  if (active && (await findDuplicate(db, tenantId, { name: before.name, driverId: before.driverId, active: true }, id))) {
    throw new UserError(`同じ名前の「${before.name}」を使っているので、戻すと二重に引かれます。先にそちらを「使わない」にしてください。`);
  }
  const [after] = await db
    .update(s.deductionRules)
    .set({ active })
    .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.id, id)))
    .returning();
  return { before, after };
}

/** 消す：明細に使ったことが無いときだけ（使ったものは「使わない」にする） */
export async function deleteRule(db: Db, tenantId: string, id: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [before] = await t
      .select()
      .from(s.deductionRules)
      .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.id, id)))
      .for("update");
    if (!before) throw new UserError("その控除は見つかりません。一覧から開き直してください");
    const used = await ruleReferences(t, tenantId, id);
    if (used > 0) {
      throw new UserError(`「${before.name}」は支払明細 ${used}件で使われているので消せません。明細の記録を残すため、「使わない」にしてください。`);
    }
    await t.delete(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.id, id)));
    return { before };
  });
}

export type RuleImpact = { drivers: number; total: number; names: string[] };

/**
 * その月に、ルールごとに何人・いくら引かれるか。
 * - 締めた月：保存した明細の写し（締めたときの中身）から数える
 * - まだの月：いまの稼働と設定で明細の計算（buildStatementDrafts）をして数える
 * 画面で独自に計算しない（明細と同じ計算の結果を数えるだけ）。
 */
export async function ruleImpact(db: Db, tenantId: string, month: string): Promise<Map<string, RuleImpact>> {
  return (await ruleImpactOfMonth(db, tenantId, month)).byRule;
}

export type MonthRuleImpact = {
  /** 締めた月か（締めた月は明細の写しから数える） */
  closed: boolean;
  /** 数えた明細の数（締めた月で 0 なら、写しが残っていない） */
  statements: number;
  byRule: Map<string, RuleImpact>;
};

/** ruleImpact に、締めた月か・明細が何件あったかを添えたもの（画面の説明に使う） */
export async function ruleImpactOfMonth(db: Db, tenantId: string, month: string): Promise<MonthRuleImpact> {
  const closed = await isMonthClosed(db, tenantId, month);
  const drafts = closed
    ? (await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)))).map(readSnapshot)
    : buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  const byRule = new Map<string, RuleImpact>();
  for (const d of drafts) {
    for (const x of d.deductions ?? []) {
      const cur = byRule.get(x.ruleId) ?? { drivers: 0, total: 0, names: [] };
      cur.drivers += 1;
      cur.total += x.amount;
      cur.names.push(d.driver?.name ?? "");
      byRule.set(x.ruleId, cur);
    }
  }
  return { closed, statements: drafts.length, byRule };
}

/** 明細に使ったことのある控除のルールの id（一覧で「消す」を出すかどうかに使う） */
export async function usedRuleIds(db: Db, tenantId: string): Promise<Set<string>> {
  const ruleId = (col: typeof s.statements.snapshot | typeof s.statementVersions.snapshot) => sql<string>`jsonb_array_elements(${col} -> 'deductions') ->> 'ruleId'`;
  const [statements, versions] = await Promise.all([
    db.selectDistinct({ id: ruleId(s.statements.snapshot) }).from(s.statements).where(eq(s.statements.tenantId, tenantId)),
    db.selectDistinct({ id: ruleId(s.statementVersions.snapshot) }).from(s.statementVersions).where(eq(s.statementVersions.tenantId, tenantId)),
  ]);
  return new Set([...statements, ...versions].map((r) => r.id).filter((v): v is string => !!v));
}
