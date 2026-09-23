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
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 取引条件の画面（会社の一覧・1 人の画面）・ドライバーのページ・ダウンロードを、ログインと DB と要求の見出しだけ差し替えて動かす。
 * 役割で出る／出ないもの、会社の区切り、古い版のリンク、言ってはいけない言葉を確かめる。
 */
const state: { db?: Db; user?: SessionUser; loggedIn?: SessionUser | null } = {};
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
    currentUser: async () => state.loggedIn ?? null,
    clientIpHash: async () => "ip-render-test",
    AuthError,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "shimebi.example", "x-forwarded-proto": "https", "user-agent": "Mozilla/5.0 (iPhone)" }),
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

/** 製品が言ってはいけない言い方（法令・税の結論、言い切り、報酬を下げる助言）。「取適法」（法律の略称）は数えない（wording.test.ts と同じ） */
const FORBIDDEN = [/(?<!取)適法/, /違反はありません/, /問題ありません/, /法令に完全対応/, /大丈夫/, /必ず合う/, /ミスゼロ/, /完全自動/, /補助金/, /下げ(る|ましょう|てください)/, /偽装請負/, /労働者にあたる/];

let client: PGlite;
let tenantId: string;
let otherId: string;
const userIds = new Map<string, string>();
const D: Record<string, string> = {};
const OD: Record<string, string> = {};

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(t.db));
  ({ tenantId: otherId } = await seedDemo(t.db));
  for (const u of await t.db.select({ id: s.users.id, tenantId: s.users.tenantId }).from(s.users)) userIds.set(u.tenantId, u.id);
  for (const r of await t.db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))) D[r.code!] = r.id;
  for (const r of await t.db.select().from(s.drivers).where(eq(s.drivers.tenantId, otherId))) OD[r.code!] = r.id;
  const { createTermsVersion } = await import("~/server/features/terms");
  const projects = await t.db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
  const P = Object.fromEntries(projects.map((p) => [p.name, p.id]));
  await createTermsVersion(t.db, tenantId, { userId: null, role: "staff" }, {
    driverId: D.D01,
    projectIds: [P["宅配（個建て）"], P["スポット便"]],
    serviceDescription: "貨物軽自動車を使った荷物の配送業務",
    place: "A物流 ○○センターで受け取り、指定の配送先へ届ける",
    periodFrom: "2026-04-01",
    receipt: "業務を行った日ごとに受け取ったものとします。",
    deemed: true,
    isSubcontract: false,
    issuedOn: "2026-09-01",
  }, new Date("2026-09-01T10:00:00+09:00"));
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

async function listPage(sp: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("~/app/(app)/terms/page");
  return html((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);
}

async function detailPage(driverId: string): Promise<string> {
  const { default: Page } = await import("~/app/(app)/terms/[driverId]/page");
  return html((await Page({ params: Promise.resolve({ driverId }) })) as ReactElement);
}

async function portalPage(token: string): Promise<string> {
  const { default: Page } = await import("~/app/t/[token]/page");
  return html((await Page({ params: Promise.resolve({ token }) })) as ReactElement);
}

async function latestRecord(driverId: string) {
  const rows = await state.db!.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, driverId));
  return rows.sort((a, b) => b.version - a.version)[0];
}

async function tokenOf(driverId: string): Promise<string> {
  const { termsLinkToken } = await import("~/server/features/terms/links");
  return termsLinkToken(await latestRecord(driverId)).token;
}

