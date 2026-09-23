import "server-only";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import type { Role } from "~/server/auth";
import { hashPassword, passwordProblem, verifyPassword } from "~/server/password";
import { sha256 } from "~/server/tokens";
import { fieldError } from "./errors";

/**
 * 自分のアカウント（どの役割の人も、自分のぶんだけ）：パスワードを変える・ほかの端末からログアウトする・最近のログイン。
 * 会社（tenant）と本人（userId）で必ず絞る。ほかの人のログインやパスワードには触らない。
 */

/** ログインのクッキーの名前（server/auth.ts と同じ）。いまの端末のセッションの id は、この値の sha256 */
export const SESSION_COOKIE = "shimebi_sid";

/** クッキーの値 → 保存しているセッションの id（生の値は保存していないので、ハッシュにして比べる） */
export function sessionIdFromToken(token: string | null | undefined): string | null {
  return token ? sha256(token) : null;
}

/** 操作の記録に残す名前 */
export const PASSWORD_CHANGE_ACTION = "user.password_change";
export const SIGN_OUT_OTHERS_ACTION = "user.sign_out_others";

/** パスワードの最低の長さ（server/password.ts の passwordProblem と同じ。テストでそろっていることを確かめる） */
export const PASSWORD_MIN = 10;

/** 最近のログインとして出す数 */
export const RECENT_LOGINS = 10;

export type AccountSession = { createdAt: Date; expiresAt: Date; current: boolean };

export type AccountView = {
  name: string;
  email: string;
  role: Role;
  hasPassword: boolean;
  /** ログイン中の端末（期限内のもの。新しい順。いまの端末に current） */
  sessions: AccountSession[];
  /** 最近のログイン（新しい順・最大 10 件） */
  logins: Date[];
};

async function mustGetUser(db: Db, tenantId: string, userId: string) {
  const [u] = await db
    .select()
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, userId)))
    .limit(1);
  if (!u) throw new UserError("利用者が見つかりません。ログインし直してください");
  return u;
}

export async function loadAccount(db: Db, tenantId: string, userId: string, currentSessionId: string | null, now = new Date()): Promise<AccountView> {
  const u = await mustGetUser(db, tenantId, userId);
  const [sessions, logins] = await Promise.all([
    db
      .select({ id: s.sessions.id, createdAt: s.sessions.createdAt, expiresAt: s.sessions.expiresAt })
      .from(s.sessions)
      .where(and(eq(s.sessions.tenantId, tenantId), eq(s.sessions.userId, userId), gt(s.sessions.expiresAt, now)))
      .orderBy(desc(s.sessions.createdAt)),
    recentLogins(db, tenantId, userId),
  ]);
  return {
    name: u.name,
    email: u.email,
    role: u.role as Role,
    hasPassword: !!u.passwordHash,
    // セッションの id（クッキーのハッシュ）は画面へ渡さない。いまの端末かどうかだけ
    sessions: sessions
      .map((x) => ({ createdAt: x.createdAt, expiresAt: x.expiresAt, current: x.id === currentSessionId }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt.getTime() - a.createdAt.getTime()),
    logins,
  };
}

/** 最近のログイン（操作の記録の 'login'。新しい順） */
export async function recentLogins(db: Db, tenantId: string, userId: string, limit = RECENT_LOGINS): Promise<Date[]> {
  const rows = await db
    .select({ at: s.auditLog.createdAt })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.userId, userId), eq(s.auditLog.action, "login")))
    .orderBy(desc(s.auditLog.id))
    .limit(limit);
  return rows.map((r) => r.at);
}

/** パスワードの変更の入力（確かめは changeOwnPassword の中で、項目ごとに日本語で返す） */
export const passwordChangeSchema = z.object({
  current: z.string({ error: "今のパスワードを入れてください" }).min(1, "今のパスワードを入れてください").max(200),
  next: z.string({ error: "新しいパスワードを入れてください" }).min(1, "新しいパスワードを入れてください"),
  confirm: z.string({ error: "新しいパスワードをもう一度入れてください" }).min(1, "新しいパスワードをもう一度入れてください"),
});
export type PasswordChangeInput = z.output<typeof passwordChangeSchema>;

/**
 * 自分のパスワードを変える。今のパスワードが合わなければ変えない。
 * 変えたら、ほかの端末のログインは切る（いまの端末はそのまま）。切った数を返す。
 */
export async function changeOwnPassword(db: Db, tenantId: string, userId: string, input: PasswordChangeInput, currentSessionId: string | null): Promise<{ signedOut: number }> {
  const u = await mustGetUser(db, tenantId, userId);
  if (!u.passwordHash) throw new UserError("まだパスワードが決まっていません。招待のリンクから決めてください（リンクが切れていたら、オーナーに作り直してもらってください）");
  if (!(await verifyPassword(input.current, u.passwordHash))) throw fieldError("current", "今のパスワードが違います");
  const problem = passwordProblem(input.next);
  if (problem) throw fieldError("next", problem);
  if (input.next !== input.confirm) throw fieldError("confirm", "新しいパスワードが、確かめの欄と合っていません。同じものを 2 回入れてください");
  if (input.next.normalize("NFKC") === input.current.normalize("NFKC")) throw fieldError("next", "今と同じパスワードです。別のものにしてください");
  const passwordHash = await hashPassword(input.next);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t
      .update(s.users)
      .set({ passwordHash })
      .where(and(eq(s.users.tenantId, tenantId), eq(s.users.id, userId)));
    const signedOut = await deleteOtherSessions(t, tenantId, userId, currentSessionId);
    return { signedOut };
  });
}

/** ほかの端末からログアウトする（いまの端末のログインは残す）。切った数を返す */
export async function signOutOtherSessions(db: Db, tenantId: string, userId: string, currentSessionId: string | null): Promise<number> {
  await mustGetUser(db, tenantId, userId);
  return deleteOtherSessions(db, tenantId, userId, currentSessionId);
}

async function deleteOtherSessions(db: Db, tenantId: string, userId: string, currentSessionId: string | null): Promise<number> {
  const mine = and(eq(s.sessions.tenantId, tenantId), eq(s.sessions.userId, userId));
  const rows = await db
    .delete(s.sessions)
    .where(currentSessionId ? and(mine, ne(s.sessions.id, currentSessionId)) : mine)
    .returning({ id: s.sessions.id });
  return rows.length;
}
