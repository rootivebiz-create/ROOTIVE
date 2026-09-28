import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import { buildTermsContent } from "~/server/features/terms-content";
import { runWatch, watchMonth, type WatchIssueEx } from "~/server/features/watch";
import { ackKey } from "~/server/features/watch";
import { ackWatchIssue, previousAcks } from "~/server/features/watch/acks";
import { SOURCES } from "~/server/features/watch/sources";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 見張り番の続き（影響額・時点・あとから足したルール）を、架空の会社（seedDemo）の記録で確かめる。
 * 影響額は明細の計算（buildStatementDrafts）と同じ円になること、他社の記録を読まないことを見る。
 */

const TODAY = "2026-10-31";
const NOV = "2026-11-01";
const FORBIDDEN = /(?<!取)適法|違反です|違反はありません|問題ありません|対応済み|完全対応|防げます|大丈夫|必ず合う|ミスゼロ|完全自動|補助金|単価を下げ|引き下げ|偽装請負|労働者に当た/;
const NEW_CODES = ["terms_outdated", "ded_new_or_up", "ded_penalty", "exempt_only_cut", "ded_without_work", "transitional_span", "transitional_next", "duplicate_rows", "open_questions", "late_payment_prev", "payout_swing"];

async function idsOf(db: Db, tenantId: string) {
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
  return {
    D: Object.fromEntries(drivers.map((d) => [d.code!, d.id])) as Record<string, string>,
    P: Object.fromEntries(projects.map((p) => [p.name, p.id])) as Record<string, string>,
  };
}

const find = (issues: WatchIssueEx[], code: string, subjectId?: string) => issues.filter((i) => i.code === code && (subjectId === undefined || i.subjectId === subjectId));

function expectWellFormed(issues: WatchIssueEx[]) {
  const rank = { red: 0, yellow: 1, info: 2 } as const;
  for (let i = 1; i < issues.length; i++) {
    const a = issues[i - 1];
    const b = issues[i];
    expect(rank[a.severity]).toBeLessThanOrEqual(rank[b.severity]);
    // 同じ重さの中は影響額の大きい順（出せないものは後ろ）
    if (a.severity === b.severity && b.impact?.yen != null) expect(a.impact?.yen ?? null, `${a.code} → ${b.code}`).not.toBeNull();
    if (a.severity === b.severity && a.impact?.yen != null && b.impact?.yen != null) expect(a.impact.yen).toBeGreaterThanOrEqual(b.impact.yen);
  }
  for (const i of issues) {
    expect(i.impact, i.code).toBeDefined();
    expect(typeof i.impact!.label).toBe("string");
    expect(i.asOf, i.code).toBe("2026年9月");
    expect(`${i.title}${i.detail}${i.basis ?? ""}${i.subjectLabel}${i.impact!.label}`).not.toMatch(FORBIDDEN);
    if (i.sourceUrl) expect(Object.values(SOURCES) as string[]).toContain(i.sourceUrl);
  }
}

