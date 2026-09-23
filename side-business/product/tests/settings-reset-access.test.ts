import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { auditLabel } from "~/server/features/close";
import {
  formatAccessList,
  formatResetResult,
  listAccessUsers,
  normalizeBaseUrl,
  parseResetArgs,
  RESET_DEFAULT_HOURS,
  RESET_VIA,
  ResetAccessError,
  resetAccess,
  resetLink,
} from "~/server/features/settings/reset-access";
import { verifyPassword } from "~/server/password";
import { seedDemo } from "~/server/seed-demo";
import { sha256 } from "~/server/tokens";
import { createTestDb } from "./helpers/db";

/**
 * オーナーが入れなくなったときの入り直し（scripts/reset-access.ts）。
 * 作ったリンクが、画面の招待と同じ受け取り（acceptInviteAction）でそのまま使えることまで確かめる。
 */
const state: { db?: Db; cookies: Map<string, string> } = { cookies: new Map() };

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void state.cookies.set(name, value),
    delete: (name: string) => void state.cookies.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const NOW = new Date("2026-09-23T01:00:00Z");

describe("入り直し：コマンドの引数と表示（純関数）", () => {
  it("--email・--url・--hours・--make-owner・--sign-out・--dry-run・--tenant を読む（= でもよい）", () => {
    const { args, problems } = parseResetArgs(["--email", " Shacho@Example.JP ", "--url=https://shimebi-sample.vercel.app/login", "--hours", "４８", "--make-owner", "--sign-out", "--dry-run", "--tenant", "t-1"]);
    expect(problems).toEqual([]);
    expect(args).toEqual({
      help: false,
      list: false,
      email: "shacho@example.jp",
      tenantId: "t-1",
      hours: 48,
      url: "https://shimebi-sample.vercel.app",
      makeOwner: true,
      signOut: true,
      dryRun: true,
    });
    expect(parseResetArgs(["--list"]).args.list).toBe(true);
    expect(parseResetArgs(["-h"]).args.help).toBe(true);
    expect(parseResetArgs(["--email", "a@b.jp"]).args.hours).toBe(RESET_DEFAULT_HOURS);
  });

  it("誤りは日本語で。値の無い指定は、次の指定を値として食べない", () => {
    expect(parseResetArgs([]).problems[0]).toContain("--list か --email");
    expect(parseResetArgs(["--email", "--list"]).problems).toEqual(["--email のあとに値を書いてください"]);
    expect(parseResetArgs(["--email", "--list"]).args.list).toBe(true);
    expect(parseResetArgs(["--email", "a@b.jp", "--hours", "0"]).problems[0]).toContain("--hours は 1〜168");
    expect(parseResetArgs(["--email", "a@b.jp", "--hours", "200"]).problems[0]).toContain("--hours は 1〜168");
    expect(parseResetArgs(["--email", "a@b.jp", "--url", "http://example.com"]).problems[0]).toContain("https://");
    expect(parseResetArgs(["--email", "a@b.jp", "--oops"]).problems[0]).toContain("知らない指定です：--oops");
    expect(parseResetArgs(["--list", "--email", "a@b.jp"]).problems).toContain("--list と --email は一緒に使えません");
  });

  it("URL は https（手元は http://localhost も）で、先頭の部分だけを使う", () => {
    expect(normalizeBaseUrl("https://a.vercel.app/")).toBe("https://a.vercel.app");
    expect(normalizeBaseUrl("http://localhost:3300/x")).toBe("http://localhost:3300");
    expect(normalizeBaseUrl("http://a.vercel.app")).toBeNull();
    expect(normalizeBaseUrl("a.vercel.app")).toBeNull();
    expect(resetLink("https://a.vercel.app", "tok")).toBe("https://a.vercel.app/invite/tok");
    expect(resetLink(null, "tok")).toBe("/invite/tok");
  });
});

