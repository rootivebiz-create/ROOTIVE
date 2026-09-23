import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts, profitOf } from "~/server/calc/statement";
import {
  changeOf,
  futureBurden,
  loadCeoSheet,
  loadMonthDrafts,
  loadProfitPage,
  monthProfit,
  parseSort,
  profitTrend,
  sortRows,
  topAndBottom,
} from "~/server/features/profit";
import type { WatchIssue } from "~/server/features/watch-types";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

let db: Db;
let client: PGlite;
let tenantId: string;
let otherId: string;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  ({ tenantId: otherId } = await seedDemo(db));
});
afterAll(async () => client.close());

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("1 か月の利益（デモの 10 月・まだ締めていない月）", () => {
  it("合計は明細の profitOf の合計と同じで、手で数えた額とも同じ", async () => {
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const mp = await monthProfit(db, tenantId, DEMO_MONTH);
    expect(mp.source).toBe("calc");
    expect(mp.closed).toBe(false);
    expect(mp.totals.profit).toBe(sum(drafts.map(profitOf)));
    // 売上：宅配 4,950個×190 ＋ 企業配 61日×22,000 ＋ スポット 6件×9,000 ＋ ルート 168時間×2,600 ＋ 夜間 20便×12,000
    expect(mp.totals.sales).toBe(3_013_300);
    expect(mp.totals.pay).toBe(2_410_600);
    expect(mp.totals.gross).toBe(602_700);
    // 控除：ロイヤリティ 241,060 ＋ 管理費 15,000×8 ＋ 車両リース 32,000 ＋ 制服代 5,000
    expect(mp.totals.deductions).toBe(398_060);
    // 経過措置（控除 70%）：上田 27,600・遠藤 35,000・木村 5,700 の 30%
    expect(mp.totals.burden).toBe(20_490);
    expect(mp.totals.profit).toBe(980_270);
    expect(mp.totals.rate).toBeCloseTo(980_270 / 3_013_300, 10);
    expect(mp.totals.drivers).toBe(8);
    expect(mp.totals.unregistered).toBe(3);
    expect(mp.totals.transfer).toBe(sum(drafts.map((d) => d.total)));
  });

  it("案件・元請の粗利の合計 ＋ 控除 − 負担 ＝ 会社の利益（割り振らない）", async () => {
    const mp = await monthProfit(db, tenantId, DEMO_MONTH);
    const byName = Object.fromEntries(mp.projects.map((p) => [p.name, p]));
    expect(byName["宅配（個建て）"]).toMatchObject({ qty: 4950, sales: 940_500, pay: 744_600, profit: 195_900, drivers: 4, client: "A物流（架空）" });
    expect(byName["企業配（日当）"]).toMatchObject({ qty: 61, sales: 1_342_000, pay: 1_098_000, profit: 244_000, drivers: 3 });
    expect(byName["スポット便"]).toMatchObject({ sales: 54_000, pay: 42_000, profit: 12_000, drivers: 2 });
    expect(byName["ルート配送（時給）"]).toMatchObject({ sales: 436_800, pay: 336_000, profit: 100_800 });
    expect(byName["夜間便"]).toMatchObject({ sales: 240_000, pay: 190_000, profit: 50_000 });

    const projectGross = sum(mp.projects.map((p) => p.profit));
    expect(projectGross).toBe(mp.totals.gross);
    expect(projectGross + mp.totals.deductions - mp.totals.burden).toBe(mp.totals.profit);

    const clients = Object.fromEntries(mp.clients.map((c) => [c.name, c]));
    expect(clients["A物流（架空）"]).toMatchObject({ sales: 2_522_500, profit: 489_900 });
    expect(clients["A物流（架空）"].projects.sort()).toEqual(["企業配（日当）", "夜間便", "宅配（個建て）"].sort());
    expect(clients["B商事（架空）"]).toMatchObject({ sales: 490_800, profit: 112_800 });
    expect(sum(mp.clients.map((c) => c.profit))).toBe(projectGross);
    expect(sum(mp.clients.map((c) => c.sales))).toBe(mp.totals.sales);

    // ドライバーごとの利益の合計も会社の利益と同じ
    expect(sum(mp.drivers.map((d) => d.profit))).toBe(mp.totals.profit);
    const aoki = mp.drivers.find((d) => d.code === "D01")!;
    expect(aoki).toMatchObject({ sales: 2310 * 190 + 4 * 9000, pay: 374_500, deductions: 52_450, burden: 0, transfer: 357_555 });
    expect(aoki.profit).toBe(2310 * 190 + 4 * 9000 - 374_500 + 52_450);
    const kimura = mp.drivers.find((d) => d.code === "D07")!;
    expect(kimura).toMatchObject({ registered: false, burden: 1_710 });
  });

  it("並べ替え：利益の多い順・少ない順・名前の順。上位と下位は重ならない", async () => {
    const mp = await monthProfit(db, tenantId, DEMO_MONTH);
    expect(sortRows(mp.projects, "profit_desc").map((p) => p.profit)).toEqual([244_000, 195_900, 100_800, 50_000, 12_000]);
    expect(sortRows(mp.projects, "profit_asc")[0].name).toBe("スポット便");
    expect(parseSort("zzz")).toBe("profit_desc");
    expect(parseSort("name")).toBe("name");
    const { top, bottom } = topAndBottom(mp.projects, 3);
    expect(top.map((p) => p.name)).toEqual(["企業配（日当）", "宅配（個建て）", "ルート配送（時給）"]);
    expect(bottom.map((p) => p.name)).toEqual(["スポット便", "夜間便"]);
  });
});

