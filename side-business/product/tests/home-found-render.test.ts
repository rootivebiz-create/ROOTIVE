import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { FoundCard } from "~/components/home/found-card";
import type { SessionUser } from "~/server/auth";
import type { HomeStatus } from "~/server/features/home/types";
import { runReconcile } from "~/server/features/reconcile";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * ホームの横のカード（見つけたお金・会社がかぶる消費税・取引条件・質問の一覧・本番の月）を HTML にして確かめる。
 * 確定と見込みは別の行で、足した数を出さない。閲覧の人には明示書を作るリンクを出さない。
 */
const state: { db?: Db; user?: SessionUser } = {};
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => state.user,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("~/server/features/watch", () => ({ runWatch: async () => [] }));

const FORBIDDEN = [/適法/, /違反はありません/, /問題ありません/, /完全対応/, /大丈夫/, /必ず合う/, /ミスゼロ/, /完全自動/, /補助金/, /下げ(る|ましょう|てください)/, /未払いです/];

async function render(m = "2026-10"): Promise<string> {
  const { default: HomePage } = await import("~/app/(app)/page");
  const el = await HomePage({ searchParams: Promise.resolve({ m }) });
  return renderToString(el as ReactElement).replace(/<!-- -->/g, "");
}

describe("ホームの横のカード", () => {
  let client: PGlite;
  let tenantId: string;
  let staff: SessionUser;

  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(t.db));
    const [u] = await t.db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
    staff = { id: u.id, tenantId, email: u.email, name: u.name, role: "staff" };
  });
  afterAll(async () => client.close());

  it("事務：見つけたお金（確定と見込みを別の行）・会社がかぶる消費税・取引条件の記録が無い人・本番はまだ", async () => {
    state.user = staff;
    const db = state.db!;
    const [notice] = await db.select().from(s.paymentNotices).where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.month, DEMO_MONTH)));
    await runReconcile(db, tenantId, notice.id);
    const items = await db.select().from(s.reconciliationItems).where(eq(s.reconciliationItems.tenantId, tenantId));
    const night = items.find((i) => i.diff === -10_000)!;
    await db.update(s.reconciliationItems).set({ status: "resolved", recoveredAmount: 10_000 }).where(and(eq(s.reconciliationItems.id, night.id), eq(s.reconciliationItems.tenantId, tenantId)));

    const html = await render();
    expect(html).toContain("見つけたお金（2026年10月分・元請との突合）");
    expect(html).toContain("確定");
    expect(html).toContain("¥10,000");
    expect(html).toContain("見込み");
    expect(html).toContain("¥81,700");
    // 足し合わせた額（91,700円 や 10,000 ＋ 81,700）は出さない
    expect(html).not.toContain("¥91,700");
    expect(html).toContain("確定と見込みは別の数です。足し合わせていません。");
    // 会社がかぶる消費税（別の行）
    expect(html).toContain("免税の方への支払で、会社がかぶる消費税");
    expect(html).toContain("¥20,490");
    expect(html).toContain("2028年10月からは 月 ");
    expect(html).toContain("¥34,150");
    expect(html).toContain("今の段階より +13,660円");
    // 取引条件
    expect(html).toContain("この月に稼働した 8人のうち 1人は、取引条件を明示した記録が見つかりません");
    expect(html).toContain("遠藤 大輔さんの明示書を作る");
    expect(html).toMatch(/href="\/terms\/[0-9a-f-]{36}"/);
    expect(html).toContain('href="/terms"');
    // 本番の月
    expect(html).toContain("本番に切り替えた月");
    expect(html).toContain("まだです。今の Excel と並べて締め");
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });

  it("閲覧：明示書を作るリンクは出さない。質問があれば一覧（/statements/inbox）へのリンク。本番の月が出る", async () => {
    const db = state.db!;
    await generateStatements(db, tenantId, DEMO_MONTH);
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH))).limit(1);
    await db.insert(s.statementMessages).values({ tenantId, statementId: st.id, author: "driver", body: "宅配の個数が 1 個少ない気がします" });
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    await db.update(s.tenants).set({ onboarding: { ...t.onboarding, golive: "2026-10-01" } }).where(eq(s.tenants.id, tenantId));

    state.user = { ...staff, role: "viewer" };
    const html = await render();
    expect(html).not.toContain("明示書を作る");
    expect(html).toContain('href="/statements/inbox"');
    expect(html).toContain("質問の一覧を開く（全部の月で 1 件）");
    expect(html).toContain("2026年10月分</span>から、Excel をやめて、しめ日ラボで締めています。");
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });
});

describe("見つけたお金のカード：差が無い・行を読めない・読めなかったとき", () => {
  const base = (reconcile: Partial<HomeStatus["reconcile"]>, found: Partial<HomeStatus["found"]> = {}) =>
    ({
      month: DEMO_MONTH,
      reconcile: { notices: 1, items: 0, openItems: 0, openDiff: 0, short: 0, over: 0, unread: 0, error: null, ...reconcile },
      found: { confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0, ...found },
      burden: { affected: false, people: 0, current: 0, next: null },
    }) as unknown as HomeStatus;
  const html = (st: HomeStatus) => renderToString(React.createElement(FoundCard, { st })).replace(/<!-- -->/g, "");

  it("比べて差が無ければ、そう書く（「突き合わせると」とは言わない）", () => {
    const out = html(base({}));
    expect(out).toContain("支払通知 1 件と当社の記録（数量 × 受注単価）を比べて、差は見つかりませんでした。");
    expect(out).not.toContain("確定と見込みは別の数です");
  });

  it("行を読み取れていない通知しか無いときは「差が無い」と言わず、列を選ぶよう案内する", () => {
    const out = html(base({ unread: 1 }));
    expect(out).toContain("支払通知 1 件の行を、まだ読み取れていません。");
    expect(out).not.toContain("差は見つかりませんでした");
  });

  it("行が読めない通知でも、確定した額（取り戻せた額）は消さずに出し、読めない通知があることを添える", () => {
    const out = html(base({ unread: 1 }, { confirmed: 12_345, confirmedCount: 1 }));
    expect(out).toContain("¥12,345");
    expect(out).toContain("行を読み取れていない支払通知が 1 件あります");
    expect(out).not.toContain("まだ読み取れていません");
  });

  it("2 通のうち 1 通が読めないときは、読めた方の差を出し、読めない通知を添える", () => {
    const out = html(base({ notices: 2, unread: 1, items: 1, openItems: 1, short: 5_000, openDiff: -5_000 }, { estimated: 5_000, estimatedCount: 1 }));
    expect(out).toContain("¥5,000");
    expect(out).toContain("行を読み取れていない支払通知が 1 件あります");
  });

  it("突合を読めなかったときは理由だけを出し、額を出さない", () => {
    const out = html(base({ error: "突合の結果を読めませんでした。元請との突合の画面で確かめてください。" }));
    expect(out).toContain("突合の結果を読めませんでした");
    expect(out).not.toContain("差は見つかりませんでした");
    expect(out).not.toContain("¥");
    for (const re of FORBIDDEN) expect(out).not.toMatch(re);
  });
});
