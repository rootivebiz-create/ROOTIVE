import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { buildStatementDrafts } from "~/server/calc/statement";
import { burdenSplit, foundFromCells, loadCeoSheet, loadProfitPage, monthProfit } from "~/server/features/profit";
import { runReconcile, type Report } from "~/server/features/reconcile";
import { renderCeoPdf } from "~/server/pdf/ceo-pdf";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 利益：見つけたお金（確定と見込みを分けて）・期間の途中で経過措置の割合が変わる月の日ごとの内訳・社長の 1 枚。
 * 数はデモの 10 月の額（突合：宅配 81,700円・夜間便 10,000円 少ない）と、20 日締めにして日付を入れた上田さん。
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
vi.mock("~/server/features/watch", () => ({ runWatch: async () => [] }));

const noWatch = { runWatch: async () => [] };
const FORBIDDEN = [/適法/, /違反はありません/, /問題ありません/, /完全対応/, /大丈夫/, /必ず合う/, /未払いです/, /下げ(る|ましょう|てください)/];

function pages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("latin1");
  expect(text.slice(0, 5)).toBe("%PDF-");
  return Math.max(...[...text.matchAll(/\/Count (\d+)/g)].map((x) => Number(x[1])));
}

async function renderProfit(m: string): Promise<string> {
  const { default: Page } = await import("~/app/(app)/profit/page");
  const el = (await Page({ searchParams: Promise.resolve({ m }) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}

/** 20 日締めにして、上田さん（登録なし）の 10 月の宅配を 9/28 に 1,000個・10/5 に 840個 にする */
async function splitMonth(db: Db, tenantId: string) {
  await db.update(s.tenants).set({ closingDay: 20 }).where(eq(s.tenants.id, tenantId));
  const [ueda] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D03")));
  const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
  await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, ueda.id)));
  await db.insert(s.workEntries).values([
    { tenantId, month: DEMO_MONTH, driverId: ueda.id, projectId: takuhai.id, qty: 1000, workDate: "2026-09-28" },
    { tenantId, month: DEMO_MONTH, driverId: ueda.id, projectId: takuhai.id, qty: 840, workDate: "2026-10-05" },
  ]);
}

describe("見つけたお金（利益の画面・社長の 1 枚）", () => {
  it("突合の画面と同じ数え方：まだ突き合わせていなくても見込み 91,700円（2 件）。解決で確定 10,000円・見込み 81,700円。ほかの会社は混ざらない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);

    let page = await loadProfitPage(db, tenantId, DEMO_MONTH);
    expect(page.found).toEqual({ notices: 1, confirmed: 0, confirmedCount: 0, estimated: 91_700, estimatedCount: 2, error: null, unread: 0 });
    let sheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, noWatch);
    expect(sheet.found).toEqual(page.found);

    const [notice] = await db.select().from(s.paymentNotices).where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.month, DEMO_MONTH)));
    await runReconcile(db, tenantId, notice.id);
    const items = await db.select().from(s.reconciliationItems).where(eq(s.reconciliationItems.tenantId, tenantId));
    const night = items.find((i) => i.diff === -10_000)!;
    await db
      .update(s.reconciliationItems)
      .set({ status: "resolved", resolvedAt: new Date(), recoveredAmount: 10_000 })
      .where(and(eq(s.reconciliationItems.id, night.id), eq(s.reconciliationItems.tenantId, tenantId)));
    page = await loadProfitPage(db, tenantId, DEMO_MONTH);
    expect(page.found).toEqual({ notices: 1, confirmed: 10_000, confirmedCount: 1, estimated: 81_700, estimatedCount: 1, error: null, unread: 0 });
    sheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, noWatch);
    expect(sheet.found).toEqual(page.found);
    // 突合の差の数え方（前からの形）は変わらない
    expect(sheet.reconcile).toMatchObject({ notices: 1, count: 1, short: 81_700 });
    // 利益には入れない（見込みも確定も）
    expect(page.current.totals.profit).toBe(980_270);

    // ほかの会社は、その会社の数だけ
    expect((await loadProfitPage(db, otherId, DEMO_MONTH)).found).toMatchObject({ confirmed: 0, estimated: 91_700 });
    // 通知の無い月・読めなかったとき
    expect((await loadProfitPage(db, tenantId, DEMO_PREV_MONTH)).found).toMatchObject({ notices: 0, confirmed: 0, estimated: 0 });
    const broken = await loadProfitPage(db, tenantId, DEMO_MONTH, { loadReport: async () => { throw new Error("boom"); } });
    expect(broken.found.error).toContain("突合の結果を読めませんでした");
    expect(broken.current.totals.profit).toBe(980_270);
    const brokenSheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, { ...noWatch, loadReport: async () => { throw new Error("boom"); } });
    expect(brokenSheet.found.error).toContain("突合の結果を読めませんでした");
    await client.close();
  });

  it("純関数 foundFromCells：その月の、通知のあるセルだけを足す（確定と見込みは別の数）", () => {
    const cell = (month: string, notice: boolean, recovered: number, recoveredCount: number, short: number, shortCount: number, lineCount = 3) =>
      ({ month, notice: notice ? { id: "n", lineCount } : null, recovered, recoveredCount, short, shortCount }) as unknown as Report["cells"][number];
    expect(
      foundFromCells([cell(DEMO_MONTH, true, 5_000, 1, 20_000, 2), cell(DEMO_MONTH, true, 0, 0, 3_000, 1), cell(DEMO_MONTH, false, 0, 0, 0, 0), cell(DEMO_PREV_MONTH, true, 9_999, 1, 9_999, 1)], DEMO_MONTH),
    ).toEqual({ notices: 2, confirmed: 5_000, confirmedCount: 1, estimated: 23_000, estimatedCount: 3, error: null, unread: 0 });
    // 行を読み取れていない通知は数えるが、差は無い（「差が無い」と言わないために unread を返す）
    expect(foundFromCells([cell(DEMO_MONTH, true, 1_000, 1, 0, 0, 0), cell(DEMO_MONTH, true, 0, 0, 2_000, 1)], DEMO_MONTH)).toEqual({
      notices: 2,
      confirmed: 1_000,
      confirmedCount: 1,
      estimated: 2_000,
      estimatedCount: 1,
      error: null,
      unread: 1,
    });
  });
});

