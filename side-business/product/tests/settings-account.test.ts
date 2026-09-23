import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { audit } from "~/server/audit";
import {
  changeOwnPassword,
  loadAccount,
  PASSWORD_MIN,
  passwordChangeSchema,
  recentLogins,
  RECENT_LOGINS,
  sessionIdFromToken,
  signOutOtherSessions,
} from "~/server/features/settings/account";
import { firstIssue } from "~/server/features/settings/errors";
import { hashPassword, passwordProblem, verifyPassword } from "~/server/password";
import { seedDemo } from "~/server/seed-demo";
import { sha256 } from "~/server/tokens";
import { createTestDb } from "./helpers/db";

/**
 * 自分のアカウント：パスワードの変更（今のパスワードが要る）・ほかの端末からのログアウト（いまの端末は残す）・最近のログイン。
 * 会社（tenant）と本人で絞り、別の会社・別の人のログインやパスワードには触らないことも確かめる。
 */

let db: Db;
let client: PGlite;
let A: string;
let B: string;
type U = typeof s.users.$inferSelect;
let staffA: U;
let ownerA: U;
let staffB: U;

const OLD = "むかしのパスワード 2026";
const NEW = "あたらしい長めの合言葉 です";
const HOUR = 3600_000;

async function userOf(tenantId: string, role: string) {
  const [u] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, role)));
  return u;
}
async function addSession(u: U, token: string, expiresInMs = 24 * HOUR) {
  await db.insert(s.sessions).values({ id: sha256(token), userId: u.id, tenantId: u.tenantId, expiresAt: new Date(Date.now() + expiresInMs) });
}
async function sessionIds(userId: string) {
  return (await db.select({ id: s.sessions.id }).from(s.sessions).where(eq(s.sessions.userId, userId))).map((r) => r.id).sort();
}
async function hashOf(userId: string) {
  const [u] = await db.select({ h: s.users.passwordHash }).from(s.users).where(eq(s.users.id, userId));
  return u.h;
}
async function failure(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return firstIssue(e);
  }
}
const input = (current: string, next: string, confirm = next) => passwordChangeSchema.parse({ current, next, confirm });

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  A = (await seedDemo(db)).tenantId;
  B = (await seedDemo(db)).tenantId;
  staffA = await userOf(A, "staff");
  ownerA = await userOf(A, "owner");
  staffB = await userOf(B, "staff");
  // デモの利用者にはパスワードが無いので、ここで決めておく
  for (const u of [staffA, staffB]) await db.update(s.users).set({ passwordHash: await hashPassword(OLD) }).where(eq(s.users.id, u.id));
  // A の事務：いまの端末 1 つ・ほかの端末 2 つ・期限切れ 1 つ。A のオーナーと B の事務にも 1 つずつ
  await addSession(staffA, "a-current");
  await addSession(staffA, "a-phone");
  await addSession(staffA, "a-pc");
  await addSession(staffA, "a-expired", -HOUR);
  await addSession(ownerA, "a-owner");
  await addSession(staffB, "b-staff");
});
afterAll(async () => client.close());

