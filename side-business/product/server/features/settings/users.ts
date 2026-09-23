import "server-only";
import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import type { Role } from "~/server/auth";
import type { InviteInput } from "./schemas";

/**
 * 利用者（オーナーだけが変える）。消さずに「止める」（操作の記録に名前が残るため）。
 * オーナーが 1 人もいなくなる変更はしない（会社の設定・利用者の管理ができなくなるため）。
 */

export type UserItem = { id: string; name: string; email: string; role: Role; disabledAt: Date | null; createdAt: Date; hasPassword: boolean };

export async function listUsers(db: Db, tenantId: string): Promise<UserItem[]> {
  const rows = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      role: s.users.role,
      disabledAt: s.users.disabledAt,
      createdAt: s.users.createdAt,
      passwordHash: s.users.passwordHash,
    })
    .from(s.users)
    .where(eq(s.users.tenantId, tenantId))
    .orderBy(asc(s.users.createdAt));
  const rank = { owner: 0, staff: 1, viewer: 2 } as Record<string, number>;
  return rows
    .map(({ passwordHash, ...u }) => ({ ...u, role: u.role as Role, hasPassword: !!passwordHash }))
    .sort((a, b) => Number(!!a.disabledAt) - Number(!!b.disabledAt) || (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name, "ja"));
}

export type InviteItem = { tokenHash: string; name: string; email: string; role: Role; expiresAt: Date; createdAt: Date };

/** まだ使われていない、期限内の招待 */
export async function listPendingInvites(db: Db, tenantId: string, now = new Date()): Promise<InviteItem[]> {
  const rows = await db
    .select()
    .from(s.invites)
    .where(and(eq(s.invites.tenantId, tenantId), isNull(s.invites.usedAt), gt(s.invites.expiresAt, now)))
    .orderBy(desc(s.invites.createdAt));
  return rows.map((r) => ({ tokenHash: r.tokenHash, name: r.name, email: r.email, role: r.role as Role, expiresAt: r.expiresAt, createdAt: r.createdAt }));
}

const LAST_OWNER = "オーナーが 1 人もいなくなるため、変えられません。先にほかの方をオーナーにしてから変えてください。";

/**
 * 役割を変える。対象の人と、有効なオーナーの行を押さえてから数える（2 人が同時にお互いを外しても 0 人にならない）。
 */
export async function changeUserRole(db: Db, tenantId: string, targetId: string, role: Role) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [target] = await t
      .select()
      .from(s.users)
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, targetId)))
      .for("update");
    if (!target) throw new UserError("その利用者は見つかりません。画面を読み直してください");
    if (target.role === role) return { before: target, after: target, changed: false };
    if (target.role === "owner" && role !== "owner" && !target.disabledAt) {
      const others = await activeOwnersExcept(t, tenantId, targetId);
      if (others === 0) throw new UserError(LAST_OWNER);
    }
    const [after] = await t
      .update(s.users)
      .set({ role })
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, targetId)))
      .returning();
    return { before: target, after, changed: true };
  });
}

/** 止める・再開する。自分は止められない。最後のオーナーも止められない */
export async function setUserDisabled(db: Db, tenantId: string, actorId: string, targetId: string, disabled: boolean) {
  if (disabled && actorId === targetId) throw new UserError("自分自身は止められません。ほかのオーナーに頼んでください。");
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [target] = await t
      .select()
      .from(s.users)
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, targetId)))
      .for("update");
    if (!target) throw new UserError("その利用者は見つかりません。画面を読み直してください");
    if (disabled && target.role === "owner" && !target.disabledAt) {
      const others = await activeOwnersExcept(t, tenantId, targetId);
      if (others === 0) throw new UserError(LAST_OWNER);
    }
    const [after] = await t
      .update(s.users)
      .set({ disabledAt: disabled ? (target.disabledAt ?? new Date()) : null })
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, targetId)))
      .returning();
    // 止めたら、その人のログインもすぐに切る
    if (disabled) await t.delete(s.sessions).where(and(eq(s.sessions.tenantId, tenantId), eq(s.sessions.userId, targetId)));
    return { before: target, after };
  });
}

async function activeOwnersExcept(t: Db, tenantId: string, exceptId: string): Promise<number> {
  const rows = await t
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner"), isNull(s.users.disabledAt), ne(s.users.id, exceptId)))
    .for("update");
  return rows.length;
}

/**
 * 招待の前の確かめ。
 * - もう使っている人（止めていない）なら招待しない
 * - 止めている人なら、役割を招待の役割にそろえる（招待を受けると再開になる）
 * - ほかの会社で使われているメールアドレスは使えない（ログインで見分けられないため）
 * - 同じアドレスへの古い招待は無効にする
 */
export async function prepareInvite(db: Db, tenantId: string, input: InviteInput, now = new Date()): Promise<{ reactivates: boolean }> {
  const sameEmail = await db.select().from(s.users).where(eq(s.users.email, input.email));
  const here = sameEmail.find((u) => u.tenantId === tenantId);
  if (sameEmail.some((u) => u.tenantId !== tenantId)) {
    throw new UserError("このメールアドレスでは招待できません（同じアドレスがほかで使われています）。別のメールアドレスをお使いください。");
  }
  if (here && !here.disabledAt) {
    throw new UserError(`${here.name}さん（${here.email}）はもう利用者です。役割を変えるときは、一覧の「役割」から変えてください。`);
  }
  if (here) {
    await db
      .update(s.users)
      .set({ role: input.role })
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, here.id)));
  }
  await db
    .update(s.invites)
    .set({ expiresAt: now })
    .where(and(eq(s.invites.tenantId, tenantId), eq(s.invites.email, input.email), isNull(s.invites.usedAt), gt(s.invites.expiresAt, now)));
  return { reactivates: !!here };
}

/** 招待を取り消す（期限を今にする。記録は残る） */
export async function revokeInvite(db: Db, tenantId: string, tokenHash: string, now = new Date()) {
  const [row] = await db
    .update(s.invites)
    .set({ expiresAt: now })
    .where(and(eq(s.invites.tenantId, tenantId), eq(s.invites.tokenHash, tokenHash), isNull(s.invites.usedAt)))
    .returning();
  if (!row) throw new UserError("その招待は見つかりません（もう使われたか、取り消されています）。");
  return row;
}
