import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { changes, countWhere, findNameConflict } from "./common";
import { fieldError } from "./errors";
import type { ClientInput } from "./schemas";

/**
 * 元請（荷主）。案件や支払通知から使われている元請は消さない（元請には「無効」が無いので、案件の側を「使わない」にする）。
 */

export type ClientRow = typeof s.clients.$inferSelect;
export type ClientListItem = ClientRow & { projects: number; activeProjects: number; notices: number };

export async function listClients(db: Db, tenantId: string): Promise<ClientListItem[]> {
  const [clients, projects, notices] = await Promise.all([
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)).orderBy(asc(s.clients.name)),
    db.select({ clientId: s.projects.clientId, active: s.projects.active }).from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ clientId: s.paymentNotices.clientId }).from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId)),
  ]);
  return clients.map((c) => ({
    ...c,
    projects: projects.filter((p) => p.clientId === c.id).length,
    activeProjects: projects.filter((p) => p.clientId === c.id && p.active).length,
    notices: notices.filter((n) => n.clientId === c.id).length,
  }));
}

export async function getClient(db: Db, tenantId: string, id: string): Promise<ClientRow | null> {
  const rows = await db
    .select()
    .from(s.clients)
    .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function others(db: Db, tenantId: string, exceptId?: string) {
  return db
    .select({ id: s.clients.id, name: s.clients.name, aliases: s.clients.aliases })
    .from(s.clients)
    .where(exceptId ? and(eq(s.clients.tenantId, tenantId), ne(s.clients.id, exceptId)) : eq(s.clients.tenantId, tenantId));
}

const KEYS = ["name", "aliases", "closingDay", "notes"] as const;

export async function createClient(db: Db, tenantId: string, input: ClientInput): Promise<ClientRow> {
  const conflict = findNameConflict(input, await others(db, tenantId), "元請");
  if (conflict) throw fieldError(conflict.field, conflict.message);
  const [row] = await db
    .insert(s.clients)
    .values({ tenantId, name: input.name, aliases: input.aliases, closingDay: input.closingDay, notes: input.notes })
    .returning();
  return row;
}

export async function updateClient(db: Db, tenantId: string, id: string, input: ClientInput) {
  const before = await getClient(db, tenantId, id);
  if (!before) throw new UserError("その元請は見つかりません。一覧から開き直してください");
  const conflict = findNameConflict(input, await others(db, tenantId, id), "元請");
  if (conflict) throw fieldError(conflict.field, conflict.message);
  const next = { name: input.name, aliases: input.aliases, closingDay: input.closingDay, notes: input.notes };
  const [after] = await db
    .update(s.clients)
    .set(next)
    .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
    .returning();
  if (!after) throw new UserError("その元請は見つかりません。一覧から開き直してください");
  return { before, after, changed: changes(before, next, KEYS) };
}

/** 消す：案件と支払通知のどちらからも使われていないときだけ */
export async function deleteClient(db: Db, tenantId: string, id: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [before] = await t
      .select()
      .from(s.clients)
      .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
      .for("update");
    if (!before) throw new UserError("その元請は見つかりません。一覧から開き直してください");
    const [projects, notices] = await Promise.all([
      countWhere(t, s.projects, and(eq(s.projects.tenantId, tenantId), eq(s.projects.clientId, id))),
      countWhere(t, s.paymentNotices, and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.clientId, id))),
    ]);
    if (projects || notices) {
      const what = [projects && `案件 ${projects}件`, notices && `支払通知 ${notices}件`].filter(Boolean).join("・");
      throw new UserError(
        `「${before.name}」は ${what} から使われているので消せません。使わなくなったときは、その案件を「使わない」にすれば、取り込みの候補に出なくなります。`,
      );
    }
    await t.delete(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)));
    return { before };
  });
}