describe("自分のアカウント", () => {
  it("いまの端末のセッションは、クッキーの値の sha256。値が無ければ null", () => {
    expect(sessionIdFromToken("abc")).toBe(sha256("abc"));
    expect(sessionIdFromToken(undefined)).toBeNull();
    expect(sessionIdFromToken("")).toBeNull();
  });

  it("パスワードの最低の長さは passwordProblem とそろっている", () => {
    expect(passwordProblem("x".repeat(PASSWORD_MIN - 1))).not.toBeNull();
    expect(passwordProblem("x".repeat(PASSWORD_MIN))).toBeNull();
  });

  it("画面の中身：ログイン中の端末（期限切れは出さない・いまの端末が先頭）。セッションの id は渡さない", async () => {
    const a = await loadAccount(db, A, staffA.id, sessionIdFromToken("a-current"));
    expect(a).toMatchObject({ name: staffA.name, email: staffA.email, role: "staff", hasPassword: true });
    expect(a.sessions).toHaveLength(3);
    expect(a.sessions[0].current).toBe(true);
    expect(a.sessions.filter((x) => x.current)).toHaveLength(1);
    expect(JSON.stringify(a)).not.toContain(sha256("a-phone"));
  });

  it("今のパスワードが違うと変えない（ログインもそのまま）", async () => {
    const before = await sessionIds(staffA.id);
    expect(await failure(changeOwnPassword(db, A, staffA.id, input("ちがうパスワードです!!", NEW), sessionIdFromToken("a-current")))).toBe("今のパスワードが違います");
    expect(await verifyPassword(OLD, await hashOf(staffA.id))).toBe(true);
    expect(await sessionIds(staffA.id)).toEqual(before);
  });

  it("新しいパスワードの決まり：短い・確かめの欄と違う・今と同じ は止める", async () => {
    const sid = sessionIdFromToken("a-current");
    expect(await failure(changeOwnPassword(db, A, staffA.id, input(OLD, "みじかい"), sid))).toContain("10 文字以上");
    expect(await failure(changeOwnPassword(db, A, staffA.id, input(OLD, NEW, `${NEW}!`), sid))).toContain("確かめの欄と合っていません");
    expect(await failure(changeOwnPassword(db, A, staffA.id, input(OLD, OLD), sid))).toContain("今と同じ");
    expect(await verifyPassword(OLD, await hashOf(staffA.id))).toBe(true);
  });

  it("別の会社の人のパスワードは変えられない（B の事務のパスワード・ログインはそのまま）", async () => {
    expect(await failure(changeOwnPassword(db, A, staffB.id, input(OLD, NEW), null))).toContain("利用者が見つかりません");
    expect(await failure(signOutOtherSessions(db, A, staffB.id, null))).toContain("利用者が見つかりません");
    await expect(loadAccount(db, A, staffB.id, null)).rejects.toThrow("利用者が見つかりません");
    expect(await verifyPassword(OLD, await hashOf(staffB.id))).toBe(true);
    expect(await sessionIds(staffB.id)).toEqual([sha256("b-staff")]);
  });

  it("変えると、ほかの端末のログインは切れ、いまの端末は残る。ほかの人のログインは切らない", async () => {
    const r = await changeOwnPassword(db, A, staffA.id, input(OLD, NEW), sessionIdFromToken("a-current"));
    // 期限切れのものも一緒に消える（ほかの端末 2 つ ＋ 期限切れ 1 つ）
    expect(r.signedOut).toBe(3);
    const hash = await hashOf(staffA.id);
    expect(await verifyPassword(NEW, hash)).toBe(true);
    expect(await verifyPassword(OLD, hash)).toBe(false);
    expect(await sessionIds(staffA.id)).toEqual([sha256("a-current")]);
    expect(await sessionIds(ownerA.id)).toEqual([sha256("a-owner")]);
    expect(await sessionIds(staffB.id)).toEqual([sha256("b-staff")]);
  });

  it("ほかの端末からログアウト：いまの端末は残す。何度押しても、いまの端末は切れない", async () => {
    await addSession(staffA, "a-tablet");
    expect(await signOutOtherSessions(db, A, staffA.id, sessionIdFromToken("a-current"))).toBe(1);
    expect(await signOutOtherSessions(db, A, staffA.id, sessionIdFromToken("a-current"))).toBe(0);
    expect(await sessionIds(staffA.id)).toEqual([sha256("a-current")]);
    expect(await sessionIds(ownerA.id)).toEqual([sha256("a-owner")]);
  });

  it("まだパスワードが決まっていない人（招待を受ける前）は、ここでは決められない", async () => {
    expect(ownerA.passwordHash).toBeNull();
    expect(await failure(changeOwnPassword(db, A, ownerA.id, input("なんでもよい文字", NEW), sessionIdFromToken("a-owner")))).toContain("招待のリンク");
    expect(await hashOf(ownerA.id)).toBeNull();
  });

  it("最近のログイン：本人の 'login' だけ、新しい順に 10 回まで（ほかの人・別の会社・ほかの操作は出さない）", async () => {
    const base = Date.parse("2026-10-01T00:00:00Z");
    for (let i = 0; i < 12; i++) {
      await db.insert(s.auditLog).values({ tenantId: A, userId: staffA.id, action: "login", entity: "user", entityId: staffA.id, createdAt: new Date(base + i * HOUR) });
    }
    await audit(db, { tenantId: A, userId: ownerA.id, action: "login", entity: "user", entityId: ownerA.id });
    await audit(db, { tenantId: B, userId: staffB.id, action: "login", entity: "user", entityId: staffB.id });
    await audit(db, { tenantId: A, userId: staffA.id, action: "client.update", entity: "client" });
    const logins = await recentLogins(db, A, staffA.id);
    expect(logins).toHaveLength(RECENT_LOGINS);
    expect(logins[0].getTime()).toBe(base + 11 * HOUR);
    expect(logins[9].getTime()).toBe(base + 2 * HOUR);
    // 別の会社として読んでも、A の記録は出ない
    expect(await recentLogins(db, B, staffA.id)).toEqual([]);
    expect((await loadAccount(db, A, staffA.id, null)).logins).toHaveLength(RECENT_LOGINS);
  });
});