describe("経過措置の先の目安", () => {
  it("同じ稼働が続くと、段階が進むほど控除できる割合が減り、負担が増える", async () => {
    const mp = await monthProfit(db, tenantId, DEMO_MONTH);
    const f = futureBurden(mp.drafts, DEMO_MONTH, "general");
    expect(f.affected).toBe(true);
    expect(f.people).toBe(3);
    expect(f.base).toBe(303_600 + 385_000 + 62_700);
    expect(f.creditable).toBe(27_600 + 35_000 + 5_700);
    expect(f.current).toMatchObject({ from: "2026-10-01", deductibleRate: 0.7, monthly: 20_490, yearly: 245_880 });
    expect(f.current!.monthly).toBe(mp.totals.burden);
    expect(f.steps.map((x) => x.deductibleRate)).toEqual([0.7, 0.5, 0.3, 0]);
    expect(f.steps.map((x) => x.monthly)).toEqual([20_490, 34_150, 47_810, 68_300]);
    for (let i = 1; i < f.steps.length; i++) {
      expect(f.steps[i].deductibleRate).toBeLessThan(f.steps[i - 1].deductibleRate);
      expect(f.steps[i].monthly).toBeGreaterThan(f.steps[i - 1].monthly);
    }
    expect(f.next).toMatchObject({ from: "2028-10-01", monthly: 34_150, diffMonthly: 13_660 });
    // 9 月（控除 80% の最後の月）は今の段階が 80%
    const sep = await monthProfit(db, tenantId, DEMO_PREV_MONTH);
    const fs = futureBurden(sep.drafts, DEMO_PREV_MONTH, "general");
    expect(fs.current!.deductibleRate).toBe(0.8);
    expect(fs.current!.monthly).toBe(sep.totals.burden);
    expect(fs.next!.deductibleRate).toBe(0.7);
    expect(fs.next!.monthly).toBeGreaterThan(fs.current!.monthly);
  });

  it("原則課税でない会社は負担を出さない", async () => {
    const mp = await monthProfit(db, tenantId, DEMO_MONTH);
    const f = futureBurden(mp.drafts, DEMO_MONTH, "simplified");
    expect(f.affected).toBe(false);
    expect(f.steps.every((x) => x.monthly === 0)).toBe(true);
  });
});

