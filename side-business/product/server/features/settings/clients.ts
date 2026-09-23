import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { changes, countWhere, findNameConflict } from "./common";
import { fieldError } from "./errors";
import { looseKey } from "./format";
import type { ClientInput } from "./schemas";

/**
 * 元請（荷主）。案件や支払通知から使われている元請は消さない。
 * 取引をやめた元請は「無効」にする（過去の案件・お支払通知・明細はそのまま残る。選ぶところには出さない）。
 */

export type ClientRow = typeof s.clients.$inferSelect;
export type ClientListItem = ClientRow & { projects: number; activeProjects: number; notices: number };

/** 一覧（既定はすべて。無効の元請も含む）。有効な元請 → 名前の順 */
export async function listClients(db: Db, tenantId: string, opts: { status?: "active" | "inactive" | "all" } = {}): Promise<ClientListItem[]> {
  const [clients, projects, notices] = await Promise.all([
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select({ clientId: s.projects.clientId, active: s.projects.active }).from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ clientId: s.paymentNotices.clientId }).from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId)),
  ]);
  const status = opts.status ?? "all";
  return clients
    .filter((c) => status === "all" || (status === "active" ? c.active : !c.active))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ja"))
    .map((c) => ({
      ...c,
      projects: projects.filter((p) => p.clientId === c.id).length,
      activeProjects: projects.filter((p) => p.clientId === c.id && p.active).length,
      notices: notices.filter((n) => n.clientId === c.id).length,
    }));
}

/**
 * 元請を選ぶところ（案件の入力など）の候補：有効な元請だけ。
 * ただし、いま選ばれている元請（keepId）が無効なら、それだけは「（取引をやめた元請）」を付けて残す
 * （直すときに、知らないうちに元請が外れないように）。
 */
export function clientPickerOptions(
  clients: readonly { id: string; name: string; active: boolean }[],
  keepId?: string | null,
): { id: string; name: string }[] {
  return clients
    .filter((c) => c.active || c.id === keepId)
    .map((c) => ({ id: c.id, name: c.active ? c.name : `${c.name}（取引をやめた元請）` }));
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
    .select({ id: s.clients.id, name: s.clients.name, aliases: s.clients.aliases, active: s.clients.active })
    .from(s.clients)
    .where(exceptId ? and(eq(s.clients.tenantId, tenantId), ne(s.clients.id, exceptId)) : eq(s.clients.tenantId, tenantId));
}

const KEYS = ["name", "aliases", "closingDay", "notes"] as const;

export async function createClient(db: Db, tenantId: string, input: ClientInput): Promise<ClientRow> {
  const all = await others(db, tenantId);
  // 取引をやめた元請と同じ名前なら、作り直さずに「戻す」を案内する（過去の案件・支払通知がそちらに付いているため）
  const stopped = all.find((o) => !o.active && looseKey(o.name) === looseKey(input.name));
  if (stopped) {
    throw fieldError("name", `「${stopped.name}」は、取引をやめた元請として残っています。また取引するときは、下の「無効の元請」から「戻す」を押してください`);
  }
  const conflict = findNameConflict(input, all, "元請");
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

/** 「取引をやめる」「戻す」のあとの知らせ（URL の ?done=off|on&id=…&n=案件の数）。元請が一覧の間を移るので、上に出す */
export type ClientsDone = { kind: "on" | "off"; id: string; projects: number };

export function clientsDoneHref(kind: "on" | "off", id: string, projects: number): string {
  const qs = new URLSearchParams({ done: kind, id, n: String(Math.max(0, Math.trunc(projects))) });
  return `/settings/clients?${qs.toString()}`;
}

/** URL の値を読む（形が違えば null。id がこの会社の元請かは、画面が一覧から探して確かめる） */
export function readClientsDone(sp: { done?: string; id?: string; n?: string }): ClientsDone | null {
  if (sp.done !== "on" && sp.done !== "off") return null;
  if (!sp.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sp.id)) return null;
  const n = /^\d{1,4}$/.test(sp.n ?? "") ? Number(sp.n) : 0;
  return { kind: sp.done, id: sp.id, projects: n };
}