describe("期間の途中で経過措置の割合が変わる月（日ごとの内訳）", () => {
  it("20 日締めの 10 月（9/21〜10/20）：上田さんは 9/28 の分を 80%・10/5 の分を 70% で数える。日付の無い遠藤さん・木村さんは末日の割合", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    // またがない月（末締めの 10 月）は空
    expect(burdenSplit(buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH)))).toEqual({ people: 0, parts: [], total: 0, undated: [] });

    await splitMonth(db, tenantId);
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const split = burdenSplit(drafts);
    const ueda = drafts.find((d) => d.driver.code === "D03")!;
    expect(ueda.invoiceBurden).toBe(6_780);
    expect(split.people).toBe(1);
    expect(split.total).toBe(6_780);
    // 税込 303,600円を日ごとの金額（150,000円・126,000円）で分ける → 165,000円・138,600円
    expect(split.parts).toEqual([
      { from: "2026-09-28", to: "2026-09-28", rate: 0.8, base: 165_000, burden: 3_000, people: 1 },
      { from: "2026-10-05", to: "2026-10-05", rate: 0.7, base: 138_600, burden: 3_780, people: 1 },
    ]);
    expect(split.parts.reduce((a, p) => a + p.base, 0)).toBe(ueda.subtotal + ueda.tax);
    expect(split.undated.map((u) => u.name)).toEqual(["木村 誠", "遠藤 大輔"].sort((a, b) => a.localeCompare(b, "ja")));

    // 利益の合計の負担は、明細の負担の合計（遠藤 10,500・上田 6,780・木村 1,710）
    const mp = await monthProfit(db, tenantId, DEMO_MONTH);
    expect(mp.totals.burden).toBe(18_990);
    const page = await loadProfitPage(db, tenantId, DEMO_MONTH);
    expect(page.split).toEqual(split);
    const sheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, noWatch);
    expect(sheet.split).toEqual(split);
    // ほかの会社（末締めのまま）は空
    expect((await loadProfitPage(db, otherId, DEMO_MONTH)).split.people).toBe(0);

    // 社長の 1 枚：内訳の注記と見つけたお金の行が増えても 1 ページ（長い見張り番の指摘・突合の読めない通知つき）
    sheet.watch = { red: 3, yellow: 3, acked: 2, error: null, titles: Array.from({ length: 3 }, () => ({ severity: "red" as const, title: "取引条件を明示した記録が見つかりません。明示した日と方法を記録してください（とても長い見出しの例）", subject: "遠藤 大輔" })) };
    sheet.reconcile = { ...sheet.reconcile, over: 3_000, overCount: 1, unread: 1, notices: 2 };
    sheet.found = { notices: 2, confirmed: 123_456, confirmedCount: 3, estimated: 91_700, estimatedCount: 2, error: null };
    sheet.confirm = { statements: 8, confirmed: 3, deemed: 2, stale: true };
    sheet.transfer = { ...sheet.transfer, notPositive: 1 };
    expect(pages(await renderCeoPdf(sheet, new Date("2026-11-02T09:00:00+09:00")))).toBe(1);
    await client.close();
  });

  it("利益の画面：見つけたお金（別の行・足さない）と、日ごとの内訳・日付の無い人の注記を出す", async () => {
    const { db, client } = await createTestDb();
    state.db = db;
    const { tenantId } = await seedDemo(db);
    const [u] = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId)).limit(1);
    state.user = { id: u.id, tenantId, email: u.email, name: u.name, role: "viewer" };

    let html = await renderProfit("2026-10");
    expect(html).toContain("見つけたお金（元請の支払通知との突合）");
    expect(html).toContain("確定（取り戻せた額）");
    expect(html).toContain("まだありません");
    expect(html).toContain("見込み（まだ片付いていない差）");
    expect(html).toContain("¥91,700");
    expect(html).toContain("確定と見込みは別の数です（足し合わせていません）");
    expect(html).not.toContain("控除できる割合が変わる日をまたいでいます");
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);

    await splitMonth(db, tenantId);
    html = await renderProfit("2026-10");
    expect(html).toContain("この月の締めの期間は、控除できる割合が変わる日をまたいでいます");
    expect(html).toContain("2026年9月28日");
    expect(html).toContain("2026年10月5日");
    expect(html).toContain("¥165,000");
    expect(html).toContain("¥3,780");
    expect(html).toContain("¥6,780");
    expect(html).toContain("¥18,990");
    expect(html).toContain("日付の無い稼働がある 2人");
    expect(html).toContain("遠藤 大輔さん");
    expect(html).toContain("（この段階の割合で 1 か月まるごと数えると）");
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
    await client.close();
  });
});
