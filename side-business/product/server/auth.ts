import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { randomToken, sha256 } from "~/server/tokens";

export type Role = "owner" | "staff" | "viewer";
export type SessionUser = { id: string; tenantId: string; email: string; name: string; role: Role };

const COOKIE = "shimebi_sid";
const SESSION_DAYS = 14;

/** 役割の強さ（数が大きいほど多くできる） */
const RANK: Record<Role, number> = { viewer: 1, staff: 2, owner: 3 };

export function roleAtLeast(role: Role, need: Role): boolean {
  return RANK[role] >= RANK[need];
}

export async function createSession(user: { id: string; tenantId: string }): Promise<void> {
  const db = await getDb();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.insert(s.sessions).values({ id: sha256(token), userId: user.id, tenantId: user.tenantId, expiresAt });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
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

/** いまのログイン中の人（いなければ null） */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: s.users.id, tenantId: s.users.tenantId, email: s.users.email, name: s.users.name, role: s.users.role })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, sha256(token)), gt(s.sessions.expiresAt, new Date()), isNull(s.users.disabledAt)))
    .limit(1);
  const u = rows[0];
  return u ? { ...u, role: u.role as Role } : null;
}

/** 画面用：ログインしていなければログイン画面へ（デモは自分専用の架空の会社を作る画面へ）。役割が足りなければ「権限がありません」 */
export async function requirePageUser(need: Role = "viewer"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(process.env.DEMO_MODE === "1" ? "/demo/start" : "/login");
  if (!roleAtLeast(user.role, need)) redirect("/forbidden");
  return user;
}

export class AuthError extends Error {}

/** サーバーの処理用：ログインと役割を確かめる（画面で隠していても、ここで必ず止める） */
export async function requireUser(need: Role = "viewer"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("ログインしてください");
  if (!roleAtLeast(user.role, need)) throw new AuthError("この操作をする権限がありません");
  if (need !== "viewer" && process.env.DEMO_MODE === "1" && process.env.DEMO_READONLY === "1") {
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

export async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  return ip ? sha256(`ip:${ip}`).slice(0, 32) : null;
}
