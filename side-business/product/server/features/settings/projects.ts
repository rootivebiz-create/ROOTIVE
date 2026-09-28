import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { changes, countWhere, findNameConflict } from "./common";
import { fieldError } from "./errors";
import { looseKey, type ProjectInput } from "./schemas";

/**
 * 案件（元請 × 仕事の種類）と標準の単価。受注単価は突合と利益、支払単価は明細に使う。
 * 稼働・支払通知・明細で使われた案件は消さずに「使わない」にする。
 */

export type ProjectRow = typeof s.projects.$inferSelect;
export type ProjectListItem = ProjectRow & { clientName: string | null; overrides: number };
export type ProjectFilter = { q?: string; clientId?: string; status?: "active" | "inactive" | "all" };

export async function listProjects(db: Db, tenantId: string, filter: ProjectFilter = {}): Promise<ProjectListItem[]> {
  const [projects, clients, overrides] = await Promise.all([
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)).orderBy(asc(s.projects.name)),
    db.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select({ projectId: s.rateOverrides.projectId }).from(s.rateOverrides).where(eq(s.rateOverrides.tenantId, tenantId)),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const key = looseKey(filter.q ?? "");
  const status = filter.status ?? "all";
  return projects
    .map((p) => ({
      ...p,
      clientName: p.clientId ? (clientName.get(p.clientId) ?? null) : null,
      overrides: overrides.filter((o) => o.projectId === p.id).length,
    }))
    .filter((p) => {
      if (status === "active" && !p.active) return false;
      if (status === "inactive" && p.active) return false;
      if (filter.clientId === "none" && p.clientId) return false;
      if (filter.clientId && filter.clientId !== "none" && p.clientId !== filter.clientId) return false;
      if (!key) return true;
      return [p.name, p.clientName ?? "", p.unit, ...p.aliases].some((v) => looseKey(v).includes(key));
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.clientName ?? "").localeCompare(b.clientName ?? "", "ja") || a.name.localeCompare(b.name, "ja"));
}

export async function getProject(db: Db, tenantId: string, id: string): Promise<ProjectRow | null> {
  const rows = await db
    .select()
    .from(s.projects)
    .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** この案件を使っている記録の数 */
export async function projectReferences(db: Db, tenantId: string, id: string) {
  const inLines = JSON.stringify([{ projectId: id }]);
  const [work, noticeLines, reconItems, statements, versions, overrides] = await Promise.all([
    countWhere(db, s.workEntries, and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.projectId, id))),
    countWhere(db, s.paymentNoticeLines, and(eq(s.paymentNoticeLines.tenantId, tenantId), eq(s.paymentNoticeLines.projectId, id))),
    countWhere(db, s.reconciliationItems, and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.projectId, id))),
    countWhere(db, s.statements, and(eq(s.statements.tenantId, tenantId), sql`${s.statements.snapshot} -> 'lines' @> ${inLines}::jsonb`)),
    countWhere(db, s.statementVersions, and(eq(s.statementVersions.tenantId, tenantId), sql`${s.statementVersions.snapshot} -> 'lines' @> ${inLines}::jsonb`)),
    countWhere(db, s.rateOverrides, and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.projectId, id))),
  ]);
  const history = [
    work && `稼働 ${work}件`,
    statements + versions && `支払明細 ${Math.max(statements, versions)}件`,
    noticeLines + reconItems && `元請の支払通知・突合 ${noticeLines + reconItems}件`,
  ].filter((x): x is string => typeof x === "string");
  return { history, attached: { overrides }, canDelete: history.length === 0 };
}

export type ProjectReferences = Awaited<ReturnType<typeof projectReferences>>;

async function others(db: Db, tenantId: string, exceptId?: string) {
  return db
    .select({ id: s.projects.id, name: s.projects.name, aliases: s.projects.aliases, clientId: s.projects.clientId })
    .from(s.projects)
    .where(exceptId ? and(eq(s.projects.tenantId, tenantId), ne(s.projects.id, exceptId)) : eq(s.projects.tenantId, tenantId));
}

/**
 * 元請がこの会社のものか。取引をやめた（無効の）元請は新しく結びつけない
 * （いま結びついている元請のまま直すのはよい：keepId）。
 */
async function assertClient(db: Db, tenantId: string, clientId: string | null, keepId?: string | null) {
  if (!clientId) return;
  const rows = await db
    .select({ id: s.clients.id, name: s.clients.name, active: s.clients.active })
    .from(s.clients)
    .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, clientId)))
    .limit(1);
  const c = rows[0];
  if (!c) throw fieldError("clientId", "その元請は見つかりません。選び直してください");
  if (!c.active && c.id !== keepId) {
    throw fieldError("clientId", `「${c.name}」は取引をやめた（無効の）元請です。別の元請を選ぶか、先に「元請」の画面で戻してください`);
  }
}

