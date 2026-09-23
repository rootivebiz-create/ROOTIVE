import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { confirmFromPortal, findStatementByToken, loadPortal } from "~/server/features/portal";
import { markStatementSent, recreateStatementLink, staffLinkToken } from "~/server/features/statements";
import { compareMonths } from "~/server/features/statements/compare";
import type { DriverStatementView } from "~/server/features/statements/view";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * ドライバーの画面の「先月との比べ」と「ほかの月の明細」。
 * 見せるのは同じ会社・同じドライバーの、締めた月か会社が送った明細だけ。リンクは明細ごとに署名して作る。
 */
const state: { db?: Db } = {};
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  class AuthError extends Error {}
  return {
    roleAtLeast: () => false,
    requirePageUser: async () => undefined,
    requireUser: async () => undefined,
    currentUser: async () => null,
    clientIpHash: async () => "ip-portal-months",
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

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ctx = { ipHash: "ip-months", userAgent: IPHONE };

let db: Db;
let client: PGlite;
let tenantId: string;

async function statementOf(code: string, tid = tenantId, month = DEMO_MONTH) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, month), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
}

async function tokenOf(code: string, tid = tenantId, month = DEMO_MONTH) {
  return staffLinkToken((await statementOf(code, tid, month)).st).token;
}

