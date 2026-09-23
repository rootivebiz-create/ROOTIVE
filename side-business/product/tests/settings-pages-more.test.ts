import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq, ne } from "drizzle-orm";
import { groupDigits } from "@/lib/format";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { audit } from "~/server/audit";
import { TAX_METHODS as ONBOARDING_TAX_METHODS } from "~/server/features/onboarding/company";
import { CLIENT_DEACTIVATE_ACTION, deactivateClient } from "~/server/features/settings/clients";
import { TAX_METHODS, toritekiOver, toritekiThresholdText } from "~/server/features/settings/format";
import { TORITEKI_CAPITAL_YEN, TORITEKI_EMPLOYEES } from "~/server/features/watch/rules";
import { hashPassword } from "~/server/password";
import { seedDemo } from "~/server/seed-demo";
import { sha256 } from "~/server/tokens";
import { createTestDb } from "./helpers/db";

/**
 * 設定の続きの画面（元請の無効・自分のアカウント・取適法の目安・ドライバーの取引条件の明示書）を HTML にしてみる。
 * ログイン・DB・クッキーだけ差し替える。
 */
const state: { db?: Db; user?: SessionUser; cookie?: string } = {};

Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "shimebi_sid" && state.cookie ? { name, value: state.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  const roleAtLeast = (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need];
  return {
    roleAtLeast,
    requirePageUser: async (need: keyof typeof RANK = "viewer") => {
      if (!roleAtLeast(state.user!.role, need)) throw new Error("FORBIDDEN");
      return state.user;
    },
    requireUser: async () => state.user,
    currentUser: async () => state.user,
    createInvite: async () => "token",
    clientIpHash: async () => null,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type AnyPage = (props: { searchParams: Promise<Record<string, string>>; params: Promise<Record<string, string>> }) => Promise<ReactElement>;

const FORBIDDEN = ["適法です", "違反はありません", "問題ありません", "法令に完全対応", "監査は大丈夫", "必ず合う", "ミスゼロ", "完全自動", "補助金が使えます"];

const pages: Record<string, () => Promise<{ default: AnyPage }>> = {
  home: () => import("~/app/(app)/settings/page") as unknown as Promise<{ default: AnyPage }>,
  account: () => import("~/app/(app)/settings/account/page") as unknown as Promise<{ default: AnyPage }>,
  clients: () => import("~/app/(app)/settings/clients/page") as unknown as Promise<{ default: AnyPage }>,
  projects: () => import("~/app/(app)/settings/projects/page") as unknown as Promise<{ default: AnyPage }>,
  company: () => import("~/app/(app)/settings/company/page") as unknown as Promise<{ default: AnyPage }>,
  driver: () => import("~/app/(app)/settings/drivers/[id]/page") as unknown as Promise<{ default: AnyPage }>,
};

describe("設定の続きの画面", () => {
  let client: PGlite;
  let tenantId: string;
  let users: Record<SessionUser["role"], SessionUser>;
  const html = async (name: keyof typeof pages, role: SessionUser["role"], sp: Record<string, string> = {}, params: Record<string, string> = {}) => {
    state.user = users[role];
    const { default: Page } = await pages[name]();
    const el = await Page({ searchParams: Promise.resolve(sp), params: Promise.resolve(params) });
    return renderToString(el).replace(/<!-- -->/g, "");
  };
  const driverId = async (code: string) => {
    const [d] = await state.db!.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
    return d.id;
  };

  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(t.db));
    await seedDemo(t.db); // 別の会社（混ざらないこと）
    // 見るだけの人を足す（デモの会社はオーナーと事務だけ）
    await t.db.insert(s.users).values({ tenantId, email: "viewer@demo.example", name: "デモ 閲覧", role: "viewer" });
    const rows = await t.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    const as = (role: SessionUser["role"]) => {
      const u = rows.find((r) => r.role === role)!;
      return { id: u.id, tenantId, email: u.email, name: u.name, role };
    };
    users = { owner: as("owner"), staff: as("staff"), viewer: as("viewer") };
  });
  afterAll(async () => client.close());
  afterEach(() => {
    delete process.env.DEMO_MODE;
    state.cookie = undefined;
  });

  it("消費税の計算方法：設定と最初の設定の案内で、同じ 3 つ・同じ名前・同じ説明", () => {
    expect(TAX_METHODS.map((t) => [t.id, t.label, t.help])).toEqual(ONBOARDING_TAX_METHODS.map((t) => [t.value, t.label, t.hint]));
    expect(TAX_METHODS.map((t) => t.id)).toEqual(["general", "simplified", "exempt"]);
  });

  it("取適法の目安の文と比べ方は、見張り番の数から作る（数を直書きしない）", () => {
    const t = { capitalYen: TORITEKI_CAPITAL_YEN, employees: TORITEKI_EMPLOYEES };
    const text = toritekiThresholdText(t);
    expect(text).toContain(`${groupDigits(TORITEKI_EMPLOYEES)}人 超`);
    expect(text).toContain(`${groupDigits(TORITEKI_CAPITAL_YEN / 10_000)}万円 超`);
    // 見張り番と同じ：どちらかが「超える」とき（ちょうどは当たらない）
    expect(toritekiOver(t, TORITEKI_CAPITAL_YEN, TORITEKI_EMPLOYEES)).toBe(false);
    expect(toritekiOver(t, TORITEKI_CAPITAL_YEN + 1, null)).toBe(true);
    expect(toritekiOver(t, null, TORITEKI_EMPLOYEES + 1)).toBe(true);
    expect(toritekiOver(t, Number.NaN, Number.NaN)).toBe(false);
  });

  it("会社の設定：取適法の目安を見張り番と同じ数で出す。計算方法の名前は案内と同じ", async () => {
    const owner = await html("company", "owner", { m: "2026-10" });
    expect(owner).toContain(toritekiThresholdText({ capitalYen: TORITEKI_CAPITAL_YEN, employees: TORITEKI_EMPLOYEES }));
    expect(owner).toContain("https://www.jftc.go.jp/toriteki/toritekigaiyo/gaiyo.html");
    for (const t of ONBOARDING_TAX_METHODS) expect(owner).toContain(t.label);
    const viewer = await html("company", "viewer", { m: "2026-10" });
    expect(viewer).toContain(toritekiThresholdText({ capitalYen: TORITEKI_CAPITAL_YEN, employees: TORITEKI_EMPLOYEES }));
  });

  it("自分のアカウント：どの役割でも開ける。パスワードの変更・いまの端末・ほかの端末の数・最近のログイン", async () => {
    const db = state.db!;
    await db.update(s.users).set({ passwordHash: await hashPassword("これは事務のパスワード") }).where(eq(s.users.id, users.staff.id));
    const add = (token: string, userId: string) =>
      db.insert(s.sessions).values({ id: sha256(token), userId, tenantId, expiresAt: new Date(Date.now() + 86_400_000) });
    await add("staff-here", users.staff.id);
    await add("staff-phone", users.staff.id);
    await add("staff-pc", users.staff.id);
    await add("owner-here", users.owner.id);
    await db.insert(s.auditLog).values({ tenantId, userId: users.staff.id, action: "login", entity: "user", entityId: users.staff.id, createdAt: new Date("2026-10-05T00:05:00Z") });

    state.cookie = "staff-here";
    const staff = await html("account", "staff");
    expect(staff).toContain("自分のアカウント");
    expect(staff).toContain('name="current"');
    expect(staff).toContain('"current-password"');
    expect(staff).toContain("この端末");
    expect(staff).toContain("ほかの端末（2か所）からログアウトする");
    expect(staff).toContain("2026年10月5日 09:05");
    expect(staff).toContain("staff@demo.example");
    // セッションの id（クッキーのハッシュ）は画面に出さない
    expect(staff).not.toContain(sha256("staff-phone"));

    // 見るだけの人も、自分のアカウントは開ける（パスワードがまだ無いので、決め方を案内）
    state.cookie = undefined;
    const viewer = await html("account", "viewer");
    expect(viewer).toContain("自分のアカウント");
    expect(viewer).toContain("招待のリンクから決めてください");
    expect(viewer).toContain("この端末のほかには、ログインしていません");

    // オーナー：ほかの端末は無い
    state.cookie = "owner-here";
    const owner = await html("account", "owner");
    expect(owner).toContain("この端末のほかには、ログインしていません");
    expect(owner).toContain("/settings/users");

    // デモではパスワードの欄を出さない
    process.env.DEMO_MODE = "1";
    state.cookie = "staff-here";
    const demo = await html("account", "staff");
    expect(demo).toContain("デモではパスワードを使いません");
    expect(demo).not.toContain('name="current"');
    expect(demo).not.toContain("からログアウトする");
  });

  it("設定のはじめ：自分のアカウントとヘルプへの入口。全データの書き出しはオーナーだけ", async () => {
    const staff = await html("home", "staff");
    expect(staff).toContain('href="/settings/account"');
    expect(staff).toContain('href="/help"');
    expect(staff).not.toContain('href="/data"');
    expect(await html("home", "owner")).toContain('href="/data"');
  });

  it("元請：取引をやめた元請は「無効の元請」に並べ、案件の元請を選ぶところ（追加の欄）には出さない", async () => {
    const db = state.db!;
    const [b] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "B商事（架空）")));
    const r = await deactivateClient(db, tenantId, b.id, { withProjects: true });
    await audit(db, { tenantId, action: CLIENT_DEACTIVATE_ACTION, entity: "client", entityId: b.id, detail: { name: b.name, projectIds: r.projectIds } });

    const clients = await html("clients", "staff");
    expect(clients).toContain("無効の元請（1社）");
    expect(clients).toContain("取引をやめた元請");
    expect(clients).toContain("取引をやめる（無効にする）"); // A物流（まだ取引している）
    expect(clients).toContain(">戻す<");
    const viewer = await html("clients", "viewer");
    expect(viewer).toContain("無効の元請（1社）");
    expect(viewer).not.toContain(">戻す<");
    expect(viewer).not.toContain("取引をやめる（無効にする）");

    const projects = await html("projects", "staff");
    // 最初の選ぶ欄（案件を追加）には B商事 が無い
    const firstPicker = /<select[^>]*name="clientId"[^>]*>([\s\S]*?)<\/select>/.exec(projects)![1];
    expect(firstPicker).toContain("A物流（架空）");
    expect(firstPicker).not.toContain("B商事");
    // B商事 の案件を直す欄には、印を付けて残す（知らないうちに外れないように）
    expect(projects).toContain("B商事（架空）（取引をやめた元請）");
    expect(projects).toContain("取引をやめた元請");
    // やめた元請の案件（2件）は「使う」に戻すボタンの代わりに、元請を先に戻す案内を出す
    expect(projects.split("このままでは「使う」に戻せません")).toHaveLength(3);
    expect(projects).not.toContain("使うように戻す");

    // 押したあとの知らせ（元請が下の一覧へ移っても、上で結果が分かる）
    const done = await html("clients", "staff", { done: "off", id: b.id, n: String(r.projectIds.length) });
    expect(done).toContain("「B商事（架空）」を取引をやめた元請にしました。案件 2件も「使わない」にしました。");
    // 今の状態と合わない知らせ・別の会社の元請の知らせは出さない
    expect(await html("clients", "staff", { done: "on", id: b.id, n: "2" })).not.toContain("戻しました");
    const [otherB] = await db.select().from(s.clients).where(and(ne(s.clients.tenantId, tenantId), eq(s.clients.name, "B商事（架空）")));
    await db.update(s.clients).set({ active: false }).where(eq(s.clients.id, otherB.id));
    expect(await html("clients", "staff", { done: "off", id: otherB.id, n: "2" })).not.toContain("取引をやめた元請にしました");
    await db.update(s.clients).set({ active: true }).where(eq(s.clients.id, otherB.id));
  });

  it("ドライバー：取引条件の明示書へのリンクと、最新の版・明示した日（閲覧の人にも）", async () => {
    const db = state.db!;
    const aoki = await driverId("D01");
    const none = await html("driver", "staff", {}, { id: aoki });
    expect(none).toContain(`href="/terms/${aoki}"`);
    expect(none).toContain("取引条件の明示書を作る・見る");
    expect(none).toContain("明示書の記録はまだありません");
    expect(none).toContain("2026年4月1日 が入っています");

    await db.insert(s.termsRecords).values([
      { tenantId, driverId: aoki, version: 1, issuedOn: "2026-04-01", content: {}, sentAt: new Date("2026-04-01T01:00:00Z") },
      { tenantId, driverId: aoki, version: 2, issuedOn: "2026-09-15", content: {}, sentAt: new Date("2026-09-15T01:00:00Z"), receivedAt: new Date("2026-09-16T03:30:00Z") },
    ]);
    const staff = await html("driver", "staff", {}, { id: aoki });
    expect(staff).toContain("第2版");
    expect(staff).toContain("2026年9月15日 に明示");
    expect(staff).toContain("受け取りの記録あり（2026年9月16日 12:30）");
    const viewer = await html("driver", "viewer", {}, { id: aoki });
    expect(viewer).toContain(`href="/terms/${aoki}"`);
    expect(viewer).toContain("第2版");

    // 送っただけ（受け取りの記録なし）の人
    const inoue = await driverId("D02");
    await db.insert(s.termsRecords).values({ tenantId, driverId: inoue, version: 1, issuedOn: "2026-09-20", content: {}, sentAt: new Date("2026-09-20T01:00:00Z") });
    expect(await html("driver", "staff", {}, { id: inoue })).toContain("送りました・受け取りの記録はまだありません");
  });

  it("どの画面にも、判定・保証の言葉を出さない", async () => {
    state.cookie = "staff-here";
    const all = [
      await html("account", "staff"),
      await html("clients", "owner"),
      await html("projects", "owner"),
      await html("company", "owner", { m: "2026-10" }),
      await html("home", "owner"),
      await html("driver", "owner", {}, { id: await driverId("D01") }),
    ].join("\n");
    for (const word of FORBIDDEN) expect(all).not.toContain(word);
  });
});