describe("見張り番の続き：架空の会社の 2026年10月（影響額と時点）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let D: Record<string, string>;
  let issues: WatchIssueEx[];

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ D } = await idsOf(db, tenantId));
    issues = (await watchMonth(db, tenantId, DEMO_MONTH, { today: TODAY })).issues;
  });
  afterAll(async () => client.close());

  it("どの指摘にも影響額（円か「—」）と時点が付き、同じ重さの中は影響額の大きい順", () => {
    expectWellFormed(issues);
    // 赤の 1 番目は、遠藤さんの取引条件（今月の支払額 294,800 円）。次が木村さんの制服代（5,000 円）
    const red = issues.filter((i) => i.severity === "red");
    expect(red.map((i) => i.code)).toEqual(["terms_missing", "deduction_no_agreement"]);
    expect(red[0].impact).toEqual({ yen: 294800, label: "遠藤 大輔さんの2026年10月分の支払額" });
    expect(red[1].impact).toEqual({ yen: 5000, label: "控除の合計（税抜・1人）" });
  });

  it("影響額は明細の計算と同じ円（口座なし 34,430・控除できない消費税 20,490・単価 155 円の支払 65,100）", async () => {
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const d07 = drafts.find((d) => d.driverId === D.D07)!;
    expect(find(issues, "no_bank", D.D07)[0].impact).toEqual({ yen: d07.total, label: "振込額" });
    expect(d07.total).toBe(34430);
    expect(find(issues, "invoice_burden")[0].impact?.yen).toBe(20490);
    expect(find(issues, "rate_changed_without_record")[0].impact?.yen).toBe(65100);
    // ロイヤリティ（8 人・241,060 円）
    const royalty = issues.find((i) => i.code === "deduction_no_agreement" && i.subjectLabel.startsWith("ロイヤリティ"))!;
    expect(royalty.impact).toEqual({ yen: 241060, label: "控除の合計（税抜・8人）" });
    // 支払期日の文言が空（お知らせ）・取適法の目安は金額で出さない
    expect(find(issues, "payment_wording")[0].impact?.yen).toBeNull();
    expect(find(issues, "toriteki")[0].impact?.yen).toBeNull();
  });

  it("架空の会社の 10 月には、あとから足したルールの指摘は出ない（記録が無いのに騒がない）", () => {
    for (const code of NEW_CODES) expect(find(issues, code), code).toHaveLength(0);
  });

  it("締めた 9 月：翌月から控除できる割合が 80% → 70% になるので、9 月と同じ支払額での月の負担増をお知らせ", async () => {
    const sep = (await watchMonth(db, tenantId, DEMO_PREV_MONTH, { today: "2026-10-01" })).issues;
    expectWellFormed(sep);
    const [next] = find(sep, "transitional_next");
    expect(next.severity).toBe("info");
    expect(next.detail).toContain("80% から 70%");
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_PREV_MONTH));
    const exempt = drafts.filter((d) => !d.driver.invoiceRegistered);
    const now = exempt.reduce((a, d) => a + d.invoiceBurden, 0);
    const burdenNow = find(sep, "invoice_burden")[0].impact?.yen;
    expect(burdenNow).toBe(now);
    // 9 月の支払額のまま 70% になったら（控除できない分は 20% → 30%）
    const { nonDeductibleTax } = await import("@/lib/payroll/tax");
    const later = exempt.reduce((a, d) => a + nonDeductibleTax(d.subtotal + d.tax, "2026-10-01"), 0);
    expect(next.impact?.yen).toBe(later - now);
    expect(later - now).toBeGreaterThan(0);
    expect(next.detail).toContain(`月 ${now.toLocaleString("ja-JP")}円 から`);
  });
});