/** 入力欄から変える項目。「使う・使わない」は別のボタン（setProjectActive）だけで変える（画面の古い値で戻さないように） */
function values(input: ProjectInput) {
  return {
    clientId: input.clientId,
    name: input.name,
    aliases: input.aliases,
    unit: input.unit,
    billRate: input.billRate,
    payRate: input.payRate,
  };
}

const KEYS = ["clientId", "name", "aliases", "unit", "billRate", "payRate"] as const;

export async function createProject(db: Db, tenantId: string, input: ProjectInput): Promise<ProjectRow> {
  await assertClient(db, tenantId, input.clientId);
  // 案件の名前は、会社の中で見分けがつくように（取り込みは名前で当てる）
  const conflict = findNameConflict(input, await others(db, tenantId), "案件", `${input.name}（元請の名前）`);
  if (conflict) throw fieldError(conflict.field, conflict.message);
  const [row] = await db
    .insert(s.projects)
    .values({ tenantId, ...values(input), active: input.active })
    .returning();
  return row;
}

export async function updateProject(db: Db, tenantId: string, id: string, input: ProjectInput) {
  const before = await getProject(db, tenantId, id);
  if (!before) throw new UserError("その案件は見つかりません。一覧から開き直してください");
  await assertClient(db, tenantId, input.clientId, before.clientId);
  const conflict = findNameConflict(input, await others(db, tenantId, id), "案件", `${input.name}（元請の名前）`);
  if (conflict) throw fieldError(conflict.field, conflict.message);
  const next = values(input);
  const [after] = await db
    .update(s.projects)
    .set(next)
    .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.id, id)))
    .returning();
  if (!after) throw new UserError("その案件は見つかりません。一覧から開き直してください");
  return { before, after, changed: changes(before, next, KEYS) };
}

export async function setProjectActive(db: Db, tenantId: string, id: string, active: boolean) {
  const before = await getProject(db, tenantId, id);
  if (!before) throw new UserError("その案件は見つかりません。一覧から開き直してください");
  // 取引をやめた（無効の）元請の案件は、元請を戻すまで「使う」にしない（取り込みの候補に、やめた元請の案件が出ないように）
  if (active && !before.active && before.clientId) {
    const [c] = await db
      .select({ name: s.clients.name, active: s.clients.active })
      .from(s.clients)
      .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, before.clientId)))
      .limit(1);
    if (c && !c.active) {
      throw new UserError(`「${c.name}」は取引をやめた（無効の）元請です。この案件を使うときは、先に「元請」の画面で「戻す」を押してください。`);
    }
  }
  const [after] = await db
    .update(s.projects)
    .set({ active })
    .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.id, id)))
    .returning();
  return { before, after };
}

/** 消す：稼働・明細・支払通知のどれにも使われていないときだけ（ドライバー別の単価は一緒に消える） */
export async function deleteProject(db: Db, tenantId: string, id: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [before] = await t
      .select()
      .from(s.projects)
      .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.id, id)))
      .for("update");
    if (!before) throw new UserError("その案件は見つかりません。一覧から開き直してください");
    const refs = await projectReferences(t, tenantId, id);
    if (!refs.canDelete) {
      throw new UserError(`「${before.name}」は記録（${refs.history.join("・")}）で使われているので消せません。記録を残すため、「使わない」にしてください。`);
    }
    await t.delete(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.id, id)));
    return { before, refs };
  });
}

/** 記録で使われている案件の id（一覧で「消す」を出すかどうかに使う。消すときは projectReferences で確かめ直す） */
export async function usedProjectIds(db: Db, tenantId: string): Promise<Set<string>> {
  const lineProject = (col: typeof s.statements.snapshot | typeof s.statementVersions.snapshot) => sql<string>`jsonb_array_elements(${col} -> 'lines') ->> 'projectId'`;
  const [work, notice, recon, statements, versions] = await Promise.all([
    db.selectDistinct({ id: s.workEntries.projectId }).from(s.workEntries).where(eq(s.workEntries.tenantId, tenantId)),
    db.selectDistinct({ id: s.paymentNoticeLines.projectId }).from(s.paymentNoticeLines).where(eq(s.paymentNoticeLines.tenantId, tenantId)),
    db.selectDistinct({ id: s.reconciliationItems.projectId }).from(s.reconciliationItems).where(eq(s.reconciliationItems.tenantId, tenantId)),
    db.selectDistinct({ id: lineProject(s.statements.snapshot) }).from(s.statements).where(eq(s.statements.tenantId, tenantId)),
    db.selectDistinct({ id: lineProject(s.statementVersions.snapshot) }).from(s.statementVersions).where(eq(s.statementVersions.tenantId, tenantId)),
  ]);
  return new Set([...work, ...notice, ...recon, ...statements, ...versions].map((r) => r.id).filter((v): v is string => !!v));
}
