import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { homeReconcileFromCells, loadHomeStatus } from "~/server/features/home";
import { loadProfitPage } from "~/server/features/profit";
import { loadReport, runReconcile } from "~/server/features/reconcile";
import type { WatchIssue } from "~/server/features/watch-types";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";
import type { Db } from "~/db/client";

/**
 * ホームの「見つけたお金」（確定と見込みを分けて。足し合わせない）・会社がかぶる消費税の次の段階・
 * 取引条件の記録が無い人・本番に切り替えた月。数はデモの 10 月の額で確かめる。
 */
const quiet = { runWatch: async () => [] as WatchIssue[] };

async function noticeOf(db: Db, tenantId: string) {
  const [n] = await db
    .select()
    .from(s.paymentNotices)
    .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.month, DEMO_MONTH)));
  return n;
}

async function itemsOf(db: Db, tenantId: string, noticeId: string) {
  return db.select().from(s.reconciliationItems).where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
}

async function driverId(db: Db, tenantId: string, code: string): Promise<string> {
  const [d] = await db.select({ id: s.drivers.id }).from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d.id;
}

describe("ホーム：見つけたお金", () => {
  it("突合の画面・利益の画面と同じ数え方：突き合わせる前から見込み 91,700円。解決で確定に移り、足し合わせない。ほかの会社は混ざらない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);

    // A物流の 10 月：宅配 4,520個（当社 4,950個 → 430個 × 190円 ＝ 81,700円 少ない）・夜間便 11,500円（当社 12,000円 → 20便 × 500円 ＝ 10,000円 少ない）
    // まだ「突き合わせる」を押していなくても、突合の画面と同じ額が出る（ホームだけ 0 にならない）
    let st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.reconcile).toEqual({ notices: 1, items: 2, openItems: 2, openDiff: -91_700, short: 91_700, over: 0, unread: 0, error: null });
    expect(st.found).toEqual({ confirmed: 0, confirmedCount: 0, estimated: 91_700, estimatedCount: 2 });
    // 利益の画面（社長の 1 枚も同じ関数）と同じ数
    const profit = await loadProfitPage(db, tenantId, DEMO_MONTH);
    expect({ confirmed: profit.found.confirmed, estimated: profit.found.estimated }).toEqual({ confirmed: st.found.confirmed, estimated: st.found.estimated });

    const notice = await noticeOf(db, tenantId);
    await runReconcile(db, tenantId, notice.id);
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.found).toEqual({ confirmed: 0, confirmedCount: 0, estimated: 91_700, estimatedCount: 2 });
    expect(st.reconcile.short).toBe(91_700);

    // 夜間便の差を「問い合わせ済み」→ まだ見込み。「解決」にして 10,000円 取り戻した → 確定へ
    const items = await itemsOf(db, tenantId, notice.id);
    const night = items.find((i) => i.diff === -10_000)!;
    const takuhai = items.find((i) => i.diff === -81_700)!;
    await db.update(s.reconciliationItems).set({ status: "asked", askedAt: new Date() }).where(and(eq(s.reconciliationItems.id, night.id), eq(s.reconciliationItems.tenantId, tenantId)));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).found).toEqual({ confirmed: 0, confirmedCount: 0, estimated: 91_700, estimatedCount: 2 });
    await db
      .update(s.reconciliationItems)
      .set({ status: "resolved", resolvedAt: new Date(), recoveredAmount: 10_000 })
      .where(and(eq(s.reconciliationItems.id, night.id), eq(s.reconciliationItems.tenantId, tenantId)));
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.found).toEqual({ confirmed: 10_000, confirmedCount: 1, estimated: 81_700, estimatedCount: 1 });
    expect(st.reconcile).toMatchObject({ items: 2, openItems: 1, short: 81_700 });
    // 足し合わせた数は作らない（確定と見込みの 4 つだけ）
    expect(Object.keys(st.found).sort()).toEqual(["confirmed", "confirmedCount", "estimated", "estimatedCount"]);
    // 利益の画面と同じ
    const profit2 = await loadProfitPage(db, tenantId, DEMO_MONTH);
    expect(profit2.found).toMatchObject({ confirmed: 10_000, confirmedCount: 1, estimated: 81_700, estimatedCount: 1 });

    // 宅配の差を「受け入れる」→ どちらにも入らない。解決でも回収額が無ければ確定に入れない
    await db.update(s.reconciliationItems).set({ status: "accepted", note: "個数の数え方を確認済み" }).where(and(eq(s.reconciliationItems.id, takuhai.id), eq(s.reconciliationItems.tenantId, tenantId)));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).found).toEqual({ confirmed: 10_000, confirmedCount: 1, estimated: 0, estimatedCount: 0 });
    await db.update(s.reconciliationItems).set({ status: "resolved", recoveredAmount: null }).where(and(eq(s.reconciliationItems.id, takuhai.id), eq(s.reconciliationItems.tenantId, tenantId)));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).found).toEqual({ confirmed: 10_000, confirmedCount: 1, estimated: 0, estimatedCount: 0 });

    // ほかの会社の差を全部「解決・99,999円」にしても、この会社の数は変わらない。ほかの会社には、その会社の数だけ
    const otherNotice = await noticeOf(db, otherId);
    await runReconcile(db, otherId, otherNotice.id);
    await db.update(s.reconciliationItems).set({ status: "resolved", recoveredAmount: 99_999 }).where(eq(s.reconciliationItems.tenantId, otherId));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).found).toEqual({ confirmed: 10_000, confirmedCount: 1, estimated: 0, estimatedCount: 0 });
    expect((await loadHomeStatus(db, otherId, DEMO_MONTH, quiet)).found).toEqual({ confirmed: 199_998, confirmedCount: 2, estimated: 0, estimatedCount: 0 });

    // 通知の無い月（9 月）は 0（突合は読まない）
    let calls = 0;
    const counting = { ...quiet, loadReport: async (...args: Parameters<typeof loadReport>) => (calls++, loadReport(...args)) };
    const sep = await loadHomeStatus(db, tenantId, DEMO_PREV_MONTH, counting);
    expect(sep.found).toEqual({ confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0 });
    expect(sep.reconcile).toMatchObject({ notices: 0, items: 0, error: null });
    expect(calls).toBe(0);
    await client.close();
  });

  it("支払通知の行を読み取れていないときは「差が無い」と言わない。突合を読めないときは理由を出し、ホームは開ける", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const notice = await noticeOf(db, tenantId);
    // 列が読めずに行が 0 件の支払通知（比べられない）
    await db.delete(s.paymentNoticeLines).where(and(eq(s.paymentNoticeLines.noticeId, notice.id), eq(s.paymentNoticeLines.tenantId, tenantId)));
    let st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.reconcile).toMatchObject({ notices: 1, unread: 1, items: 0, error: null });
    expect(st.found).toEqual({ confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0 });

    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, {
      ...quiet,
      loadReport: async () => {
        throw new Error("boom");
      },
    });
    expect(st.reconcile).toMatchObject({ notices: 1, error: "突合の結果を読めませんでした。元請との突合の画面で確かめてください。" });
    expect(st.found).toEqual({ confirmed: 0, confirmedCount: 0, estimated: 0, estimatedCount: 0 });
    // ほかの数（利益など）は出る
    expect(st.profit.profit).toBe(980_270);
    await client.close();
  });

  it("純関数 homeReconcileFromCells：その月の通知のあるセルだけ。差の多い（通知が多い）ものは見つけたお金に入れない", () => {
    const cell = (month: string, withNotice: boolean, over: number, lineCount = 3) =>
      ({
        month,
        notice: withNotice ? { lineCount } : null,
        items: [{}, {}],
        short: 5_000,
        shortCount: 1,
        over,
        overCount: over ? 1 : 0,
        open: 1,
        asked: 1,
        recovered: 2_000,
        recoveredCount: 1,
      }) as unknown as Parameters<typeof homeReconcileFromCells>[0][number];
    const r = homeReconcileFromCells([cell(DEMO_MONTH, true, 7_000), cell(DEMO_MONTH, true, 0, 0), cell(DEMO_MONTH, false, 0), cell(DEMO_PREV_MONTH, true, 9_999)], DEMO_MONTH);
    expect(r.reconcile).toEqual({ notices: 2, items: 4, openItems: 4, openDiff: -3_000, short: 10_000, over: 7_000, unread: 1, error: null });
    expect(r.found).toEqual({ confirmed: 4_000, confirmedCount: 2, estimated: 10_000, estimatedCount: 2 });
  });
});