describe("入り直し：招待リンクを作り直す（PGlite）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherId: string;

  const user = async (tid: string, email: string) => {
    const [u] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tid), eq(s.users.email, email)));
    return u;
  };

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    state.db = db;
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherId } = await seedDemo(db)); // 同じメールアドレスの別の会社（SaaS にまとめたとき）
  });
  afterAll(async () => client.close());
  beforeEach(() => state.cookies.clear());

  it("一覧：会社ごとに、オーナーが先。パスワードのハッシュは出さない", async () => {
    const list = await listAccessUsers(db);
    const mine = list.filter((u) => u.tenantId === tenantId);
    expect(mine[0].role).toBe("owner");
    expect(mine.map((u) => u.email)).toContain("staff@demo.example");
    expect(JSON.stringify(list)).not.toContain("scrypt");
    const text = formatAccessList(list);
    expect(text).toContain(`会社の id：${tenantId}`);
    expect(text).toContain("デモ 社長  owner@demo.example  オーナー");
    expect(text).toContain("有効なオーナー 1人");
    expect(formatAccessList([])).toContain("/setup");
  });

  it("見つからない・複数の会社にある・会社が違うときは作らない", async () => {
    await expect(resetAccess(db, { email: "nobody@demo.example" })).rejects.toThrow(ResetAccessError);
    await expect(resetAccess(db, { email: "nobody@demo.example" })).rejects.toThrow("見つかりません");
    await expect(resetAccess(db, { email: "owner@demo.example" })).rejects.toThrow("2 社にあります");
    await expect(resetAccess(db, { email: "owner@demo.example", tenantId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow("指定した会社");
    await expect(resetAccess(db, { email: "owner@demo.example", tenantId, hours: 0 })).rejects.toThrow("--hours");
    await expect(resetAccess(db, { email: "  " })).rejects.toThrow("--email");
    expect(await db.select().from(s.invites)).toEqual([]);
  });

  it("試し（--dry-run）は書き込まない", async () => {
    const r = await resetAccess(db, { email: "OWNER@demo.example", tenantId, dryRun: true, now: NOW });
    expect(r.dryRun).toBe(true);
    expect(r.token).toBeNull();
    expect(r.user.name).toBe("デモ 社長");
    expect(formatResetResult(r, null)).toContain("書き込みはしていません");
    expect(await db.select().from(s.invites)).toEqual([]);
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "invite.create"))).toEqual([]);
  });

  it("オーナーのリンク：ハッシュだけを保存・期限 24 時間・古い招待は無効・操作の記録。画面の招待と同じ受け取りで新しいパスワードになる", async () => {
    const { acceptInviteAction } = await import("~/server/session-actions");
    const owner = await user(tenantId, "owner@demo.example");
    // 前に作ったまま使われていない招待（無効になる）
    await db.insert(s.invites).values({ tokenHash: sha256("old-link"), tenantId, email: owner.email, name: owner.name, role: "owner", expiresAt: new Date(Date.now() + 86_400_000) });
    // いまのログイン（--sign-out を付けないので残る）
    await db.insert(s.sessions).values({ id: sha256("owner-phone"), userId: owner.id, tenantId, expiresAt: new Date(Date.now() + 86_400_000) });

    const r = await resetAccess(db, { email: owner.email, tenantId });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(r.role).toBe("owner");
    expect(r.expiredInvites).toBe(1);
    expect(r.signedOut).toBe(0);
    expect(r.ownersAfter).toBe(1);
    expect(r.expiresAt.getTime() - Date.now()).toBeGreaterThan((RESET_DEFAULT_HOURS - 1) * 3600_000);
    expect(r.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(RESET_DEFAULT_HOURS * 3600_000);

    const invites = await db.select().from(s.invites).where(eq(s.invites.tenantId, tenantId));
    expect(invites.map((i) => i.tokenHash)).not.toContain(r.token);
    const fresh = invites.find((i) => i.tokenHash === sha256(r.token!))!;
    expect(fresh).toMatchObject({ email: owner.email, role: "owner", usedAt: null });
    const old = invites.find((i) => i.tokenHash === sha256("old-link"))!;
    expect(old.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    // ほかの会社の同じアドレスには作らない
    expect(await db.select().from(s.invites).where(eq(s.invites.tenantId, otherId))).toEqual([]);
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, owner.id))).toHaveLength(1);

    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "invite.create")));
    expect(log.userId).toBeNull();
    expect(log.detail).toMatchObject({ email: owner.email, name: owner.name, role: "owner", via: RESET_VIA, hours: RESET_DEFAULT_HOURS });
    expect(auditLabel(log.action)).toBe("利用者を招待した");

    const text = formatResetResult(r, "https://shimebi-sample.vercel.app");
    expect(text).toContain(`https://shimebi-sample.vercel.app/invite/${r.token}`);
    expect(text).toContain("1 回だけ使えます");
    expect(text).toContain("もう 1 人をオーナーに");

    // 受け取り（画面の招待と同じ処理）：新しいパスワードで入れ、オーナーのまま。リンクは 2 度使えない
    const form = new FormData();
    form.set("token", r.token!);
    form.set("password", "あたらしい長めのパスワード");
    await expect(acceptInviteAction(undefined, form)).rejects.toThrow("REDIRECT:/");
    const after = await user(tenantId, owner.email);
    expect(after.role).toBe("owner");
    expect(await verifyPassword("あたらしい長めのパスワード", after.passwordHash)).toBe(true);
    expect(state.cookies.size).toBe(1);
    expect(await acceptInviteAction(undefined, form)).toMatchObject({ error: expect.stringContaining("無効か、期限が切れています") });
  });

  it("--make-owner：止めてある事務の人をオーナーにして再開。--sign-out で、その人のログインだけを切る", async () => {
    const { acceptInviteAction } = await import("~/server/session-actions");
    const staff = await user(tenantId, "staff@demo.example");
    const owner = await user(tenantId, "owner@demo.example");
    await db.update(s.users).set({ disabledAt: new Date() }).where(eq(s.users.id, staff.id));
    await db.insert(s.sessions).values({ id: sha256("staff-pc"), userId: staff.id, tenantId, expiresAt: new Date(Date.now() + 86_400_000) });
    const ownerSessions = (await db.select().from(s.sessions).where(eq(s.sessions.userId, owner.id))).length;
    expect(ownerSessions).toBeGreaterThan(0);

    const r = await resetAccess(db, { email: staff.email, tenantId, makeOwner: true, signOut: true, hours: 2 });
    expect(r.role).toBe("owner");
    expect(r.user.disabled).toBe(true);
    expect(r.signedOut).toBe(1);
    expect(r.ownersAfter).toBe(2);
    expect(r.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 3600_000);
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, staff.id))).toEqual([]);
    // オーナーのログインは残る
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, owner.id))).toHaveLength(ownerSessions);
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "invite.create")));
    expect(logs.at(-1)!.detail).toMatchObject({ role: "owner", roleBefore: "staff", reactivates: true, signedOut: 1, via: RESET_VIA });
    const text = formatResetResult(r, null);
    expect(text).toContain("事務 → オーナー");
    expect(text).toContain(`/invite/${r.token}`);
    expect(text).toContain("先頭に、お客様のしめ日ラボの URL");
    expect(text).toContain("再開になります");
    expect(text).not.toContain("もう 1 人をオーナーに");

    const form = new FormData();
    form.set("token", r.token!);
    form.set("password", "事務の人の新しいパスワード");
    await expect(acceptInviteAction(undefined, form)).rejects.toThrow("REDIRECT:/");
    const after = await user(tenantId, staff.email);
    expect(after.role).toBe("owner");
    expect(after.disabledAt).toBeNull();
  });
});