describe("締めた月は明細の写しを使う", () => {
  it("写しがあれば写しの数字。締めたあとで単価を変えても変わらない", async () => {
    const { db: db2, client: c2 } = await createTestDb();
    const { tenantId: t } = await seedDemo(db2);
    await generateStatements(db2, t, DEMO_MONTH);
    await db2.insert(s.monthCloses).values({ tenantId: t, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    // 締めたあとで受注の単価を上げる（締めた月の利益は変わらないはず）
    await db2
      .update(s.projects)
      .set({ billRate: 200 })
      .where(and(eq(s.projects.tenantId, t), eq(s.projects.name, "宅配（個建て）")));
    const mp = await monthProfit(db2, t, DEMO_MONTH);
    expect(mp.closed).toBe(true);
    expect(mp.source).toBe("snapshot");
    expect(mp.totals.sales).toBe(3_013_300);
    expect(mp.totals.profit).toBe(980_270);
    // 今の設定で計算し直すと違う額になる（写しを使っている証拠）
    const live = buildStatementDrafts(await loadBuildInput(db2, t, DEMO_MONTH));
    expect(sum(live.map((d) => d.sales))).toBe(3_013_300 + 4950 * 10);
    await c2.close();
  });

  it("明細を作らずに締めた月（デモの 9 月）は、今の稼働から計算してそう知らせる", async () => {
    const md = await loadMonthDrafts(db, tenantId, DEMO_PREV_MONTH);
    expect(md).toMatchObject({ closed: true, source: "calc", snapshotMissing: true });
    expect(md.drafts).toHaveLength(8);
  });

  it("月の形が違えば止める", async () => {
    await expect(monthProfit(db, tenantId, "2026-10")).rejects.toThrow("月の指定");
  });
});

describe("推移と前月比", () => {
  it("直近 6 か月（古い順）。稼働の無い月は 0、前月比は 9 月と比べる", async () => {
    const trend = await profitTrend(db, tenantId, DEMO_MONTH, 6);
    expect(trend.map((p) => p.month)).toEqual(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(trend.slice(0, 4).every((p) => p.drivers === 0 && p.profit === 0 && p.rate === null)).toBe(true);
    const sepDrafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_PREV_MONTH));
    expect(trend[4]).toMatchObject({ profit: sum(sepDrafts.map(profitOf)), closed: true, source: "calc" });
    expect(trend[5]).toMatchObject({ profit: 980_270, closed: false });

    const page = await loadProfitPage(db, tenantId, DEMO_MONTH);
    expect(page.prev!.month).toBe(DEMO_PREV_MONTH);
    expect(page.changes.profit!.diff).toBe(980_270 - trend[4].profit);
    expect(page.changes.sales!.diff).toBe(3_013_300 - trend[4].sales);
    expect(page.future.current!.monthly).toBe(20_490);
    expect(changeOf(100, 0)).toEqual({ diff: 100, ratio: null });
    expect(changeOf(100, null)).toBeNull();
    // 前の月に明細が無ければ比べない
    const may = await loadProfitPage(db, tenantId, "2026-05-01");
    expect(may.changes.profit).toBeNull();
    expect(may.current.drafts).toHaveLength(0);
  });
});

describe("社長の 1 枚の中身", () => {
  it("突合の差（片付いていないものだけ）・見張り番・確認・振込をまとめる", async () => {
    const [notice] = await db
      .select()
      .from(s.paymentNotices)
      .where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.month, DEMO_MONTH)));
    await db.insert(s.reconciliationItems).values([
      { tenantId, noticeId: notice.id, label: "宅配", kind: "qty", ourAmount: 940_500, theirAmount: 858_800, diff: -81_700, status: "open" },
      { tenantId, noticeId: notice.id, label: "夜間便", kind: "price", ourAmount: 240_000, theirAmount: 230_000, diff: -10_000, status: "asked" },
      { tenantId, noticeId: notice.id, label: "待機料", kind: "extra", ourAmount: 0, theirAmount: 3_000, diff: 3_000, status: "open" },
      { tenantId, noticeId: notice.id, label: "企業配", kind: "qty", ourAmount: 0, theirAmount: 0, diff: -22_000, status: "resolved" },
    ]);
    // ほかの会社の差は数えない
    const [otherNotice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, otherId));
    await db.insert(s.reconciliationItems).values({ tenantId: otherId, noticeId: otherNotice.id, label: "宅配", kind: "qty", ourAmount: 1, theirAmount: 0, diff: -999_999, status: "open" });

    const issues: WatchIssue[] = [
      { code: "terms_missing", severity: "red", title: "取引条件を明示した記録が見つかりません", detail: "", subjectId: "x", subjectLabel: "遠藤 大輔", acked: false, blocksClose: true },
      { code: "deduction_unagreed", severity: "yellow", title: "合意の記録が無い控除があります", detail: "", subjectId: "y", subjectLabel: "木村 誠", acked: false, blocksClose: false },
      { code: "bank_missing", severity: "red", title: "口座の記録がありません", detail: "", subjectId: "z", subjectLabel: "木村 誠", acked: true, blocksClose: false },
      { code: "info", severity: "info", title: "お知らせ", detail: "", subjectId: "t", subjectLabel: "", acked: false, blocksClose: false },
    ];
    const sheet = await loadCeoSheet(db, tenantId, DEMO_MONTH, { runWatch: async (_db, t, m) => (t === tenantId && m === DEMO_MONTH ? issues : []) });
    expect(sheet.totals.profit).toBe(980_270);
    expect(sheet.reconcile).toEqual({ notices: 1, count: 3, net: -81_700 - 10_000 + 3_000, short: 91_700, shortCount: 2, over: 3_000, overCount: 1 });
    expect(sheet.watch).toMatchObject({ red: 1, yellow: 1, acked: 1, error: null });
    expect(sheet.watch.titles.map((x) => x.severity)).toEqual(["red", "yellow"]);
    expect(sheet.confirm).toEqual({ statements: 0, confirmed: 0, deemed: 0 });
    expect(sheet.transfer.payDate).toBe("2026-11-25");
    expect(sheet.transfer.people).toBe(8);
    expect(sheet.burden.current!.monthly).toBe(20_490);
    expect(sheet.burden.next!.monthly).toBe(34_150);
    expect(sheet.topProjects[0].name).toBe("企業配（日当）");

    // 明細を作って 1 人が確認すると、確認の数に出る
    await generateStatements(db, tenantId, DEMO_MONTH);
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH))).limit(1);
    await db.insert(s.statementConfirmations).values({ tenantId, statementId: st.id, totalAtConfirm: st.total, version: st.version, hash: st.hash });
    const after = await loadCeoSheet(db, tenantId, DEMO_MONTH, { runWatch: async () => { throw new Error("boom"); } });
    expect(after.confirm).toMatchObject({ statements: 8, confirmed: 1 });
    expect(after.watch.error).toContain("見張り番を読めませんでした");
  });
});

describe("会社の区切り", () => {
  it("ほかの会社の稼働を変えても、この会社の利益は変わらない。ほかの会社の数字も読めない", async () => {
    const before = await monthProfit(db, tenantId, DEMO_MONTH);
    const [otherDriver] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, otherId), eq(s.drivers.code, "D01")));
    const [otherProject] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, otherId), eq(s.projects.name, "夜間便")));
    await db.insert(s.workEntries).values({ tenantId: otherId, month: DEMO_MONTH, driverId: otherDriver.id, projectId: otherProject.id, qty: 100 });
    const after = await monthProfit(db, tenantId, DEMO_MONTH);
    expect(after.totals).toEqual(before.totals);
    const other = await monthProfit(db, otherId, DEMO_MONTH);
    expect(other.totals.sales).toBe(3_013_300 + 100 * 12_000);
    // この会社の差だけ（ほかの会社の −999,999 は入らない）
    const sheet = await loadCeoSheet(db, otherId, DEMO_MONTH, { runWatch: async () => [] });
    expect(sheet.reconcile.count).toBe(1);
    expect(sheet.companyName).toBe("サンプル運送株式会社（架空）");
  });
});
