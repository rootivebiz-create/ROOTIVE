import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { ipFingerprint, randomToken, sha256 } from "~/server/tokens";

export type Role = "owner" | "staff" | "viewer";
export type SessionUser = { id: string; tenantId: string; email: string; name: string; role: Role };

import { SESSION_COOKIE } from "~/server/session-cookie";

export { SESSION_COOKIE };
const COOKIE = SESSION_COOKIE;
/** 使っていない日が続いたら切れる日数（使っている間は、1 日に 1 回まで延ばす） */
export const SESSION_IDLE_DAYS = 14;
/** 使っていても、ログインしてからこの日数で切れる（ログインし直してもらう） */
export const SESSION_MAX_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;

/**
 * ログインの期限を延ばすか（純関数）。使っている間は切れない。ただし DB の書き込みは 1 日に 1 回まで、
 * ログインしてから SESSION_MAX_DAYS を超えては延ばさない。延ばさないときは null
 */
export function renewedSessionExpiry(session: { createdAt: Date; expiresAt: Date }, now = new Date()): Date | null {
  const max = session.createdAt.getTime() + SESSION_MAX_DAYS * DAY_MS;
  const next = Math.min(now.getTime() + SESSION_IDLE_DAYS * DAY_MS, max);
  if (next - session.expiresAt.getTime() < DAY_MS) return null;
  return new Date(next);
}

/** 役割の強さ（数が大きいほど多くできる） */
const RANK: Record<Role, number> = { viewer: 1, staff: 2, owner: 3 };

export function roleAtLeast(role: Role, need: Role): boolean {
  return RANK[role] >= RANK[need];
}

export async function createSession(user: { id: string; tenantId: string }): Promise<void> {
  const db = await getDb();
  const token = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_IDLE_DAYS * DAY_MS);
  await db.insert(s.sessions).values({ id: sha256(token), userId: user.id, tenantId: user.tenantId, expiresAt });
  const jar = await cookies();
  // クッキーはいちばん長い期限まで残し、切れたかどうかは DB の期限で決める（使っている間は DB の期限を延ばす）
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(now + SESSION_MAX_DAYS * DAY_MS),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(s.sessions).where(eq(s.sessions.id, sha256(token)));
  }
  jar.delete(COOKIE);
}

/** いまのログイン中の人（いなければ null）。使っている間は、ログインの期限を延ばす（1 日に 1 回まで） */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const now = new Date();
  const sessionId = sha256(token);
  const rows = await db
    .select({
      id: s.users.id,
      tenantId: s.users.tenantId,
      email: s.users.email,
      name: s.users.name,
      role: s.users.role,
      sessionCreatedAt: s.sessions.createdAt,
      sessionExpiresAt: s.sessions.expiresAt,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, sessionId), gt(s.sessions.expiresAt, now), isNull(s.users.disabledAt)))
    .limit(1);
  const u = rows[0];
  if (!u) return null;
  const renewed = renewedSessionExpiry({ createdAt: u.sessionCreatedAt, expiresAt: u.sessionExpiresAt }, now);
  if (renewed) await db.update(s.sessions).set({ expiresAt: renewed }).where(eq(s.sessions.id, sessionId));
  return { id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role as Role };
}

/** 画面用：ログインしていなければログイン画面へ（デモは自分専用の架空の会社を作る画面へ）。役割が足りなければ「権限がありません」 */
export async function requirePageUser(need: Role = "viewer"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(process.env.DEMO_MODE === "1" ? "/demo/start" : "/login");
  if (!roleAtLeast(user.role, need)) redirect("/forbidden");
  return user;
}

export class AuthError extends Error {}

/**
 * サーバーの処理用：ログインと役割を確かめる（画面で隠していても、ここで必ず止める）。
 * 読むだけの処理（ダウンロードなど）は readOnly: true にすると、デモの「保存できない」設定でも通る
 */
export async function requireUser(need: Role = "viewer", opts: { readOnly?: boolean } = {}): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("ログインしてください");
  if (!roleAtLeast(user.role, need)) throw new AuthError("この操作をする権限がありません");
  if (!opts.readOnly && need !== "viewer" && process.env.DEMO_MODE === "1" && process.env.DEMO_READONLY === "1") {
    throw new AuthError("デモでは保存できません");
  }
  return user;
}

/** 招待リンクの値を作る（保存はハッシュだけ） */
export async function createInvite(tenantId: string, email: string, name: string, role: Role): Promise<string> {
  const db = await getDb();
  const token = randomToken();
  await db.insert(s.invites).values({
    tokenHash: sha256(token),
    tenantId,
    email: email.trim().toLowerCase(),
    name: name.trim(),
    role,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });
  return token;
}

/** 接続元の目印（鍵つきハッシュ。IP そのものは残さない。server/tokens.ts の ipFingerprint） */
export async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "").slice(0, 100);
  return ip ? ipFingerprint(ip) : null;
}