describe("入り直し：コマンドを Next.js の外（tsx）でそのまま動かす", () => {
  const root = path.resolve(__dirname, "..");
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  const run = promisify(execFile);
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "shimebi-reset-"));
    const client = new PGlite(dir);
    const db = drizzle(client, { schema: s });
    await migrate(db, { migrationsFolder: path.join(root, "db", "migrations") });
    await seedDemo(db as unknown as Db);
    await client.close();
  }, 120_000);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const cli = (...args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PGLITE_DIR: dir };
    delete env.DATABASE_URL;
    return run(tsx, ["scripts/reset-access.ts", ...args], { cwd: root, env, timeout: 90_000 });
  };

  it("--list で一覧、--email でリンク（\"server-only\" を読み込まないので動く）", async () => {
    const list = await cli("--list");
    expect(list.stdout).toContain("デモ 社長  owner@demo.example  オーナー");
    const made = await cli("--email", "owner@demo.example", "--url", "https://shimebi-sample.vercel.app");
    const token = /https:\/\/shimebi-sample\.vercel\.app\/invite\/([A-Za-z0-9_-]+)/.exec(made.stdout)?.[1];
    expect(token).toBeTruthy();
    const client = new PGlite(dir);
    try {
      const db = drizzle(client, { schema: s });
      const rows = await db.select().from(s.invites).where(eq(s.invites.tokenHash, sha256(token!)));
      expect(rows).toHaveLength(1);
    } finally {
      await client.close();
    }
    await expect(cli("--email", "nobody@demo.example")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("見つかりません") });
  }, 120_000);
});