export function clientsDoneMessage(done: ClientsDone, name: string): string {
  if (done.kind === "on") {
    return `「${name}」を、取引している元請に戻しました。${done.projects ? `案件 ${done.projects}件も「使う」に戻しました。` : ""}案件の元請を選ぶところにも、また出ます。`;
  }
  return `「${name}」を取引をやめた元請にしました。${done.projects ? `案件 ${done.projects}件も「使わない」にしました。` : ""}下の「無効の元請」に移しています。過去の記録はそのまま残り、「戻す」でいつでも元に戻せます。`;
}

/** 取引をやめたときに一緒に「使わない」にした案件（戻すときに、その案件だけを戻す）。操作の記録に残す名前 */
export const CLIENT_DEACTIVATE_ACTION = "client.deactivate";
export const CLIENT_ACTIVATE_ACTION = "client.activate";

/**
 * 取引をやめる（無効にする）。記録は消さない。
 * withProjects のとき、この元請の「使っている」案件も「使わない」にする（取り込みの候補に出なくなる）。
 * 戻すときのために、「使わない」にした案件の id を返す（操作の記録に残す）。
 */
export async function deactivateClient(db: Db, tenantId: string, id: string, opts: { withProjects: boolean }) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [before] = await t
      .select()
      .from(s.clients)
      .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
      .for("update");
    if (!before) throw new UserError("その元請は見つかりません。一覧から開き直してください");
    if (!before.active) throw new UserError(`「${before.name}」はもう無効になっています。画面を読み直してください`);
    const [after] = await t
      .update(s.clients)
      .set({ active: false })
      .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
      .returning();
    const projectIds = opts.withProjects
      ? (
          await t
            .update(s.projects)
            .set({ active: false })
            .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.clientId, id), eq(s.projects.active, true)))
            .returning({ id: s.projects.id })
        ).map((p) => p.id)
      : [];
    return { before, after, projectIds };
  });
}

/**
 * 無効にした元請を戻す。withProjects のとき、取引をやめたときに一緒に「使わない」にした案件だけを戻す
 * （それより前から「使わない」だった案件は戻さない）。どれを戻すかは、最後に無効にしたときの操作の記録から読む。
 */
export async function restoreClient(db: Db, tenantId: string, id: string, opts: { withProjects: boolean }) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [before] = await t
      .select()
      .from(s.clients)
      .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
      .for("update");
    if (!before) throw new UserError("その元請は見つかりません。一覧から開き直してください");
    if (before.active) throw new UserError(`「${before.name}」はもう有効です。画面を読み直してください`);
    const [after] = await t
      .update(s.clients)
      .set({ active: true })
      .where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)))
      .returning();
    let projectIds: string[] = [];
    if (opts.withProjects) {
      const ids = await projectsTurnedOffWith(t, tenantId, id);
      if (ids.length) {
        projectIds = (
          await t
            .update(s.projects)
            .set({ active: true })
            .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.clientId, id), inArray(s.projects.id, ids)))
            .returning({ id: s.projects.id })
        ).map((p) => p.id);
      }
    }
    return { before, after, projectIds };
  });
}

/** 最後に「取引をやめる」にしたとき、一緒に「使わない」にした案件の id（記録が無ければ空） */
export async function projectsTurnedOffWith(db: Db, tenantId: string, clientId: string): Promise<string[]> {
  const [row] = await db
    .select({ detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, CLIENT_DEACTIVATE_ACTION), eq(s.auditLog.entityId, clientId)))
    .orderBy(desc(s.auditLog.id))
    .limit(1);
  const ids = (row?.detail as { projectIds?: unknown } | undefined)?.projectIds;
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) : [];
}

/** 戻すときに一緒に戻せる案件の数（やめたときに一緒に「使わない」にして、今も「使わない」のもの） */
export async function restorableProjectCount(db: Db, tenantId: string, clientId: string): Promise<number> {
  const ids = await projectsTurnedOffWith(db, tenantId, clientId);
  if (!ids.length) return 0;
  const rows = await db
    .select({ id: s.projects.id })
    .from(s.projects)
    .where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.clientId, clientId), eq(s.projects.active, false), inArray(s.projects.id, ids)));
  return rows.length;
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
        `「${before.name}」は ${what} から使われているので消せません。取引をやめたときは「取引をやめる（無効にする）」を使ってください。記録はそのまま残ります。`,
      );
    }
    await t.delete(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, id)));
    return { before };
  });
}