/** 9 月（締め済み）の明細を作る：いったん締めを外して作り、締め直す */
async function makeSeptember(tid = tenantId, close = true) {
  await db.update(s.monthCloses).set({ status: "open" }).where(and(eq(s.monthCloses.tenantId, tid), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
  await generateStatements(db, tid, DEMO_PREV_MONTH);
  if (close) await db.update(s.monthCloses).set({ status: "closed" }).where(and(eq(s.monthCloses.tenantId, tid), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
}

function tokenFromHref(href: string): string {
  expect(href.startsWith("/s/")).toBe(true);
  return href.slice(3);
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("先月との比べ", () => {
  it("青木さん：9 月（締め済み）と 10 月の振込額・委託料・引かれているもの・案件ごとの数量", async () => {
    await makeSeptember();
    const data = (await loadPortal(db, await tokenOf("D01")))!;
    expect(data.compare).not.toBeNull();
    const c = data.compare!;
    expect(c).toMatchObject({ prevMonth: DEMO_PREV_MONTH, prevLabel: "2026年9月", curLabel: "2026年10月" });
    expect(c.total).toEqual({ before: 338_415, after: 357_555, diff: 19_140 });
    expect(c.subtotal).toEqual({ before: 358_500, after: 374_500, diff: 16_000 });
    expect(c.deductions).toEqual({ before: 55_935, after: 57_695, diff: 1_760 });
    expect(c.qty.map((q) => [q.project, q.unit, q.before, q.after, q.diff])).toEqual([
      ["スポット便", "件", 3, 4, 1],
      ["宅配（個建て）", "個", 2250, 2310, 60],
    ]);
    // 会社の数字（売上・受注の単価）は入らない
    const json = JSON.stringify(c);
    for (const word of ["sales", "billRate", "invoiceBurden", "474900"]) expect(json).not.toContain(word);
  });

  it("先月の明細が作りかけ（締めていない・送っていない）なら出さない。送れば出る", async () => {
    await makeSeptember(tenantId, false);
    const token = await tokenOf("D01");
    let data = (await loadPortal(db, token))!;
    expect(data.compare).toBeNull();
    expect(data.others).toEqual([]);
    const { st: sep } = await statementOf("D01", tenantId, DEMO_PREV_MONTH);
    await markStatementSent(db, tenantId, sep.id, null, "line");
    data = (await loadPortal(db, token))!;
    expect(data.compare?.total.before).toBe(338_415);
    expect(data.others.map((o) => o.month)).toEqual([DEMO_PREV_MONTH]);
  });

  it("先月の明細が無いときは出さない（9 月の明細を作っていない）", async () => {
    const data = (await loadPortal(db, await tokenOf("D04")))!;
    expect(data.compare).toBeNull();
    expect(data.others).toEqual([]);
  });

  it("純関数：先月だけの案件・今月だけの案件・小数の数量", () => {
    const view = (month: string, lines: { key: string; project: string; qty: number }[], total: number): DriverStatementView =>
      ({
        month,
        lines: lines.map((l) => ({ ...l, client: null, unit: "時間", rate: 2000, amount: l.qty * 2000 })),
        subtotal: total,
        deductionTotal: 100,
        deductionTax: 10,
        total,
      }) as unknown as DriverStatementView;
    const c = compareMonths(
      view("2026-12-01", [{ key: "a", project: "ルート", qty: 10.1 }, { key: "b", project: "夜間", qty: 2 }], 5_000),
      view("2027-01-01", [{ key: "a", project: "ルート", qty: 10.3 }, { key: "c", project: "スポット", qty: 1 }], 4_000),
    );
    expect(c).toMatchObject({ prevLabel: "2026年12月", curLabel: "2027年1月", total: { before: 5_000, after: 4_000, diff: -1_000 } });
    expect(c.deductions).toEqual({ before: 110, after: 110, diff: 0 });
    expect(c.qty.map((q) => [q.key, q.before, q.after, q.diff])).toEqual([
      ["a", 10.1, 10.3, 0.2],
      ["c", null, 1, 1],
      ["b", 2, null, -2],
    ]);
  });
});

describe("ほかの月の明細", () => {
  it("同じ人の明細だけ、新しい月が上。リンクで開くとその月の明細（確認済みの印つき）", async () => {
    await makeSeptember();
    // 11 月も作る（締めていない・送っていない → まだ出さない）
    const { driver } = await statementOf("D01");
    const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
    await db.insert(s.workEntries).values({ tenantId, month: "2026-11-01", driverId: driver.id, projectId: takuhai.id, qty: 100 });
    await generateStatements(db, tenantId, "2026-11-01");
    await confirmFromPortal(db, await tokenOf("D01", tenantId, DEMO_PREV_MONTH), { version: 1 }, ctx);

    const oct = (await loadPortal(db, await tokenOf("D01")))!;
    expect(oct.others.map((o) => [o.label, o.total, o.payDate, o.confirmed])).toEqual([["2026年9月", 338_415, "2026-10-25", true]]);
    const sepToken = tokenFromHref(oct.others[0].href);
    const sep = (await loadPortal(db, sepToken))!;
    expect(sep.view).toMatchObject({ month: DEMO_PREV_MONTH, total: 338_415 });
    expect(sep.view.driver.name).toBe("青木 翔太");
    // 9 月の画面からは、10 月（締めていない・送っていない）はまだ見えない
    expect(sep.others).toEqual([]);

    // 10 月・11 月を送ると、どちらも並ぶ（新しい月が上）
    const { st: novSt } = await statementOf("D01", tenantId, "2026-11-01");
    await markStatementSent(db, tenantId, (await statementOf("D01")).st.id, null, "copy");
    await markStatementSent(db, tenantId, novSt.id, null, "copy");
    const sep2 = (await loadPortal(db, sepToken))!;
    // 11 月は宅配 100 個だけ（管理費を引くとマイナス）
    expect(sep2.others.map((o) => [o.label, o.total])).toEqual([
      ["2026年11月", -1_650],
      ["2026年10月", 357_555],
    ]);
    expect(sep2.compare).toBeNull(); // 8 月の明細は無い
    const nov = (await loadPortal(db, tokenFromHref(sep2.others[0].href)))!;
    expect(nov.compare?.total).toEqual({ before: 357_555, after: -1_650, diff: -359_205 });
    expect(nov.compare?.qty.map((q) => [q.project, q.before, q.after, q.diff])).toEqual([
      ["宅配（個建て）", 2310, 100, -2210],
      ["スポット便", 4, null, -4],
    ]);
  });

  it("A さんのリンクから B さんの明細には行けない。他社の同じ名前の人の明細も出ない", async () => {
    await makeSeptember();
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    await makeSeptember(b.tenantId);
    // どの明細も送ってある（見せてよい状態）にしておく
    await db.update(s.statements).set({ sentAt: new Date(Date.now() + 60_000) });

    const [aoki] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    const [ueda] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D03")));
    for (const [code, driverId] of [
      ["D01", aoki.id],
      ["D03", ueda.id],
    ] as const) {
      const data = (await loadPortal(db, await tokenOf(code)))!;
      expect(data.others).toHaveLength(1);
      for (const o of data.others) {
        const st = (await findStatementByToken(db, tokenFromHref(o.href)))!;
        expect(st.driverId).toBe(driverId);
        expect(st.tenantId).toBe(tenantId);
      }
    }
    // 青木さんのリンクの「ほかの月」は、上田さんの明細を指さない
    const aokiLinks = (await loadPortal(db, await tokenOf("D01")))!.others.map((o) => tokenFromHref(o.href));
    const uedaIds = new Set((await db.select({ id: s.statements.id }).from(s.statements).where(eq(s.statements.driverId, ueda.id))).map((r) => r.id));
    for (const t of aokiLinks) expect(uedaIds.has((await findStatementByToken(db, t))!.id)).toBe(false);
    // B 社の青木さんのリンクからは、B 社の明細だけ
    const bData = (await loadPortal(db, await tokenOf("D01", b.tenantId)))!;
    const bSep = (await findStatementByToken(db, tokenFromHref(bData.others[0].href)))!;
    expect(bSep.tenantId).toBe(b.tenantId);
  });

  it("明細のリンクを作り直すと、ほかの月から作るリンクも新しいものになる（古いリンクは使えない）", async () => {
    await makeSeptember();
    const { st: sep } = await statementOf("D01", tenantId, DEMO_PREV_MONTH);
    const old = staffLinkToken(sep).token;
    await recreateStatementLink(db, tenantId, sep.id, null);
    expect(await findStatementByToken(db, old)).toBeNull();
    const oct = (await loadPortal(db, await tokenOf("D01")))!;
    expect(oct.others).toHaveLength(1);
    expect((await findStatementByToken(db, tokenFromHref(oct.others[0].href)))?.id).toBe(sep.id);
  });

  it("間違った相手に送ったとき：「ほかの月も作り直す」で、先にたどって残ったほかの月のリンクも使えなくなる", async () => {
    await makeSeptember();
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const { st: oct } = await statementOf("D01");
    await markStatementSent(db, tenantId, oct.id, null, "line");
    const octToken = staffLinkToken(oct).token;
    // 受け取った人が、10 月のページから 9 月へたどってリンクを手元に残した
    const sepToken = tokenFromHref((await loadPortal(db, octToken))!.others[0].href);
    const { st: sepBefore } = await statementOf("D01", tenantId, DEMO_PREV_MONTH);
    const ueda = (await statementOf("D03")).st;
    const bAoki = (await statementOf("D01", b.tenantId)).st;

    // 10 月だけ作り直すと、9 月のリンクは使えるまま（だから画面では「ほかの月も」を最初から選んでおく）
    await recreateStatementLink(db, tenantId, oct.id, null);
    expect(await findStatementByToken(db, octToken)).toBeNull();
    expect((await findStatementByToken(db, sepToken))?.id).toBe(sepBefore.id);

    // ほかの月も作り直す：9 月（締め済み）のリンクも使えなくなる。送った記録は 9 月には残る
    const r = await recreateStatementLink(db, tenantId, oct.id, null, { allMonths: true });
    expect(r.otherMonths).toBe(1);
    expect(await findStatementByToken(db, sepToken)).toBeNull();
    const { st: sepAfter } = await statementOf("D01", tenantId, DEMO_PREV_MONTH);
    expect(sepAfter.linkNonce).not.toBe(sepBefore.linkNonce);
    expect(sepAfter.sentAt?.getTime() ?? null).toBe(sepBefore.sentAt?.getTime() ?? null);
    expect(sepAfter.total).toBe(338_415);
    // 新しい 10 月のリンクからは、9 月へ今までどおり行ける
    const fresh = (await loadPortal(db, await tokenOf("D01")))!;
    expect(fresh.others.map((o) => [o.label, o.total])).toEqual([["2026年9月", 338_415]]);
    expect((await findStatementByToken(db, tokenFromHref(fresh.others[0].href)))?.id).toBe(sepBefore.id);
    // ほかの人・他社の明細のリンクは変えない
    expect((await statementOf("D03")).st.linkNonce).toBe(ueda.linkNonce);
    expect((await statementOf("D01", b.tenantId)).st.linkNonce).toBe(bAoki.linkNonce);
    // 操作の記録に、作り直したほかの月が残る
    const logs = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.relink")));
    expect(logs.map((l) => (l.detail as { otherMonths?: string[] }).otherMonths)).toContainEqual(["2026-09"]);
    // 他社の明細の id では作り直せない
    await expect(recreateStatementLink(db, tenantId, bAoki.id, null, { allMonths: true })).rejects.toThrow("見つかりません");
    expect((await statementOf("D01", b.tenantId)).st.linkNonce).toBe(bAoki.linkNonce);
  });
});

describe("画面 /s/[token]", () => {
  it("先月との比べ・ほかの月の明細が出る。会社の数字は出ない", async () => {
    await makeSeptember();
    const { default: Page } = await import("~/app/s/[token]/page");
    const h = renderToString((await Page({ params: Promise.resolve({ token: await tokenOf("D01") }) })) as ReactElement).replace(/<!-- -->/g, "");
    expect(h).toContain("先月との比べ");
    expect(h).toContain("338,415円");
    expect(h).toContain("＋19,140円");
    expect(h).toContain("＋60");
    expect(h).toContain("ほかの月の明細");
    expect(h).toContain("2026年9月分");
    expect(h).toMatch(/href="\/s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/);
    for (const word of ["billRate", "invoiceBurden", "利益", "売上", "474,900"]) expect(h).not.toContain(word);
    // 口座番号は下 3 桁だけ（会社の登録番号 T1234567890123 に同じ並びがあるので、それを除いて探す）
    expect(h).toContain("口座番号の下3桁 567");
    expect(h.replaceAll("T1234567890123", "")).not.toContain("1234567");
  });
});
