import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { deductibleRateForExempt, nonDeductibleTax } from "@/lib/payroll/tax";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import type { StatementDraft } from "~/server/calc/statement";
import { loadPortal } from "~/server/features/portal";
import { getStatementDetail, staffLinkToken, statementPdfSource } from "~/server/features/statements";
import { companyCopy, ratePercent, shortMonthDay, stepSpan } from "~/server/features/statements/company-copy";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, readSnapshot } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 会社の控え：登録番号の無い方への支払で、会社が控除できずに負担する消費税（経過措置）。
 * 締めの期間が割合の変わる日をまたぐときは日ごとに分けた内訳を出し、日付の無い稼働があれば黄色で知らせる。
 * 会社の画面にだけ出し、ドライバーの画面・PDF には出さない。割合は共有の表から（ここでも直書きしない）。
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
    requireUser: async () => state.user,
    currentUser: async () => null,
    clientIpHash: async () => "ip-company-copy",
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

const SEP = "2026-09-25";
const OCT = "2026-10-05";
const pct = (date: string) => `${ratePercent(deductibleRateForExempt(date))}%`;

let db: Db;
let client: PGlite;
let tenantId: string;

async function statementOf(code: string, tid = tenantId) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
}

function html(el: ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

async function detailHtml(id: string): Promise<string> {
  const { default: Page } = await import("~/app/(app)/statements/[id]/page");
  return html((await Page({ params: Promise.resolve({ id }) })) as ReactElement);
}

/** 20 日締め（10 月分 ＝ 9/21〜10/20）にし、上田さん（登録なし）の宅配 1,840 個を 9/25 に 900 個・10/5 に 940 個と日付つきで入れる */
async function spanningSetup() {
  await db.update(s.tenants).set({ closingDay: 20 }).where(eq(s.tenants.id, tenantId));
  const { driver } = await statementOf("D03");
  const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
  await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, driver.id)));
  await db.insert(s.workEntries).values([
    { tenantId, month: DEMO_MONTH, driverId: driver.id, projectId: takuhai.id, qty: 900, workDate: SEP },
    { tenantId, month: DEMO_MONTH, driverId: driver.id, projectId: takuhai.id, qty: 940, workDate: OCT },
  ]);
  await generateStatements(db, tenantId, DEMO_MONTH);
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  const [u] = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId)).limit(1);
  state.user = { id: u.id, tenantId, email: u.email, name: u.name, role: "viewer" };
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("会社の控え（写しから）", () => {
  it("末締めの 10 月：期間はまたがない。上田さんの負担は税込の支払 × 10/110 × (1 − 割合)", async () => {
    const { st } = await statementOf("D03");
    const draft = readSnapshot(st);
    const copy = companyCopy(draft);
    // 委託料 276,000 ＋ 消費税相当額 27,600 ＝ 303,600 円（税込）
    expect(copy).toMatchObject({ unregistered: true, invoiceBurden: nonDeductibleTax(303_600, "2026-10-31"), parts: [], partsText: null, undatedAcrossStep: false });
    expect(copy.invoiceBurden).toBe(8_280);
    expect(copy.deductibleRatePercent).toBe(ratePercent(deductibleRateForExempt("2026-10-31")));
    // 登録ありの人は、この欄を出さない
    expect(companyCopy(readSnapshot((await statementOf("D01")).st))).toMatchObject({ unregistered: false, invoiceBurden: 0 });
  });

  it("20 日締め（9/21〜10/20）で日付つきの稼働：9/21〜9/30 と 10/1〜10/20 に分けた内訳（デモの数字）", async () => {
    await spanningSetup();
    const { st } = await statementOf("D03");
    const copy = companyCopy(readSnapshot(st));
    // 税込 303,600 円を、稼働の金額（135,000 : 141,000）で 148,500 と 155,100 に分ける
    expect(copy.parts.map((p) => [p.label, p.spanFrom, p.spanTo, p.from, p.to, p.base, p.burden, p.ratePercent])).toEqual([
      ["9/21〜9/30", "2026-09-21", "2026-09-30", SEP, SEP, 148_500, nonDeductibleTax(148_500, SEP), ratePercent(deductibleRateForExempt(SEP))],
      ["10/1〜10/20", "2026-10-01", "2026-10-20", OCT, OCT, 155_100, nonDeductibleTax(155_100, OCT), ratePercent(deductibleRateForExempt(OCT))],
    ]);
    expect(copy.parts.map((p) => p.burden)).toEqual([2_700, 4_230]);
    expect(copy.invoiceBurden).toBe(6_930);
    expect(copy.partsText).toBe(`9/21〜9/30 ¥2,700（${pct(SEP)}）／10/1〜10/20 ¥4,230（${pct(OCT)}）`);
    expect(copy.undatedAcrossStep).toBe(false);
    // 期間全体を末日（10/20）の割合で数えた場合（国税庁の Q&A の役務の例の数え方）も、写しの数字から出す
    expect(copy.periodEndBurden).toBe(nonDeductibleTax(303_600, "2026-10-20"));
    expect(copy.periodEndBurden).toBe(8_280);
    expect(copy.deductibleRatePercent).toBe(ratePercent(deductibleRateForExempt("2026-10-20")));
  });

  it("日付の無い稼働が期間をまたぐときは、按分せずに黄色の注意（木村さん）", async () => {
    await spanningSetup();
    const { st } = await statementOf("D07");
    const copy = companyCopy(readSnapshot(st));
    expect(copy).toMatchObject({ unregistered: true, parts: [], partsText: null, undatedAcrossStep: true, periodEndBurden: null });
    // 期間の末日（10/20）の割合で計算
    expect(copy.invoiceBurden).toBe(nonDeductibleTax(readSnapshot(st).subtotal + readSnapshot(st).tax, "2026-10-20"));
  });

  it("古い写し（内訳・印・割合が無い）でも壊れない", () => {
    const old = { driver: { invoiceRegistered: false }, invoiceBurden: 1_234, period: { from: "2026-10-01", to: "2026-10-31" } } as unknown as StatementDraft;
    expect(companyCopy(old)).toEqual({ unregistered: true, invoiceBurden: 1_234, deductibleRatePercent: null, parts: [], partsText: null, undatedAcrossStep: false, periodEndBurden: null });
    const older = { driver: { invoiceRegistered: false } } as unknown as StatementDraft;
    expect(companyCopy(older).invoiceBurden).toBe(0);
  });

  it("純関数：段の範囲を期間で切る・日付の書き方", () => {
    expect(stepSpan(SEP, { from: "2026-09-21", to: "2026-10-20" })).toEqual({ from: "2026-09-21", to: "2026-09-30" });
    expect(stepSpan(OCT, { from: "2026-09-21", to: "2026-10-20" })).toEqual({ from: "2026-10-01", to: "2026-10-20" });
    expect(stepSpan("2020-01-01", { from: "2019-12-21", to: "2020-01-20" }, "2020-01-05")).toEqual({ from: "2020-01-01", to: "2020-01-05" });
    expect(shortMonthDay("2026-10-01")).toBe("10/1");
    expect(shortMonthDay("x")).toBe("x");
  });
});

