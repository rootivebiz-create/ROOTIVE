"use server";

import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { audit } from "~/server/audit";
import { clientIpHash, createSession } from "~/server/auth";
import { hashPassword, passwordProblem, verifyPassword } from "~/server/password";
import { tooMany } from "~/server/rate-limit";
import { sha256 } from "~/server/tokens";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const emailSchema = z.string().trim().toLowerCase().email("メールアドレスの形が正しくありません");

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = (await clientIpHash()) ?? "unknown";
  if (tooMany(`login:${ip}`, 20, 15 * 60_000) || tooMany(`login:${email}`, 10, 15 * 60_000)) {
    return { error: "何度も失敗したので、15 分ほどおいてからお試しください" };
  }
  const db = await getDb();
  // 同じメールアドレスが別の会社にもある（まとめて提供するとき）なら、パスワードが合う方に入る
  const rows = await db
    .select()
    .from(s.users)
    .where(and(eq(s.users.email, email), isNull(s.users.disabledAt)))
    .orderBy(asc(s.users.createdAt))
    .limit(10);
  let user: (typeof rows)[number] | undefined;
  for (const candidate of rows) {
    if (await verifyPassword(password, candidate.passwordHash ?? "")) {
      user = candidate;
      break;
    }
  }
  // 利用者がいなくても同じだけ時間をかける（いるかどうかを探られないように）
  if (rows.length === 0) await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!user) return { error: "メールアドレスかパスワードが違います" };
  await createSession(user);
  await audit(db, { tenantId: user.tenantId, userId: user.id, action: "login", entity: "user", entityId: user.id });
  redirect("/");
}

const setupSchema = z.object({
  company: z.string().trim().min(1, "会社名を入れてください").max(100),
  name: z.string().trim().min(1, "お名前を入れてください").max(50),
  email: emailSchema,
  password: z.string(),
});

/** 最初の 1 回だけ：会社とオーナーを作る（利用者が 1 人もいないときだけ動く） */
export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (process.env.DEMO_MODE === "1") return { error: "デモでは使えません" };
  const token = String(form.get("token") ?? "");
  const expected = process.env.SETUP_TOKEN?.trim();
  if (process.env.NODE_ENV === "production" && (!expected || token !== expected)) {
    return { error: "設定用の合言葉（SETUP_TOKEN）が違います" };
  }
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: "入力を確かめてください", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { error: problem, fieldErrors: { password: problem } };
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(s.users);
  if (n > 0) return { error: "すでに設定が済んでいます。ログイン画面からお入りください" };
  const [tenant] = await db.insert(s.tenants).values({ name: parsed.data.company }).returning();
  const [user] = await db
    .insert(s.users)
    .values({ tenantId: tenant.id, email: parsed.data.email, name: parsed.data.name, role: "owner", passwordHash: await hashPassword(parsed.data.password) })
    .returning();
  await audit(db, { tenantId: tenant.id, userId: user.id, action: "setup", entity: "tenant", entityId: tenant.id });
  await createSession(user);
  redirect("/onboarding");
}

export async function acceptInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem, fieldErrors: { password: problem } };
  const db = await getDb();
  const rows = await db
    .select()
    .from(s.invites)
    .where(and(eq(s.invites.tokenHash, sha256(token)), isNull(s.invites.usedAt), gt(s.invites.expiresAt, new Date())))
    .limit(1);
  const invite = rows[0];
  if (!invite) return { error: "招待リンクが無効か、期限が切れています。招待した方に作り直してもらってください" };
  const existing = await db.select().from(s.users).where(and(eq(s.users.tenantId, invite.tenantId), eq(s.users.email, invite.email))).limit(1);
  const passwordHash = await hashPassword(password);
  let user = existing[0];
  if (user) {
    // 招待の役割に合わせる。ただし、ほかに使えるオーナーがいないオーナーを下げることはしない
    let role = invite.role;
    if (user.role === "owner" && role !== "owner") {
      const owners = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(and(eq(s.users.tenantId, invite.tenantId), eq(s.users.role, "owner"), isNull(s.users.disabledAt)));
      if (!owners.some((o) => o.id !== user!.id)) role = "owner";
    }
    [user] = await db.update(s.users).set({ passwordHash, disabledAt: null, role }).where(eq(s.users.id, user.id)).returning();
  } else {
    [user] = await db.insert(s.users).values({ tenantId: invite.tenantId, email: invite.email, name: invite.name, role: invite.role, passwordHash }).returning();
  }
  await db.update(s.invites).set({ usedAt: new Date() }).where(eq(s.invites.tokenHash, invite.tokenHash));
  await audit(db, { tenantId: invite.tenantId, userId: user.id, action: "invite.accept", entity: "user", entityId: user.id });
  await createSession(user);
  redirect("/");
}