describe("ホーム：会社がかぶる消費税・取引条件・本番の月", () => {
  it("10 月は今月 20,490円・2028年10月から月 34,150円（+13,660円）。9 月は 16,295円 → 10 月から 24,442円（+8,147円）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const oct = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(oct.burden).toEqual({
      affected: true,
      people: 3,
      current: 20_490,
      next: { from: "2028-10-01", label: "2028年10月〜2030年9月", monthly: 34_150, diffMonthly: 13_660 },
    });
    const sep = await loadHomeStatus(db, tenantId, DEMO_PREV_MONTH, quiet);
    expect(sep.burden).toMatchObject({ affected: true, people: 3, current: 16_295, next: { from: "2026-10-01", monthly: 24_442, diffMonthly: 8_147 } });

    // 簡易課税の会社は計算しない
    await db.update(s.tenants).set({ taxMethod: "simplified" }).where(eq(s.tenants.id, tenantId));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).burden).toMatchObject({ affected: false, current: 0 });
    await client.close();
  });

  it("取引条件：10 月に稼働した 8人のうち、記録が無いのは遠藤さん。明示書か明示した日があれば外れる。ほかの会社の記録は効かない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const endo = await driverId(db, tenantId, "D04");
    const otherEndo = await driverId(db, otherId, "D04");

    let st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.terms).toEqual({ worked: 8, missing: [{ driverId: endo, name: "遠藤 大輔" }] });

    // ほかの会社の遠藤さんに明示書を作っても、この会社は変わらない
    await db.insert(s.termsRecords).values({ tenantId: otherId, driverId: otherEndo, version: 1, issuedOn: "2026-05-01", content: {} });
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).terms.missing).toHaveLength(1);
    expect((await loadHomeStatus(db, otherId, DEMO_MONTH, quiet)).terms.missing).toHaveLength(0);

    // この会社の遠藤さんの明示書を作ると外れる
    await db.insert(s.termsRecords).values({ tenantId, driverId: endo, version: 1, issuedOn: "2026-05-01", content: {} });
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.terms).toEqual({ worked: 8, missing: [] });

    // 明示した日（紙で渡した日）だけでも記録があるとみる。どちらも無い人は出る
    const kimura = await driverId(db, tenantId, "D07");
    await db.update(s.drivers).set({ termsIssuedOn: null }).where(and(eq(s.drivers.id, kimura), eq(s.drivers.tenantId, tenantId)));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).terms.missing.map((x) => x.name)).toEqual(["木村 誠"]);

    // 稼働の無い月は数えない（5 月）
    expect((await loadHomeStatus(db, tenantId, "2026-05-01", quiet)).terms).toEqual({ worked: 0, missing: [] });
    await client.close();
  });

  it("本番に切り替えた月：tenants.onboarding.golive の月だけ（形が違えば出さない）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).golive).toBeNull();
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    await db.update(s.tenants).set({ onboarding: { ...t.onboarding, golive: "2026-10-01" } }).where(eq(s.tenants.id, tenantId));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).golive).toBe("2026-10-01");
    await db.update(s.tenants).set({ onboarding: { ...t.onboarding, golive: "来月" } }).where(eq(s.tenants.id, tenantId));
    expect((await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet)).golive).toBeNull();
    await client.close();
  });
});