describe("出す所・出さない所", () => {
  it("会社の画面（1 人の明細）には出る。黄色の注意も", async () => {
    await spanningSetup();
    const ueda = await detailHtml((await statementOf("D03")).st.id);
    expect(ueda).toContain("会社の控え：経過措置の負担（ドライバーには見せません）");
    expect(ueda).toContain(`9/21〜9/30 ¥2,700（${pct(SEP)}）／10/1〜10/20 ¥4,230（${pct(OCT)}）`);
    expect(ueda).toContain("¥6,930");
    expect(ueda).not.toContain("日付の無い稼働があり");
    // 割合は「期間の末日の割合」。日ごとに分けたのは目安で、期間全体を末日の割合で数えた額も並べ、税理士に確かめてもらう
    expect(ueda).toContain("期間の末日の割合");
    expect(ueda).not.toContain("控除できる割合（期間の末日で判定）");
    expect(ueda).toContain("会社が負担する消費税（日ごとに分けた目安）");
    expect(ueda).toContain("稼働の日ごとに割合を分けた目安です。国税庁の Q&amp;A には、9月21日から提供を受けて10月20日に完了した役務を、期間全体で10月1日以後の割合とする例があります。どちらで扱うかは税理士にご確認ください");
    expect(ueda).toContain(`期間全体を末日の割合（${pct("2026-10-20")}）で数えた場合：<span class="num whitespace-nowrap">¥8,280</span>）`);
    expect(ueda).toContain("会計ソフト向けの仕訳の税区分は、期間の末日の割合で出します");
    const kimura = await detailHtml((await statementOf("D07")).st.id);
    expect(kimura).toContain("日付の無い稼働があり、期間の末日の割合で計算しています");
    // 登録ありの人には出さない
    expect(await detailHtml((await statementOf("D01")).st.id)).not.toContain("会社の控え");
  });

  it("会社の消費税の計算が原則課税でなければ、そう書く", async () => {
    await db.update(s.tenants).set({ taxMethod: "simplified" }).where(eq(s.tenants.id, tenantId));
    await generateStatements(db, tenantId, DEMO_MONTH);
    const h = await detailHtml((await statementOf("D03")).st.id);
    expect(h).toContain("原則課税ではない設定のため、この負担は 0 円として計算しています");
    const detail = (await getStatementDetail(db, tenantId, (await statementOf("D03")).st.id))!;
    expect(detail.company.invoiceBurden).toBe(0);
    expect(detail.taxMethod).toBe("simplified");
  });

  it("明細を作ったあとで会社の設定を原則課税以外に変えた：写しの数字（8,280 円）を出し、作ったときの設定だと書く", async () => {
    await db.update(s.tenants).set({ taxMethod: "simplified" }).where(eq(s.tenants.id, tenantId));
    const h = await detailHtml((await statementOf("D03")).st.id);
    expect(h).toContain("¥8,280");
    expect(h).toContain("下の数字は、明細を作ったときの設定（原則課税）で計算したものです");
    expect(h).not.toContain("この負担は 0 円として計算しています");
  });

  it("ドライバーの画面・ドライバーの PDF には出ない", async () => {
    await spanningSetup();
    const { st } = await statementOf("D03");
    const token = staffLinkToken(st).token;
    const data = (await loadPortal(db, token))!;
    const json = JSON.stringify(data);
    for (const word of ["invoiceBurden", "burdenParts", "deductibleRate", "undatedAcrossStep", "6930"]) expect(json).not.toContain(word);
    const { default: Page } = await import("~/app/s/[token]/page");
    const portal = html((await Page({ params: Promise.resolve({ token }) })) as ReactElement);
    for (const word of ["会社の控え", "経過措置の負担", "¥6,930", "6,930", "日付の無い稼働"]) expect(portal).not.toContain(word);

    const source = (await statementPdfSource(db, tenantId, st.id))!;
    expect(JSON.stringify(source)).not.toContain("invoiceBurden");
    let layout: unknown;
    await renderStatementsPdf([source], new Date("2026-11-01T09:00:00+09:00"), { onLayout: (l) => (layout = l) });
    const text = collectText(layout);
    expect(text).toContain("消費税相当額");
    // （「車両修理の負担分」は上田さんの調整の名前なので、会社の負担の言葉だけを探す）
    for (const word of ["会社の控え", "経過措置の負担", "会社が負担", "6,930"]) expect(text).not.toContain(word);
  });
});

/** PDF の配置から、描いた文字をすべて集める */
function collectText(node: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as { lines?: { string?: string }[]; children?: unknown[] };
    for (const l of o.lines ?? []) if (typeof l.string === "string") out.push(l.string);
    for (const c of o.children ?? []) walk(c);
  };
  walk(node);
  return out.join("\n");
}