describe("見張り番の続き：記録を足したときに出る指摘", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;
  let D: Record<string, string>;
  let P: Record<string, string>;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
    ({ D, P } = await idsOf(db, tenantId));
  });
  afterAll(async () => client.close());

  const run = (month = DEMO_MONTH, today = TODAY) => watchMonth(db, tenantId, month, { today }).then((r) => r.issues);

  it("取引条件の記録（terms_records）が最初の稼働より前にあれば、drivers の日付が空の遠藤さんも赤にならない", async () => {
    expect(find(await run(), "terms_missing", D.D04)[0].severity).toBe("red");
    const content = await buildTermsContent(db, tenantId, D.D04, { month: DEMO_MONTH });
    await db.insert(s.termsRecords).values({ tenantId, driverId: D.D04, version: 1, issuedOn: "2026-04-20", content });
    const after = await run();
    expect(find(after, "terms_missing", D.D04)).toHaveLength(0);
    // 記録の中身は今の台帳と同じなので「古い」とも言わない
    expect(find(after, "terms_outdated", D.D04)).toHaveLength(0);
    // 他社の遠藤さんは、記録が無いので赤のまま
    const other = await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY });
    expect(find(other, "terms_missing").map((i) => i.severity)).toEqual(["red"]);
  });

  it("岡田さん（D05）の明示のあとで宅配を 155 → 160 円に変える → 取引条件の記録が古い（黄・420個 × 5円 = 2,100円）", async () => {
    const content = await buildTermsContent(db, tenantId, D.D05, { month: DEMO_MONTH });
    await db.insert(s.termsRecords).values({ tenantId, driverId: D.D05, version: 1, issuedOn: "2026-04-01", content });
    expect(find(await run(), "terms_outdated", D.D05)).toHaveLength(0);
    await db.update(s.rateOverrides).set({ payRate: 160 }).where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, D.D05)));
    const [i] = find(await run(), "terms_outdated", D.D05);
    expect(i).toMatchObject({ severity: "yellow", subjectLabel: "岡田 拓也", fixHref: `/terms/${D.D05}`, basis: "フリーランス法 第3条（取引条件の明示）" });
    expect(i.detail).toContain("「宅配（個建て）」の単価 155円/個 → 160円/個");
    expect(i.impact?.yen).toBe(2100);
    // 締めた月の画面では比べない（見るだけ。今の台帳と締めた月の中身は違ってよい）
    const sep = (await watchMonth(db, tenantId, DEMO_PREV_MONTH, { today: TODAY })).issues;
    expect(find(sep, "terms_outdated")).toHaveLength(0);
    await db.update(s.rateOverrides).set({ payRate: 155 }).where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, D.D05)));
    // 他社には出ない
    expect(find(await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY }), "terms_outdated")).toHaveLength(0);
  });

  it("井上さん（D02）の企業配を同じ日に 2 行取り込む → 赤（重なった 1 日分 18,000円）。消すと出ない", async () => {
    await db.insert(s.workEntries).values([
      { tenantId, month: DEMO_MONTH, driverId: D.D02, projectId: P["企業配（日当）"], qty: 1, workDate: "2026-10-05" },
      { tenantId, month: DEMO_MONTH, driverId: D.D02, projectId: P["企業配（日当）"], qty: 1, workDate: "2026-10-05" },
    ]);
    const issues = await run();
    const [i] = find(issues, "duplicate_rows", D.D02);
    expect(i).toMatchObject({ severity: "red", blocksClose: true, subjectLabel: "井上 美咲", fixHref: "/work?m=2026-10" });
    expect(i.detail).toContain("2026年10月5日 企業配（日当） 2行（1日・1日）");
    expect(i.impact).toEqual({ yen: 18000, label: "重なっている分の支払" });
    expectWellFormed(issues);
    // 他社の見張り番には出ない
    expect(find(await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY }), "duplicate_rows")).toHaveLength(0);
    await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.workDate, "2026-10-05")));
    expect(find(await run(), "duplicate_rows")).toHaveLength(0);
  });

  it("青木さん（D01）の宅配：1 つのファイルで同じ日に 30個・20個 → 黄（二重なら 20個 × 150円 = 3,000円）。別のファイルからも同じ日の行が来ると赤", async () => {
    const [b1, b2] = await db
      .insert(s.importBatches)
      .values([
        { tenantId, month: DEMO_MONTH, fileName: "A物流_10月_1便2便.xlsx", status: "applied" },
        { tenantId, month: DEMO_MONTH, fileName: "A物流_10月_追加.xlsx", status: "applied" },
      ])
      .returning();
    const takuhai = P["宅配（個建て）"];
    await db.insert(s.workEntries).values([
      { tenantId, month: DEMO_MONTH, driverId: D.D01, projectId: takuhai, qty: 30, workDate: "2026-10-07", importBatchId: b1.id },
      { tenantId, month: DEMO_MONTH, driverId: D.D01, projectId: takuhai, qty: 20, workDate: "2026-10-07", importBatchId: b1.id },
    ]);
    const [split] = find(await run(), "duplicate_rows", D.D01);
    expect(split).toMatchObject({ severity: "yellow", blocksClose: false, subjectLabel: "青木 翔太" });
    expect(split.detail).toContain("2026年10月7日 宅配（個建て） 2行（30個・20個）");
    expect(split.impact).toEqual({ yen: 3000, label: "二重に書いた行なら払いすぎになる額" });
    // 別のファイルから同じ日の行 → 赤（締めを止める）。重なり 20個 ＋ 30個 = 50個 × 150円
    await db.insert(s.workEntries).values({ tenantId, month: DEMO_MONTH, driverId: D.D01, projectId: takuhai, qty: 30, workDate: "2026-10-07", importBatchId: b2.id });
    const [double] = find(await run(), "duplicate_rows", D.D01);
    expect(double).toMatchObject({ severity: "red", blocksClose: true });
    expect(double.impact).toEqual({ yen: 7500, label: "重なっている分の支払" });
    // 他社には出ない
    expect(find(await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY }), "duplicate_rows")).toHaveLength(0);
    await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.workDate, "2026-10-07")));
    await db.delete(s.importBatches).where(and(eq(s.importBatches.tenantId, tenantId), eq(s.importBatches.month, DEMO_MONTH)));
    expect(find(await run(), "duplicate_rows")).toHaveLength(0);
  });

  it("上田さん（D03）の宅配の行への質問が未解決 → 黄（行の金額 276,000円）。解決にすると出ない。締めたあとも確認済みにできる", async () => {
    await generateStatements(db, tenantId, DEMO_MONTH);
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, D.D03)));
    const takuhai = P["宅配（個建て）"];
    await db.insert(s.statementMessages).values([
      { tenantId, statementId: st.id, author: "driver", lineKey: takuhai, body: "宅配の個数が少ない気がします", createdAt: new Date("2026-10-28T10:00:00+09:00") },
      // 事務の返事は数えない
      { tenantId, statementId: st.id, author: "staff", lineKey: takuhai, body: "確認します", createdAt: new Date("2026-10-28T12:00:00+09:00") },
    ]);
    const [i] = find(await run(), "open_questions", D.D03);
    expect(i).toMatchObject({ severity: "yellow", subjectLabel: "上田 健", fixHref: `/statements/${st.id}` });
    expect(i.detail).toContain("質問が 1件");
    expect(i.detail).toContain("2026年10月28日（3日前）");
    // 1,840個 × 150円
    expect(i.impact).toEqual({ yen: 276000, label: "質問の行の金額" });
    // 他社には出ない
    expect(find(await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY }), "open_questions")).toHaveLength(0);

    await db.update(s.statementMessages).set({ resolvedAt: new Date() }).where(eq(s.statementMessages.statementId, st.id));
    expect(find(await run(), "open_questions")).toHaveLength(0);
  });

  it("10 月分の振込が支払期日（11/25）より後 → 11 月の見張り番で「前の月の振込の遅れ」（赤・357,555円）", async () => {
    const [aoki] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, D.D01)));
    const [batch] = await db
      .insert(s.transferBatches)
      .values({ tenantId, month: DEMO_MONTH, transferDate: "2026-11-27", executedOn: "2026-11-27", statementIds: [aoki.id], count: 1, total: aoki.total, fileName: "振込_2026年10月分.txt" })
      .returning();
    const nov = await run(NOV, "2026-11-30");
    const [i] = find(nov, "late_payment_prev", `prev:${batch.id}`);
    expect(i).toMatchObject({ severity: "red", blocksClose: true, fixHref: "/transfer?m=2026-10", sourceUrl: SOURCES.flQa });
    expect(i.detail).toContain("2026年10月分の振込は、振り込んだ日の記録が2026年11月27日で、明細の支払期日（2026年11月25日）より 2日後です");
    expect(i.impact).toEqual({ yen: 357555, label: "遅れて払った額の合計（前の月）" });
    // 他社の振込データ・明細は見ない（他社の 11 月には出ない）
    expect(find(await runWatch(db, otherTenantId, NOV, { today: "2026-11-30" }), "late_payment_prev")).toHaveLength(0);
    // 10 月の見張り番で「支払期日より後に振り込んだ」を確認済みにしていれば、そのメモが 11 月の下書きになる（同じ振込の話）
    const note = "振込の予約を忘れていた。本人に電話でおわびした";
    await ackWatchIssue(db, tenantId, { month: DEMO_MONTH, code: "paid_late", subjectId: batch.id, note }, null, { today: "2026-11-30" });
    const drafts = await previousAcks(db, tenantId, NOV);
    expect(drafts.get(ackKey("late_payment_prev", `prev:${batch.id}`))).toEqual({ month: DEMO_MONTH, note, fromCode: "paid_late" });
    // 下書きにするだけで、11 月の赤は確認済みにならない（締めを止めたまま）
    expect(find(await run(NOV, "2026-11-30"), "late_payment_prev")[0]).toMatchObject({ acked: false, blocksClose: true });
    expect((await previousAcks(db, otherTenantId, NOV)).size).toBe(0);
    await db.delete(s.watchAcks).where(and(eq(s.watchAcks.tenantId, tenantId), eq(s.watchAcks.code, "paid_late")));
    await db.delete(s.transferBatches).where(eq(s.transferBatches.id, batch.id));
  });

  it("11 月：遠藤さん（D04）は稼働なしで車両リースだけ → 黄（32,000 ＋ 消費税 3,200 = 35,200円）", async () => {
    // 会社としては 11 月も動いている（青木さんの稼働あり）
    await db.insert(s.workEntries).values({ tenantId, month: NOV, driverId: D.D01, projectId: P["宅配（個建て）"], qty: 100 });
    const nov = await run(NOV, "2026-11-30");
    const [i] = find(nov, "ded_without_work", D.D04);
    expect(i).toMatchObject({ severity: "yellow", subjectLabel: "遠藤 大輔", fixHref: `/settings/rules?m=2026-11&driver=${D.D04}` });
    expect(i.detail).toContain("「車両リース」32,000円");
    expect(i.impact).toEqual({ yen: 35200, label: "差し引く額（消費税を含む）" });
    // 振込額がマイナスになるので、そちらは赤で出る
    expect(find(nov, "negative_total", D.D04)[0].impact?.yen).toBe(35200);
    // 前の月（10 月）も同じリースなので「増えた」とは言わない
    expect(find(nov, "ded_new_or_up")).toHaveLength(0);
    expectWellFormed(nov);
  });

  it("11 月：上田さん（登録なし）だけ宅配が 150 → 140 円、青木さんは 150 円のまま → 赤（10円 × 1,800個 = 18,000円）", async () => {
    // 10 月の明細は保存済み（上の質問のテストで作った）。比べるもとは保存した写し
    await db.insert(s.rateOverrides).values({ tenantId, driverId: D.D03, projectId: P["宅配（個建て）"], payRate: 140, agreedOn: "2026-10-25" });
    await db.insert(s.workEntries).values({ tenantId, month: NOV, driverId: D.D03, projectId: P["宅配（個建て）"], qty: 1800 });
    const nov = await run(NOV, "2026-11-30");
    const [i] = find(nov, "exempt_only_cut", P["宅配（個建て）"]);
    expect(i).toMatchObject({ severity: "red", sourceUrl: SOURCES.exemptQa, fixHref: `/settings/rates?driver=${D.D03}&project=${P["宅配（個建て）"]}` });
    expect(i.detail.startsWith("登録の無い方だけ単価が下がっています。取引の条件を協議した記録を確認してください。")).toBe(true);
    expect(i.detail).toContain("上田 健さん（150円 → 140円）");
    expect(i.detail).toContain("登録のある 1人（青木 翔太）は下がっていません");
    expect(i.impact?.yen).toBe(18000);
    // 人ごとの「単価の変化」も出る（黄）
    expect(find(nov, "rate_down", `${D.D03}:${P["宅配（個建て）"]}`)[0].impact?.yen).toBe(18000);
    expectWellFormed(nov);
    // 他社の 11 月には出ない
    expect(find(await runWatch(db, otherTenantId, NOV, { today: "2026-11-30" }), "exempt_only_cut")).toHaveLength(0);
    await db.delete(s.rateOverrides).where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, D.D03)));
  });

  it("11 月：新しく「遅配ペナルティ」を足す → 違約金の名目（黄）と、前の月に無かった控除（黄）", async () => {
    const [r] = await db
      .insert(s.deductionRules)
      .values({ tenantId, driverId: D.D01, name: "遅配ペナルティ", kind: "fixed", amount: 3000, onlyWhenWorked: true, taxable: false, agreedInWriting: true, agreedOn: "2026-10-20", basis: "覚書", sort: 9 })
      .returning();
    const nov = await run(NOV, "2026-11-30");
    expect(find(nov, "ded_penalty", r.id)[0]).toMatchObject({ severity: "yellow", subjectLabel: "遅配ペナルティ（青木 翔太）" });
    expect(find(nov, "ded_penalty", r.id)[0].impact?.yen).toBe(3000);
    const [added] = find(nov, "ded_new_or_up", `${D.D01}:${r.id}`);
    expect(added.title).toBe("前の月には無かった控除が加わっています");
    expect(added.detail).toContain("合意の日：2026年10月20日");
    expect(added.impact?.yen).toBe(3000);
    await db.delete(s.deductionRules).where(eq(s.deductionRules.id, r.id));
  });

  it("3か月後払いでも、再委託の3項目の記録がある青木さんは元委託の支払期日から30日で数え、残りの人の額を影響額にする", async () => {
    await db.update(s.tenants).set({ payMonthOffset: 3, payDay: 5 }).where(eq(s.tenants.id, tenantId));
    const content = await buildTermsContent(db, tenantId, D.D01, { month: DEMO_MONTH });
    await db.insert(s.termsRecords).values({
      tenantId,
      driverId: D.D01,
      version: 1,
      issuedOn: "2026-04-01",
      content,
      subcontract: { isSubcontract: true, originalClient: "A物流（架空）", originalPayDate: "翌々月末日" },
    });
    const issues = await run();
    const [i] = find(issues, "sixty_days");
    expect(i.severity).toBe("red");
    expect(i.detail).toContain("青木 翔太さん（元委託の支払期日 2026年12月31日・特例の期限 2027年1月29日）");
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const rest = drafts.filter((d) => d.driverId !== D.D01 && (d.total > 0 || d.hasWork));
    expect(i.impact).toEqual({ yen: rest.reduce((a, d) => a + Math.max(d.total, 0), 0), label: `対象の方の2026年10月分の支払額の合計（${rest.length}人）` });
    // 他社（同じ設定の記録なし）には特例の話が出ない
    await db.update(s.tenants).set({ payMonthOffset: 3, payDay: 5 }).where(eq(s.tenants.id, otherTenantId));
    const other = find(await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY }), "sixty_days")[0];
    expect(other.detail).not.toContain("特例");
    await db.update(s.tenants).set({ payMonthOffset: 1, payDay: 25 }).where(eq(s.tenants.id, tenantId));
    await db.update(s.tenants).set({ payMonthOffset: 1, payDay: 25 }).where(eq(s.tenants.id, otherTenantId));
  });

  it("20日締めにすると、10月分（9/21〜10/20）は経過措置の境目をまたぎ、日付の無い 3 人 → 黄", async () => {
    await db.update(s.tenants).set({ closingDay: 20 }).where(eq(s.tenants.id, tenantId));
    const issues = await run();
    const [i] = find(issues, "transitional_span");
    expect(i.severity).toBe("yellow");
    expect(i.subjectLabel).toBe("インボイスの登録が無い方 3人");
    expect(i.detail).toContain("上田 健・遠藤 大輔・木村 誠");
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const { nonDeductibleTax } = await import("@/lib/payroll/tax");
    const expected = drafts
      .filter((d) => d.undatedAcrossStep && !d.driver.invoiceRegistered)
      .reduce((a, d) => a + nonDeductibleTax(d.subtotal + d.tax, d.period.to) - nonDeductibleTax(d.subtotal + d.tax, d.period.from), 0);
    expect(expected).toBeGreaterThan(0);
    expect(i.impact?.yen).toBe(expected);
    await db.update(s.tenants).set({ closingDay: 0 }).where(eq(s.tenants.id, tenantId));
    expect(find(await run(), "transitional_span")).toHaveLength(0);
  });

  it("締めた月にも質問は届く：10 月を締めたあとの質問は黄で出て、確認済みにできる", async () => {
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, D.D07)));
    // 締める前に明細を今の稼働に合わせておく
    await generateStatements(db, tenantId, DEMO_MONTH);
    await db.insert(s.monthCloses).values({ tenantId, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    await db.insert(s.statementMessages).values({ tenantId, statementId: st.id, author: "driver", lineKey: null, body: "振込はいつですか", createdAt: new Date("2026-11-02T09:00:00+09:00") });
    const month = await watchMonth(db, tenantId, DEMO_MONTH, { today: "2026-11-03" });
    expect(month.closed).toBe(true);
    const [q] = find(month.issues, "open_questions", D.D07);
    // 明細全体への質問は、その明細の振込額（木村さん 34,430円）を影響額にする
    const [saved] = await db.select().from(s.statements).where(eq(s.statements.id, st.id));
    expect(saved.total).toBe(34430);
    expect(q.impact).toEqual({ yen: 34430, label: "振込額（明細全体への質問があるため）" });
    const acked = await ackWatchIssue(db, tenantId, { month: DEMO_MONTH, code: "open_questions", subjectId: D.D07, note: "電話で振込日を伝えた" }, null, { today: "2026-11-03" });
    expect(acked.acked).toBe(true);
    // 操作の記録に、確認した指摘の影響額とルールの時点も残る
    const [log] = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "watch.ack"), eq(s.auditLog.entityId, `open_questions:${D.D07}`)));
    expect(log.detail).toMatchObject({ code: "open_questions", subjectId: D.D07, impactYen: 34430, impactLabel: "振込額（明細全体への質問があるため）", ruleAsOf: "2026年9月" });
    // 他社の確認済みには混ざらない
    expect((await runWatch(db, otherTenantId, DEMO_MONTH, { today: "2026-11-03" })).every((i) => !i.acked)).toBe(true);
  });
});
