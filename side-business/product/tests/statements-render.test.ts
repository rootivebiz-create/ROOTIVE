import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 支払明細の画面（会社の一覧・1 人の明細）・ドライバーの画面・ダウンロードを、ログインと DB と要求の見出しだけ差し替えて動かす。
 * 役割で出る／出ないもの、締めた月、会社の区切り、ドライバーに会社の数字が出ないこと、言ってはいけない言葉を確かめる。
 */
const state: { db?: Db; user?: SessionUser; loggedIn?: SessionUser | null } = {};
Object.assign(globalThis, { React });

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

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
    currentUser: async () => state.loggedIn ?? null,
    clientIpHash: async () => "ip-render-test",
    AuthError,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "shimebi.example", "x-forwarded-proto": "https", "user-agent": IPHONE }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

/** 製品が言ってはいけない言い方（法令・税の結論、言い切り、報酬を下げる助言） */
const FORBIDDEN = [/適法/, /違反はありません/, /問題ありません/, /法令に完全対応/, /大丈夫/, /必ず合う/, /ミスゼロ/, /完全自動/, /補助金/, /下げ(る|ましょう|てください)/, /偽装請負/, /労働者にあたる/];

let client: PGlite;
let tenantId: string;
let otherId: string;
const userIds = new Map<string, string>();

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(t.db));
  ({ tenantId: otherId } = await seedDemo(t.db));
  await generateStatements(t.db, tenantId, DEMO_MONTH);
  await generateStatements(t.db, otherId, DEMO_MONTH);
  for (const u of await t.db.select({ id: s.users.id, tenantId: s.users.tenantId }).from(s.users)) userIds.set(u.tenantId, u.id);
});
afterAll(async () => client.close());
beforeEach(() => {
  state.loggedIn = null;
  resetRateLimit();
});

function asUser(role: SessionUser["role"], tenant = tenantId): SessionUser {
  return { id: userIds.get(tenant)!, tenantId: tenant, email: `${role}@demo.example`, name: `デモ ${role}`, role };
}

