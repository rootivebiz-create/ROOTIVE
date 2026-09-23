import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 利益の画面と社長の 1 枚の出口を、ログインと DB だけ差し替えて動かす。
 * 出してよい言葉・出してはいけない言葉、役割、会社の区切り、操作の記録を確かめる。
 */
const state: { db?: Db; user?: SessionUser } = {};
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  class AuthError extends Error {}
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async (need: keyof typeof RANK = "viewer") => {
      if (!state.user) throw new AuthError("ログインしてください");
      if (RANK[state.user.role] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      return state.user;
    },
    AuthError,
  };
});
vi.mock("~/server/features/watch", () => ({ runWatch: async () => [] }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/** 製品が言ってはいけない言い方（法令・税の結論、言い切り、報酬を下げる助言） */
const FORBIDDEN = [/適法/, /違反はありません/, /問題ありません/, /法令に完全対応/, /大丈夫/, /必ず合う/, /ミスゼロ/, /完全自動/, /補助金/, /下げ(る|ましょう|てください)/, /偽装請負/, /労働者にあたる/];

let client: PGlite;
let tenantId: string;
let otherId: string;
/** 会社ごとの利用者の id（操作の記録の外部キーに使う） */
const userIds = new Map<string, string>();

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(t.db));
  ({ tenantId: otherId } = await seedDemo(t.db));
  for (const u of await t.db.select({ id: s.users.id, tenantId: s.users.tenantId }).from(s.users)) userIds.set(u.tenantId, u.id);
});
afterAll(async () => client.close());

function asUser(role: SessionUser["role"], tenant = tenantId): SessionUser {
  return { id: userIds.get(tenant)!, tenantId: tenant, email: `${role}@demo.example`, name: `デモ ${role}`, role };
}

async function renderPage(sp: Record<string, string>): Promise<string> {
  const { default: Page } = await import("~/app/(app)/profit/page");
  const el = (await Page({ searchParams: Promise.resolve(sp) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}

describe("利益の画面", () => {
  it("閲覧の人でも見られ、10 月の数字・表・経過措置の目安・PDF のボタンが出る", async () => {
    state.user = asUser("viewer");
    const html = await renderPage({ m: "2026-10" });
    expect(html).toContain("社長の1枚（PDF）");
    expect(html).toContain("/api/profit/pdf?m=2026-10");
    expect(html).toContain("¥980,270");
    expect(html).toContain("¥3,013,300");
    expect(html).toContain("32.5%");
    expect(html).toContain("宅配（個建て）");
    expect(html).toContain("A物流（架空）");
    expect(html).toContain("青木 翔太");
    expect(html).toContain("同じ稼働が続いた場合の目安");
    expect(html).toContain("2028年10月〜2030年9月");
    expect(html).toContain("¥34,150");
    expect(html).toContain("まだ締めていない月です");
    expect(html).not.toContain("赤字");
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });

  it("並べ替え（利益の少ない順）で、表の最初がスポット便になる", async () => {
    state.user = asUser("viewer");
    const html = await renderPage({ m: "2026-10", sort: "profit_asc" });
    const projects = html.slice(html.indexOf('id="projects"'));
    expect(projects.indexOf("スポット便")).toBeLessThan(projects.indexOf("企業配（日当）"));
    expect(html).toContain('aria-current="true"');
  });

  it("売上より委託料が多い案件は、赤字の印と知らせが出る", async () => {
    state.user = asUser("viewer");
    await state.db!.update(s.projects).set({ payRate: 10_000 }).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "スポット便")));
    try {
      const html = await renderPage({ m: "2026-10" });
      expect(html).toContain("赤字");
      expect(html).toContain("売上より委託料が多い案件が 1 件あります");
      for (const re of FORBIDDEN) expect(html).not.toMatch(re);
    } finally {
      await state.db!.update(s.projects).set({ payRate: 7_000 }).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "スポット便")));
    }
  });

  it("稼働の無い月は、取り込みへの案内だけ（事務には取り込みのボタン）", async () => {
    state.user = asUser("staff");
    const html = await renderPage({ m: "2026-05" });
    expect(html).toContain("2026年5月の稼働がまだありません");
    expect(html).toContain("/import?m=2026-05");
    expect(html).not.toContain("/api/profit/pdf");
    state.user = asUser("viewer");
    expect(await renderPage({ m: "2026-05" })).not.toContain("/import?m=2026-05");
  });

  it("締めた 9 月（写しなし）はそう知らせる", async () => {
    state.user = asUser("viewer");
    const html = await renderPage({ m: "2026-09" });
    expect(html).toContain("明細の写しが保存されていません");
  });
});

describe("社長の 1 枚（GET /api/profit/pdf）", () => {
  it("閲覧の人でも PDF を受け取れ、持ち出しの記録が残る。ほかの会社の数字は入らない", async () => {
    state.user = asUser("viewer");
    const { GET } = await import("~/app/api/profit/pdf/route");
    const res = await GET(new Request("http://localhost/api/profit/pdf?m=2026-10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("社長の1枚_2026年10月.pdf"));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const logs = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.ceo_pdf")));
    expect(logs).toHaveLength(1);
    expect(logs[0].entityId).toBe(DEMO_MONTH);
    expect(logs[0].detail).toMatchObject({ profit: 980_270 });
    const otherLogs = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, otherId), eq(s.auditLog.action, "export.ceo_pdf")));
    expect(otherLogs).toHaveLength(0);
  });

  it("ログインしていなければ 403、稼働の無い月は 404 で戻り先を出す", async () => {
    const { GET } = await import("~/app/api/profit/pdf/route");
    state.user = undefined;
    expect((await GET(new Request("http://localhost/api/profit/pdf?m=2026-10"))).status).toBe(403);
    state.user = asUser("viewer");
    const res = await GET(new Request("http://localhost/api/profit/pdf?m=2026-05"));
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("稼働がまだありません");
    expect(html).toContain("/profit?m=2026-05");
  });
});