describe("一覧 /terms", () => {
  it("事務：1 人ずつの状態・最近の稼働があるのに未作成の注意・まとめて作るボタン", async () => {
    state.user = asUser("staff");
    const h = await listPage();
    expect(h).toContain("青木 翔太");
    expect(h).toContain("遠藤 大輔");
    expect(h).toContain("有効な 8人のうち");
    expect(h).toContain("最近（この 3 か月）稼働しているのに、明示書の記録が無い人が 7人います");
    expect(h).toContain("未作成の人の明示書をまとめて作る（7人）");
    expect(h).toContain("版 1・明示 2026年9月1日・まだ送っていません");
    expect(h).toContain("台帳の明示した日 2026年4月1日（手で入れた日付。明示書の記録はありません）");
    expect(h).toContain("https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html");
    expect(h).toContain("/api/terms/pdf");
    expect(h).toContain("/api/terms/csv");
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("見るだけの人：一覧は見られるが、まとめて作るボタンは出ない。絞り込みが効く。他社の人は出ない", async () => {
    state.user = asUser("viewer");
    const h = await listPage({ f: "none" });
    expect(h).not.toContain("まとめて作る（");
    expect(h).toContain("遠藤 大輔");
    expect(h).not.toContain(`/terms/${D.D01}"`);
    expect(h).not.toContain(OD.D01);
    const unreceived = await listPage({ f: "unreceived" });
    expect(unreceived).toContain(`/terms/${D.D01}`);
    expect(unreceived).not.toContain(`/terms/${D.D04}`);
  });
});

describe("1 人の画面 /terms/[driverId]", () => {
  it("事務：ドライバーに見える明示書・送るリンク・新しい版のフォーム・履歴", async () => {
    state.user = asUser("staff");
    const h = await detailPage(D.D01);
    expect(h).toContain("青木 翔太さんの取引条件");
    expect(h).toContain("取引条件の明示書（業務委託）");
    expect(h).toContain("給付を受け取る場所");
    expect(h).toContain("毎月末日締め・翌月25日払い");
    expect(h).toContain("https://shimebi.example/t/");
    expect(h).toContain("リンクをコピー");
    expect(h).toContain("https://line.me/R/msg/text/?");
    expect(h).toContain("リンクを作り直す");
    // 台帳と同じ中身なので、フォームは畳んである（開くと版 2 を作れる）
    expect(h).toContain("直して新しい版（版 2）を作る");
    expect(h).not.toContain("版 2 として保存する");
    expect(h).toContain("版の履歴（1件）");
    expect(h).toContain(`/api/terms/${(await latestRecord(D.D01)).id}/pdf`);
    // 会社の売上（受注の単価 190 円）は出ない
    expect(h).not.toContain("190円");
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("未作成の人：最近の稼働があるのに記録が無い注意と、版 1 のフォーム（案件は直近の稼働から選ばれている）", async () => {
    state.user = asUser("staff");
    const h = await detailPage(D.D04);
    expect(h).toContain("最近の稼働があるのに、明示書の記録がありません");
    expect(h).toContain("明示書を作る（版 1）");
    expect(h).toContain("版 1 として保存する");
    expect(h).toContain("車両リース：毎月 32,000円（稼働が無い月も）");
    // 案件は、直近に稼働した「ルート配送」「スポット便」が選ばれている（ほかは選ばれていない）
    const P = Object.fromEntries((await state.db!.select().from(s.projects).where(eq(s.projects.tenantId, tenantId))).map((p) => [p.name, p.id]));
    expect(h).toContain(`checked="" value="${P["ルート配送（時給）"]}"`);
    expect(h).toContain(`checked="" value="${P["スポット便"]}"`);
    expect(h).not.toContain(`checked="" value="${P["宅配（個建て）"]}"`);
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("見るだけの人にはリンクもフォームも出さない。他社の人は開けない", async () => {
    state.user = asUser("viewer");
    const h = await detailPage(D.D01);
    expect(h).toContain("見るだけの役割では出しません");
    expect(h).not.toContain("/t/");
    expect(h).not.toContain("として保存する");
    expect(h).not.toContain("リンクを作り直す");
    await expect(detailPage(OD.D01)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(detailPage("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("振込手数料をドライバーが持つ設定だと、赤で知らせ、明示書にもはっきり書く", async () => {
    state.user = asUser("staff");
    const db = state.db!;
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    await db.update(s.tenants).set({ settings: { ...t.settings, transferFeeBearer: "driver" } }).where(eq(s.tenants.id, tenantId));
    try {
      const h = await detailPage(D.D01);
      expect(h).toContain("振込手数料をドライバーが負担する設定です");
      // 取適法は正式な名前を添えて出し、2 回目は短く
      expect(h).toContain("取適法（中小受託取引適正化法）");
      expect(h).toContain("取適法のリーフレット");
      expect(h).toContain("条件が変わっています");
      expect(h).toContain("振込手数料の負担：会社 → ドライバー");
      // 条件が変わったら、フォームは開いている
      expect(h).toContain("版 2 として保存する");
      for (const re of FORBIDDEN) expect(h).not.toMatch(re);
    } finally {
      await db.update(s.tenants).set({ settings: t.settings }).where(eq(s.tenants.id, tenantId));
    }
  });

  it("会社の設定の支払期日の文言に「まで」があると、赤で知らせる（明示書の支払期日は具体的な日のまま）。見るだけの人にも出す", async () => {
    const db = state.db!;
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    await db.update(s.tenants).set({ settings: { ...t.settings, paymentTermsText: "月末締め、翌月末日までに支払う" } }).where(eq(s.tenants.id, tenantId));
    try {
      for (const role of ["staff", "viewer"] as const) {
        state.user = asUser(role);
        const h = await detailPage(D.D01);
        expect(h).toContain("「月末締め、翌月末日までに支払う」");
        expect(h).toContain("契約書などの文言が食い違っていないかの確認をおすすめします");
        expect(h).toContain("毎月末日締め・翌月25日払い");
        for (const re of FORBIDDEN) expect(h).not.toMatch(re);
      }
      // ほかの会社の画面には出ない
      state.user = asUser("staff", otherId);
      expect(await detailPage(OD.D01)).not.toContain("契約書などの文言が食い違っていないか");
    } finally {
      await db.update(s.tenants).set({ settings: t.settings }).where(eq(s.tenants.id, tenantId));
      state.user = asUser("staff");
    }
  });
});

describe("ドライバーのページ /t/[token]", () => {
  it("最新の版：書面の中身と「受け取りました」。会社の数字は出ない", async () => {
    const h = await portalPage(await tokenOf(D.D01));
    expect(h).toContain("取引条件のお知らせ");
    expect(h).toContain("青木 翔太 様");
    expect(h).toContain("サンプル運送株式会社（架空）");
    expect(h).toContain("受け取りました");
    expect(h).toContain("内容に同意したかどうかとは別です");
    expect(h).toContain("150円");
    expect(h).not.toContain("190円");
    expect(h).toContain("/api/t/");
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });

  it("会社の人がログインしたまま開くと、押せない旨を出す", async () => {
    state.loggedIn = asUser("staff");
    const h = await portalPage(await tokenOf(D.D01));
    expect(h).toContain("会社の方としてログインしたまま開いています");
    // ほかの会社の人のログインなら、ふつうに出す
    state.loggedIn = asUser("staff", otherId);
    expect(await portalPage(await tokenOf(D.D01))).not.toContain("会社の方としてログインしたまま開いています");
  });

  it("前の版のリンク：「新しい版があります」と出して、受け取りは押せない。壊れたリンクは開けない", async () => {
    const oldToken = await tokenOf(D.D01);
    const { createTermsVersion } = await import("~/server/features/terms");
    const projects = await state.db!.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
    await createTermsVersion(state.db!, tenantId, { userId: null, role: "staff" }, {
      driverId: D.D01,
      projectIds: [projects[0].id],
      serviceDescription: "配送業務",
      place: "会社が指定する配送先",
      periodFrom: "2026-04-01",
      receipt: "業務を行った日ごとに受け取ったものとします。",
      deemed: false,
      isSubcontract: false,
      issuedOn: "2026-09-10",
    }, new Date("2026-09-10T10:00:00+09:00"));
    const h = await portalPage(oldToken);
    expect(h).toContain("新しい版があります。");
    // 新しい版をまだ送っていないときは、届くのを待ってもらう（新しい版へのボタンは出さない）
    expect(h).toContain("会社から新しい版のリンクが届くまで、お待ちください");
    expect(h).not.toContain("を開く</a>");
    expect(h).toContain("この版では「受け取りました」は押せません");
    expect(h).not.toContain(">受け取りました</button>");
    // 送ったあとは、古いリンクのページから新しい版を開ける
    await state.db!.update(s.termsRecords).set({ sentAt: new Date("2026-09-10T11:00:00+09:00") }).where(and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, D.D01), eq(s.termsRecords.version, 2)));
    const sent = await portalPage(oldToken);
    expect(sent).toContain("新しい版（版 2）を開く");
    expect(sent).toMatch(/href="\/t\/[^"]+"/);
    await expect(portalPage("broken.token")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("ダウンロード", () => {
  it("会社の PDF：会社で絞る・見るだけの人も出せる・ほかの会社の記録は 404", async () => {
    const { GET } = await import("~/app/api/terms/[id]/pdf/route");
    const rec = await latestRecord(D.D01);
    state.user = asUser("viewer");
    const res = await GET(new Request("https://shimebi.example/"), { params: Promise.resolve({ id: rec.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("取引条件の明示書_青木 翔太_版2.pdf"));
    state.user = asUser("viewer", otherId);
    const other = await GET(new Request("https://shimebi.example/"), { params: Promise.resolve({ id: rec.id }) });
    expect(other.status).toBe(404);
    state.user = undefined;
    const anon = await GET(new Request("https://shimebi.example/"), { params: Promise.resolve({ id: rec.id }) });
    expect(anon.status).toBe(403);
  });

  it("全員分の PDF と、全部の版の CSV：会社で絞る・持ち出しを記録する", async () => {
    const pdf = await import("~/app/api/terms/pdf/route");
    const csv = await import("~/app/api/terms/csv/route");
    state.user = asUser("viewer");
    const res = await pdf.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const c = await csv.GET();
    expect(c.status).toBe(200);
    // BOM を残して読む（Excel で文字化けしないように BOM 付きで出している）
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await c.arrayBuffer());
    expect(body.startsWith("\uFEFFドライバーの番号,ドライバー,版,最新の版か,明示した日")).toBe(true);
    const lines = body.trim().split("\r\n");
    // 青木さんの版 1・版 2（最新）だけ。ほかの会社の記録は入らない
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^D01,青木 翔太,1,,2026-09-01,/);
    expect(lines[2]).toMatch(/^D01,青木 翔太,2,最新,2026-09-10,/);
    expect(lines[1]).toContain(",あり,");
    const audits = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.terms_csv")));
    expect(audits).toHaveLength(1);
    // 記録が 1 つも無い会社は、全員分の PDF を 404 で断る
    state.user = asUser("viewer", otherId);
    expect((await pdf.GET()).status).toBe(404);
    state.user = undefined;
    expect((await csv.GET()).status).toBe(403);
  });

  it("ドライバーの PDF：リンクが正しければ出す。見出しは検索に出さない・残さない", async () => {
    const { GET } = await import("~/app/api/t/[token]/pdf/route");
    const res = await GET(new Request("https://shimebi.example/"), { params: Promise.resolve({ token: await tokenOf(D.D01) }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const bad = await GET(new Request("https://shimebi.example/"), { params: Promise.resolve({ token: "broken.token" }) });
    expect(bad.status).toBe(404);
  });
});