function html(el: ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

async function listPage(sp: Record<string, string>): Promise<string> {
  const { default: Page } = await import("~/app/(app)/statements/page");
  return html((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);
}

async function detailPage(id: string): Promise<string> {
  const { default: Page } = await import("~/app/(app)/statements/[id]/page");
  return html((await Page({ params: Promise.resolve({ id }) })) as ReactElement);
}

async function portalPage(token: string): Promise<string> {
  const { default: Page } = await import("~/app/s/[token]/page");
  return html((await Page({ params: Promise.resolve({ token }) })) as ReactElement);
}

async function statementOf(code: string, tid = tenantId) {
  const db = state.db!;
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
}

async function tokenOf(code: string, tid = tenantId): Promise<string> {
  const { staffLinkToken } = await import("~/server/features/statements");
  return staffLinkToken((await statementOf(code, tid)).st).token;
}

describe("明細の一覧 /statements", () => {
  it("事務：8 人・合計・件数の一文・作り直すボタン・順に送る案内", async () => {
    state.user = asUser("staff");
    const h = await listPage({ m: "2026-10" });
    expect(h).toContain("8人中 0人が確認済み");
    expect(h).toContain("明細は今の稼働・設定どおりです（8人分）");
    expect(h).toContain("明細を作り直す");
    expect(h).toContain("まだ送っていない人に順に送る（8人）");
    expect(h).toContain("¥2,206,094");
    expect(h).toContain("¥357,555");
    expect(h).toContain("/api/statements/pdf?m=2026-10");
    expect(h).toContain("/api/statements/confirmations?m=2026-10");
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("見るだけの人：一覧と出力は見られるが、作る・送るボタンは出ない", async () => {
    state.user = asUser("viewer");
    const h = await listPage({ m: "2026-10" });
    expect(h).toContain("8人中 0人が確認済み");
    expect(h).toContain("/api/statements/pdf?m=2026-10");
    expect(h).not.toContain("明細を作り直す");
    expect(h).not.toContain("まだ送っていない人に順に送る");
  });

  it("明細を作らずに締めた月は、締めを外す案内だけ（作るボタンは出ない）", async () => {
    state.user = asUser("staff");
    const h = await listPage({ m: DEMO_PREV_MONTH.slice(0, 7) });
    expect(h).toContain("締め済みです");
    expect(h).toContain("明細を作らないまま締められています");
    expect(h).not.toContain("明細を作る</button>");
  });

  it("稼働が変わったら「作り直してください」と、確認済みの人の明細が変わる注意", async () => {
    state.user = asUser("staff");
    const db = state.db!;
    const { st, driver } = await statementOf("D08");
    const { confirmFromPortal } = await import("~/server/features/portal");
    await confirmFromPortal(db, await tokenOf("D08"), { version: st.version }, { ipHash: "x", userAgent: IPHONE });
    const [adj] = await db
      .insert(s.adjustments)
      .values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "燃料の立替", amount: 2_000, agreedInWriting: true })
      .returning();
    try {
      const h = await listPage({ m: "2026-10" });
      expect(h).toContain("稼働が変わりました。作り直してください");
      expect(h).toContain("作ったあとで稼働・単価・控除が変わった人 1人：佐藤 亮");
      expect(h).toContain("8人中 1人が確認済み");
    } finally {
      await db.delete(s.adjustments).where(eq(s.adjustments.id, adj.id));
      await db.delete(s.statementConfirmations).where(eq(s.statementConfirmations.statementId, st.id));
    }
  });
});

describe("1 人の明細 /statements/[id]", () => {
  it("事務：ドライバーに見える明細とリンク・送るボタン", async () => {
    state.user = asUser("staff");
    const { st } = await statementOf("D01");
    const h = await detailPage(st.id);
    expect(h).toContain("青木 翔太さんの支払明細");
    expect(h).toContain("支払明細書（仕入明細書）");
    expect(h).toContain("2,310個 × 150円");
    expect(h).toContain("357,555円");
    expect(h).toContain("https://shimebi.example/s/");
    expect(h).toContain("リンクをコピー");
    expect(h).toContain("https://line.me/R/msg/text/?");
    expect(h).toContain("リンクを作り直す");
    // 会社の売上（190 円 × 2,310 個 ＋ 9,000 円 × 4 件）は出ない
    expect(h).not.toContain("474,900");
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("見るだけの人にはリンクを出さない。他社の明細は開けない", async () => {
    state.user = asUser("viewer");
    const { st } = await statementOf("D01");
    const h = await detailPage(st.id);
    expect(h).toContain("見るだけの役割では出しません");
    expect(h).not.toContain("/s/");
    expect(h).not.toContain("リンクを作り直す");
    const { st: other } = await statementOf("D01", otherId);
    await expect(detailPage(other.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(detailPage("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("ドライバーの画面 /s/[token]", () => {
  it("振込額・振込予定日・行・確認のボタン。会社の数字は出ない", async () => {
    const h = await portalPage(await tokenOf("D03"));
    expect(h).toContain("2026年10月分の支払明細");
    expect(h).toContain("上田 健 様");
    expect(h).toContain("支払明細書");
    expect(h).not.toContain("仕入明細書）");
    expect(h).toContain("消費税相当額");
    expect(h).toContain("245,740円");
    expect(h).toContain("2026年11月25日（水）");
    expect(h).toContain("内容を確認しました");
    expect(h).toContain("この行について質問する");
    expect(h).toContain("確定申告の資料づくりにお使いください。税金の判断は税理士・税務署にご確認ください");
    for (const word of ["billRate", "invoiceBurden", "利益", "売上"]) expect(h).not.toContain(word);
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("会社の人がログインしたまま開くと、確認と質問は押せない（ログアウトの案内つき）", async () => {
    state.loggedIn = asUser("staff");
    const h = await portalPage(await tokenOf("D03"));
    expect(h).toContain("ログインしたまま開いています");
    expect(h).toContain("ログアウトしてから開き直してください");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>内容を確認しました<\/button>/);
    // 他社の人のログインは関係ない
    state.loggedIn = asUser("staff", otherId);
    expect(await portalPage(await tokenOf("D03"))).not.toContain("ログインしたまま開いています");
  });

  it("確認のあとで明細が変わると、帯と「変わったところ」が出る", async () => {
    const db = state.db!;
    const token = await tokenOf("D06");
    const { driver, st } = await statementOf("D06");
    const { confirmFromPortal } = await import("~/server/features/portal");
    await confirmFromPortal(db, token, { version: st.version }, { ipHash: "y", userAgent: IPHONE });
    expect(await portalPage(token)).toContain("に確認しました（版 1）");
    await new Promise((r) => setTimeout(r, 5));
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "洗車代の立替", amount: 1_500, agreedInWriting: true });
    await generateStatements(db, tenantId, DEMO_MONTH);
    const h = await portalPage(token);
    expect(h).toContain("内容が変わりました。もう一度ご確認ください。");
    expect(h).toContain("変わったところ");
    expect(h).toContain("調整「洗車代の立替」＋1,500円 が加わりました");
  });

  it("使えないリンクは 404（理由は出さない）", async () => {
    await expect(portalPage("garbage")).rejects.toThrow("NEXT_NOT_FOUND");
    const token = await tokenOf("D02");
    const [p, mac] = token.split(".");
    await expect(portalPage(`${p}.${mac.slice(0, 5)}${mac[5] === "A" ? "Q" : "A"}${mac.slice(6)}`)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("ダウンロード", () => {
  it("会社の PDF：ログインが無ければ 403、他社の明細は 404、見るだけの人でも出せて記録が残る", async () => {
    const one = await import("~/app/api/statements/[id]/pdf/route");
    const month = await import("~/app/api/statements/pdf/route");
    const { st } = await statementOf("D01");
    const { st: other } = await statementOf("D01", otherId);
    state.user = undefined;
    expect((await one.GET(new Request("http://x/"), { params: Promise.resolve({ id: st.id }) })).status).toBe(403);
    expect((await month.GET(new Request("http://x/api/statements/pdf?m=2026-10"))).status).toBe(403);
    state.user = asUser("viewer");
    expect((await one.GET(new Request("http://x/"), { params: Promise.resolve({ id: other.id }) })).status).toBe(404);
    const res = await one.GET(new Request("http://x/"), { params: Promise.resolve({ id: st.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(Buffer.from(new Uint8Array(await res.arrayBuffer()).slice(0, 5)).toString()).toBe("%PDF-");
    const empty = await month.GET(new Request("http://x/api/statements/pdf?m=2026-05"));
    expect(empty.status).toBe(404);
    expect(await empty.text()).toContain("2026年5月の明細はまだありません");
    const logs = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.statement_pdf")));
    expect(logs.some((l) => l.entityId === st.id)).toBe(true);
  });

  it("確認の記録（CSV）は自社の 8 人分だけ", async () => {
    state.user = asUser("viewer");
    const { GET } = await import("~/app/api/statements/confirmations/route");
    const res = await GET(new Request("http://x/api/statements/confirmations?m=2026-10"));
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3)).trim().split("\r\n");
    expect(text).toHaveLength(9);
  });

  it("ドライバーの CSV・PDF：検索に出さない見出しつき。使えないリンクは 404", async () => {
    const csv = await import("~/app/api/s/[token]/csv/route");
    const pdf = await import("~/app/api/s/[token]/pdf/route");
    const token = await tokenOf("D01");
    const res = await csv.GET(new Request("http://x/"), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const lines = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(3)).trim().split("\r\n");
    expect(lines.slice(1)).toEqual(["2026年10月,374500,37450,57695,3300,0,357555,2026-11-25", "合計,374500,37450,57695,3300,0,357555,"]);
    expect((await csv.GET(new Request("http://x/"), { params: Promise.resolve({ token: "garbage" }) })).status).toBe(404);
    const p = await pdf.GET(new Request("http://x/"), { params: Promise.resolve({ token }) });
    expect(p.status).toBe(200);
    expect(p.headers.get("Content-Type")).toBe("application/pdf");
    expect((await pdf.GET(new Request("http://x/"), { params: Promise.resolve({ token: "garbage" }) })).status).toBe(404);
  });
});
