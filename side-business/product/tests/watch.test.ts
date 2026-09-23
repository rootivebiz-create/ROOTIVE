import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import { runWatch, watchMonth } from "~/server/features/watch";
import { ackWatchIssue, changedSinceAck, monthAckDetails, previousAcks, unackWatchIssue } from "~/server/features/watch/acks";
import { FEE_SENTENCE } from "~/server/features/watch/rules";
import { SOURCES } from "~/server/features/watch/sources";
import type { WatchIssue } from "~/server/features/watch-types";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { loadBuildInput } from "~/server/repo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 見張り番を、架空の会社（seedDemo）の 2026 年 10 月で動かす。
 * 数字は明細の計算（buildStatementDrafts）と同じ値になることを確かめる。
 */

const TODAY = "2026-10-31";
const ALLOWED_SOURCES = new Set<string>(Object.values(SOURCES));
/** 言ってはいけないこと（取適法の「適法」は除く） */
const FORBIDDEN = /(?<!取)適法|違反です|違反はありません|問題ありません|法令に完全対応|大丈夫|必ず合う|ミスゼロ|完全自動|補助金|単価を下げ|引き下げ|偽装請負|労働者に当た/;

async function driverId(db: Db, tenantId: string, code: string): Promise<string> {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d.id;
}

async function ruleId(db: Db, tenantId: string, name: string): Promise<string> {
  const [r] = await db.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, name)));
  return r.id;
}

async function setSettings(db: Db, tenantId: string, patch: s.TenantSettings) {
  const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
  await db
    .update(s.tenants)
    .set({ settings: { ...t.settings, ...patch } })
    .where(eq(s.tenants.id, tenantId));
}

const find = (issues: WatchIssue[], code: string, subjectId?: string) => issues.filter((i) => i.code === code && (subjectId === undefined || i.subjectId === subjectId));

function expectWellFormed(issues: WatchIssue[]) {
  const rank = { red: 0, yellow: 1, info: 2 } as const;
  for (let i = 1; i < issues.length; i++) expect(rank[issues[i - 1].severity]).toBeLessThanOrEqual(rank[issues[i].severity]);
  for (const i of issues) {
    expect(i.title.length).toBeGreaterThan(0);
    expect(i.detail.length).toBeGreaterThan(0);
    expect(`${i.title}${i.detail}${i.basis ?? ""}${i.subjectLabel}`).not.toMatch(FORBIDDEN);
    if (i.sourceUrl) expect(ALLOWED_SOURCES.has(i.sourceUrl)).toBe(true);
    expect(i.blocksClose).toBe(i.severity === "red" && !i.acked);
  }
}

describe("見張り番：架空の会社の 2026年10月", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;
  let issues: WatchIssue[];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
    for (const code of ["D01", "D03", "D04", "D07"]) ids[code] = await driverId(db, tenantId, code);
    issues = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
  });
  afterAll(async () => client.close());

  it("重い順に並び、文面に言ってはいけないことが無く、出典は確かめ済みの URL だけ", () => {
    expect(issues.length).toBeGreaterThan(5);
    expectWellFormed(issues);
    expect(issues[0].severity).toBe("red");
    expect(issues.at(-1)!.severity).toBe("info");
  });

  it("遠藤（D04）：取引条件の記録が無い → 赤（締めを止める）", () => {
    const [i] = find(issues, "terms_missing", ids.D04);
    expect(i).toMatchObject({ severity: "red", subjectLabel: "遠藤 大輔", acked: false, blocksClose: true, basis: "フリーランス法 第3条（取引条件の明示）", sourceUrl: SOURCES.flQa });
    expect(i.detail).toContain("2026年10月分の支払額は 294,800円です");
    // 直す画面は、その人の設定を開いた状態
    expect(i.fixHref).toBe(`/settings/drivers/${ids.D04}`);
    // 明示の記録がある人は出ない
    expect(find(issues, "terms_missing", ids.D01)).toHaveLength(0);
  });

  it("木村（D07）：合意の記録が無い制服代 → 赤", async () => {
    const uniform = await ruleId(db, tenantId, "制服代");
    const [i] = find(issues, "deduction_no_agreement", uniform);
    expect(i.severity).toBe("red");
    expect(i.subjectLabel).toBe("制服代（木村 誠）");
    expect(i.detail).toContain("2026年10月分 木村 誠さん・5,000円");
    // 木村さんだけの控除なので、控除のルールを木村さんで絞って開く
    expect(i.fixHref).toBe(`/settings/rules?m=2026-10&driver=${ids.D07}`);
    expect(i.basis).toContain("第5条");
    // 書面の合意はあるが日付が無いロイヤリティは黄（8 人・241,060 円）
    const royalty = find(issues, "deduction_no_agreement", await ruleId(db, tenantId, "ロイヤリティ"))[0];
    expect(royalty.severity).toBe("yellow");
    expect(royalty.detail).toContain("8人");
    expect(royalty.detail).toContain("241,060円");
    expect(royalty.fixHref).toBe("/settings/rules?m=2026-10");
  });

  it("上田（D03）の車両修理の負担分：根拠が空 → 黄（直す画面はその調整を開く）", async () => {
    const adj = issues.find((i) => i.code === "deduction_no_agreement" && i.subjectLabel === "上田 健・車両修理の負担分");
    expect(adj?.severity).toBe("yellow");
    expect(adj?.detail).toContain("11,000円");
    const [row] = await db.select().from(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.label, "車両修理の負担分")));
    expect(adj?.subjectId).toBe(`adj:${row.id}`);
    expect(adj?.fixHref).toBe(`/work?m=2026-10&adj=${row.id}#adjustments`);
  });

  it("岡田（D05）の人ごとの単価 155 円：合意の日が無い → 黄（人ごとの単価の画面を開く）", async () => {
    const [o] = await db.select().from(s.rateOverrides).where(eq(s.rateOverrides.tenantId, tenantId));
    const [i] = find(issues, "rate_changed_without_record", o.id);
    expect(i.severity).toBe("yellow");
    // 420 個 × 155 円 = 65,100 円
    expect(i.detail).toContain("2026年10月分は 420個で 65,100円です");
    expect(i.fixHref).toBe(`/settings/rates?driver=${o.driverId}&project=${o.projectId}`);
  });

  it("木村（D07）：口座が無い → 黄（振込額 34,430 円）", () => {
    const [i] = find(issues, "no_bank", ids.D07);
    expect(i.severity).toBe("yellow");
    expect(i.detail).toContain("34,430円");
    expect(i.fixHref).toBe(`/settings/drivers/${ids.D07}`);
    expect(find(issues, "no_bank", ids.D01)).toHaveLength(0);
  });

  it("木村（D07）：宅配が 1,300 個 → 380 個（−71%）→ 黄", () => {
    const [i] = find(issues, "qty_jump", ids.D07);
    expect(i.severity).toBe("yellow");
    expect(i.detail).toContain("1,300個 → 380個");
    expect(i.detail).toContain("−71%");
    expect(find(issues, "qty_jump", ids.D01)).toHaveLength(0);
  });

  it("インボイスの登録が無い 3 人：控除できない消費税は 70% で 20,490 円、次は 2028年10月から 50%", async () => {
    const [i] = find(issues, "invoice_burden");
    expect(i.severity).toBe("info");
    expect(i.detail).toContain("70%");
    expect(i.detail).toContain("20,490円");
    expect(i.detail).toContain("2028年10月から 50%");
    expect(i.detail).toContain("34,150円");
    expect(i.detail).not.toMatch(/単価|報酬を/);
    // 明細の計算と同じ値（上田 8,280・遠藤 10,500・木村 1,710）
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    expect(drafts.filter((d) => !d.driver.invoiceRegistered).reduce((a, d) => a + d.invoiceBurden, 0)).toBe(20490);
  });

  it("振込手数料・支払日・取適法：初期の設定では赤を出さない（文言と資本金はお知らせ）", () => {
    expect(find(issues, "fee_deducted")).toHaveLength(0);
    expect(find(issues, "sixty_days")).toHaveLength(0);
    expect(find(issues, "paid_late")).toHaveLength(0);
    expect(find(issues, "payment_wording")[0]).toMatchObject({ severity: "info", fixHref: "/settings/company?m=2026-10" });
    expect(find(issues, "toriteki")[0].detail).toBe("資本金と従業員の数を入れると、取適法の対象かどうかの目安を出します。会社の設定から入れられます。");
    expect(find(issues, "statements_stale")[0]).toMatchObject({ severity: "yellow", title: "明細をまだ作っていません" });
  });

  it("振込手数料をドライバーの負担にすると、必ず赤（設定・控除・調整）", async () => {
    await setSettings(db, tenantId, { transferFeeBearer: "driver" });
    const [fee] = await db
      .insert(s.deductionRules)
      .values({ tenantId, name: "振込手数料", kind: "fixed", amount: 440, onlyWhenWorked: true, taxable: false, agreedInWriting: false, sort: 9 })
      .returning();
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: ids.D01, label: "送金手数料", amount: -330, agreedInWriting: true, basis: "契約" });
    const after = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
    const fees = find(after, "fee_deducted");
    expect(fees.map((i) => i.subjectId).sort()).toEqual(expect.arrayContaining(["tenant", fee.id]));
    expect(fees.every((i) => i.severity === "red" && i.blocksClose)).toBe(true);
    expect(fees.find((i) => i.subjectId === "tenant")!.detail).toContain(FEE_SENTENCE);
    expect(fees.find((i) => i.subjectId === fee.id)!.detail).toContain("8人");
    expect(fees.find((i) => i.subjectId === fee.id)!.detail).toContain("3,520円");
    expect(fees.find((i) => i.subjectLabel === "青木 翔太・送金手数料")!.detail).toContain("330円");
    expect(fees[0].sourceUrl).toBe(SOURCES.toritekiLeaflet);
    // 同じ控除を「合意が無い」で二重に出さない
    expect(find(after, "deduction_no_agreement", fee.id)).toHaveLength(0);
    expectWellFormed(after);
    // 元に戻す
    await setSettings(db, tenantId, { transferFeeBearer: "company" });
    await db.delete(s.deductionRules).where(eq(s.deductionRules.id, fee.id));
    await db.delete(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.label, "送金手数料")));
  });

  it("赤を確認済みにすると acked・締めを止めない。外すと元に戻る（操作の記録つき）", async () => {
    const staff = (await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff"))))[0];
    const key = { month: DEMO_MONTH, code: "terms_missing", subjectId: ids.D04 };
    await expect(ackWatchIssue(db, tenantId, { ...key, note: "短い" }, staff.id, { today: TODAY })).rejects.toThrow("10 文字以上");
    await expect(ackWatchIssue(db, tenantId, { ...key, subjectId: ids.D01, note: "契約書を確かめました。日付どおりです" }, staff.id, { today: TODAY })).rejects.toThrow("いまは出ていません");

    const acked = await ackWatchIssue(db, tenantId, { ...key, note: "  業務委託契約書（2026年5月1日）を確認。台帳への入れ忘れ  " }, staff.id, { today: TODAY });
    expect(acked).toMatchObject({ acked: true, blocksClose: false });
    const after = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
    const [i] = find(after, "terms_missing", ids.D04);
    expect(i).toMatchObject({ severity: "red", acked: true, blocksClose: false, ackNote: "業務委託契約書（2026年5月1日）を確認。台帳への入れ忘れ" });
    // 赤のうち、締めを止めるのは制服代だけ
    expect(after.filter((x) => x.blocksClose).map((x) => x.code)).toEqual(["deduction_no_agreement"]);
    const details = await monthAckDetails(db, tenantId, DEMO_MONTH);
    expect([...details.values()][0]).toMatchObject({ byName: "デモ 事務" });

    // もう一度付けるとメモが上書きされる（重ならない）
    await ackWatchIssue(db, tenantId, { ...key, note: "契約書の原本と控えを両方確認した" }, staff.id, { today: TODAY });
    const rows = await db.select().from(s.watchAcks).where(eq(s.watchAcks.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("契約書の原本と控えを両方確認した");

    await unackWatchIssue(db, tenantId, key, staff.id);
    const back = find(await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY }), "terms_missing", ids.D04)[0];
    expect(back).toMatchObject({ acked: false, blocksClose: true, ackNote: null });
    await expect(unackWatchIssue(db, tenantId, key, staff.id)).rejects.toThrow("見つかりません");

    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.tenantId, tenantId));
    expect(log.filter((r) => r.action === "watch.ack")).toHaveLength(2);
    const un = log.find((r) => r.action === "watch.unack")!;
    expect(un.detail).toMatchObject({ code: "terms_missing", subjectId: ids.D04, previousNote: "契約書の原本と控えを両方確認した" });
  });

  it("黄は 4 文字から確認済みにできる。前の月のメモは翌月の下書きに使える", async () => {
    const key = { month: DEMO_MONTH, code: "no_bank", subjectId: ids.D07 };
    await ackWatchIssue(db, tenantId, { ...key, note: "手渡し予定" }, null, { today: TODAY });
    const prev = await previousAcks(db, tenantId, "2026-11-01");
    expect(prev.get(`no_bank\u0000${ids.D07}`)).toEqual({ month: DEMO_MONTH, note: "手渡し予定" });
    await unackWatchIssue(db, tenantId, key, null);
  });

  it("他社のデータは読まない・変えない", async () => {
    const staff = (await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff"))))[0];
    await ackWatchIssue(db, tenantId, { month: DEMO_MONTH, code: "terms_missing", subjectId: ids.D04, note: "契約書の原本を確認しました（控えあり）" }, staff.id, { today: TODAY });

    const other = await runWatch(db, otherTenantId, DEMO_MONTH, { today: TODAY });
    const otherDrivers = new Set((await db.select().from(s.drivers).where(eq(s.drivers.tenantId, otherTenantId))).map((d) => d.id));
    const ourDrivers = new Set(Object.values(ids));
    for (const i of other) expect(ourDrivers.has(i.subjectId)).toBe(false);
    const otherD04 = find(other, "terms_missing").map((i) => i.subjectId);
    expect(otherD04).toHaveLength(1);
    expect(otherDrivers.has(otherD04[0])).toBe(true);
    // 他社の確認済みは混ざらない
    expect(other.every((i) => !i.acked)).toBe(true);

    // 他社の id で確認済みにしようとしても、その会社には出ていない指摘なので断る
    await expect(ackWatchIssue(db, otherTenantId, { month: DEMO_MONTH, code: "terms_missing", subjectId: ids.D04, note: "他社の指摘を確認済みにする" }, null, { today: TODAY })).rejects.toThrow("いまは出ていません");
    // 他社から外そうとしても外れない
    await expect(unackWatchIssue(db, otherTenantId, { month: DEMO_MONTH, code: "terms_missing", subjectId: ids.D04 }, null)).rejects.toThrow("見つかりません");
    const mine = find(await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY }), "terms_missing", ids.D04)[0];
    expect(mine.acked).toBe(true);
    expect(await previousAcks(db, otherTenantId, "2026-11-01")).toHaveProperty("size", 0);
  });

  it("締めた 9 月も読める（見るだけ。確認済みにはできない。ただし振込の遅れは締めたあとでもメモを残せる）", async () => {
    const sep = await watchMonth(db, tenantId, DEMO_PREV_MONTH, { today: "2026-10-01" });
    expect(sep.closed).toBe(true);
    expect(find(sep.issues, "terms_missing", ids.D04)[0]).toMatchObject({ severity: "red", blocksClose: true });
    expect(find(sep.issues, "deduction_no_agreement", await ruleId(db, tenantId, "制服代"))[0].severity).toBe("red");
    // 締めた月には「明細を作り直して」を出さない
    expect(find(sep.issues, "statements_stale")).toHaveLength(0);
    // 9 月は経過措置 80%、次は 2026年10月から 70%
    expect(find(sep.issues, "invoice_burden")[0].detail).toContain("80%");
    expect(find(sep.issues, "invoice_burden")[0].detail).toContain("2026年10月から 70%");
    expectWellFormed(sep.issues);
    await expect(
      ackWatchIssue(db, tenantId, { month: DEMO_PREV_MONTH, code: "terms_missing", subjectId: ids.D04, note: "締めたあとに確認しました" }, null, { today: TODAY }),
    ).rejects.toThrow("締め済み");
    await expect(unackWatchIssue(db, tenantId, { month: DEMO_PREV_MONTH, code: "terms_missing", subjectId: ids.D04 }, null)).rejects.toThrow("締め済み");

    // 支払期日（10/25）を過ぎても振り込んだ日の記録が無い → 締めたあとでも確認済みにできる（振込はふつう締めのあと）
    const late = await watchMonth(db, tenantId, DEMO_PREV_MONTH, { today: "2026-10-26" });
    const [unpaid] = find(late.issues, "paid_late", "unpaid");
    expect(unpaid).toMatchObject({ severity: "yellow", acked: false });
    expect(unpaid.detail).toContain("2026年10月25日");
    const acked = await ackWatchIssue(db, tenantId, { month: DEMO_PREV_MONTH, code: "paid_late", subjectId: "unpaid", note: "10/26 に手作業で振り込み済み" }, null, { today: "2026-10-26" });
    expect(acked.acked).toBe(true);
    expect(find(await runWatch(db, tenantId, DEMO_PREV_MONTH, { today: "2026-10-26" }), "paid_late", "unpaid")[0].ackNote).toBe("10/26 に手作業で振り込み済み");
    await unackWatchIssue(db, tenantId, { month: DEMO_PREV_MONTH, code: "paid_late", subjectId: "unpaid" }, null);
    // 締めた月の明細・稼働の数字は変わらない（写しが無い 9 月は稼働から作った見込みのまま）
    expect(find(late.issues, "terms_missing", ids.D04)[0].detail).toContain("2026年9月分の支払額は 278,960円です");
  });
});

describe("見張り番：記録を変えたときの指摘", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    for (const code of ["D01", "D02", "D03", "D05", "D07", "D08"]) ids[code] = await driverId(db, tenantId, code);
  });
  afterAll(async () => client.close());

  const run = (month = DEMO_MONTH, today = TODAY) => runWatch(db, tenantId, month, { today });

  it("明示の日が最初の稼働より後 → 赤。最初の版の記録があれば、そちらで比べる", async () => {
    await db.update(s.drivers).set({ termsIssuedOn: "2026-10-15" }).where(eq(s.drivers.id, ids.D01));
    const [i] = find(await run(), "terms_missing", ids.D01);
    expect(i.severity).toBe("red");
    expect(i.title).toBe("取引条件の明示が、仕事を始めたあとになっています");
    expect(i.detail).toContain("2026年10月15日");
    expect(i.detail).toContain("2026年9月");

    // 4 月に最初の版を出していた（最新の版だけが台帳に入っている）
    await db.insert(s.termsRecords).values({ tenantId, driverId: ids.D01, version: 1, issuedOn: "2026-04-01", content: {} });
    expect(find(await run(), "terms_missing", ids.D01)).toHaveLength(0);
  });

  it("日付の無い稼働の月の途中で明示 → 黄（委託を始めた日で確かめられる）。日付のある稼働より後の明示 → 赤", async () => {
    await db.update(s.drivers).set({ termsIssuedOn: "2026-09-10" }).where(eq(s.drivers.id, ids.D02));
    const unsure = find(await run(), "terms_missing", ids.D02)[0];
    expect(unsure.severity).toBe("yellow");
    expect(unsure.detail).toContain("日付が無い");
    await db.update(s.drivers).set({ startedOn: "2026-09-15" }).where(eq(s.drivers.id, ids.D02));
    expect(find(await run(), "terms_missing", ids.D02)).toHaveLength(0);
    await db.update(s.drivers).set({ termsIssuedOn: "2026-04-01", startedOn: null }).where(eq(s.drivers.id, ids.D02));

    // 10 月から始めた人：10/3 に稼働して、明示は 10/10
    const [p] = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
    const [newbie] = await db.insert(s.drivers).values({ tenantId, code: "D09", name: "新井 花子", termsIssuedOn: "2026-10-10" }).returning();
    await db.insert(s.workEntries).values({ tenantId, month: DEMO_MONTH, driverId: newbie.id, projectId: p.id, qty: 1, workDate: "2026-10-03" });
    const red = find(await run(), "terms_missing", newbie.id)[0];
    expect(red.severity).toBe("red");
    expect(red.detail).toContain("最初の稼働日（2026年10月3日）");
    // 稼働の日付が明示の日より後なら出ない
    await db.update(s.workEntries).set({ workDate: "2026-10-12" }).where(eq(s.workEntries.driverId, newbie.id));
    expect(find(await run(), "terms_missing", newbie.id)).toHaveLength(0);
    await db.delete(s.drivers).where(eq(s.drivers.id, newbie.id));
  });

  it("支払期日の文言：「まで」「請求書受領」→ 黄、日を特定した書き方 → 出ない", async () => {
    await setSettings(db, tenantId, { paymentTermsText: "毎月末日締め、請求書受領の翌月末日までに支払う" });
    const [i] = find(await run(), "payment_wording");
    expect(i.severity).toBe("yellow");
    expect(i.title).toContain("まで");
    expect(i.title).toContain("請求書受領");
    await setSettings(db, tenantId, { paymentTermsText: "毎月末日締め・翌月25日払い" });
    expect(find(await run(), "payment_wording")).toHaveLength(0);
  });

  it("60日（2か月）：3か月後払い → 赤、20日締め・翌月末払い → 黄、末締め・翌月25日払い → 出ない", async () => {
    await db.update(s.tenants).set({ payMonthOffset: 3, payDay: 5 }).where(eq(s.tenants.id, tenantId));
    const [red] = find(await run(), "sixty_days");
    expect(red.severity).toBe("red");
    expect(red.detail).toContain("毎月末日締め・3か月後の5日払い");
    expect(red.detail).toContain("2027年1月5日");
    expect(red.detail).toContain("2026年12月30日より 6日後");
    expect(red.blocksClose).toBe(true);
    await db.update(s.tenants).set({ closingDay: 20, payMonthOffset: 1, payDay: 0 }).where(eq(s.tenants.id, tenantId));
    const [yellow] = find(await run(), "sixty_days");
    expect(yellow.severity).toBe("yellow");
    expect(yellow.detail).toContain("2026年9月21日〜2026年10月20日");
    expect(yellow.detail).toContain("2026年11月30日");
    await db.update(s.tenants).set({ closingDay: 0, payMonthOffset: 1, payDay: 25 }).where(eq(s.tenants.id, tenantId));
    expect(find(await run(), "sixty_days")).toHaveLength(0);
  });

  it("支払期日より後に振り込んだ → 赤（人と日数）、期日を過ぎて記録が無い → 黄", async () => {
    await generateStatements(db, tenantId, DEMO_MONTH);
    const before = await run(DEMO_MONTH, "2026-11-26");
    const unpaid = find(before, "paid_late", "unpaid")[0];
    expect(unpaid.severity).toBe("yellow");
    expect(unpaid.detail).toContain("2026年11月25日");
    expect(unpaid.detail).toContain("8人");
    // 期日の前は出ない
    expect(find(await run(DEMO_MONTH, "2026-11-25"), "paid_late")).toHaveLength(0);

    const sts = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)));
    const aoki = sts.find((x) => x.driverId === ids.D01)!;
    const [batch] = await db
      .insert(s.transferBatches)
      .values({ tenantId, month: DEMO_MONTH, transferDate: "2026-11-27", executedOn: "2026-11-27", statementIds: [aoki.id], count: 1, total: aoki.total, fileName: "振込_2026年10月分_20261127.txt" })
      .returning();
    const after = await run(DEMO_MONTH, "2026-11-30");
    const late = find(after, "paid_late", batch.id)[0];
    expect(late.severity).toBe("red");
    expect(late.detail).toContain("2日後");
    expect(late.detail).toContain("青木 翔太");
    expect(late.detail).toContain("357,555円");
    expect(late.fixHref).toBe("/transfer?m=2026-10");
    // 残りの 7 人はまだ記録が無い
    expect(find(after, "paid_late", "unpaid")[0].detail).toContain("7人");
    await db.delete(s.transferBatches).where(eq(s.transferBatches.id, batch.id));
  });

  it("明細を作ったあとに調整を足す → 「明細を作り直してください」", async () => {
    expect(find(await run(), "statements_stale")).toHaveLength(0);
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: ids.D08, label: "高速代の立替", amount: 1200, agreedInWriting: true });
    const [i] = find(await run(), "statements_stale");
    expect(i).toMatchObject({ severity: "yellow", title: "明細を作り直してください", fixHref: "/statements?m=2026-10" });
    expect(i.detail).toContain("1人");
  });

  it("合意の日がこの月の途中 → 黄。事故の負担で根拠も合意も無い → 黄。振込額がマイナス → 赤", async () => {
    await db.update(s.deductionRules).set({ agreedOn: "2026-10-10" }).where(eq(s.deductionRules.id, await ruleId(db, tenantId, "管理費")));
    await db.update(s.deductionRules).set({ agreedOn: "2026-03-20" }).where(eq(s.deductionRules.id, await ruleId(db, tenantId, "ロイヤリティ")));
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: ids.D07, label: "事故の負担", amount: -100000, agreedInWriting: false });
    const issues = await run();
    const mgmt = find(issues, "deduction_no_agreement", await ruleId(db, tenantId, "管理費"))[0];
    expect(mgmt.title).toBe("控除の合意が、この月の途中です");
    expect(mgmt.detail).toContain("2026年10月10日");
    expect(find(issues, "deduction_no_agreement", await ruleId(db, tenantId, "ロイヤリティ"))).toHaveLength(0);
    const accident = issues.find((i) => i.subjectLabel === "木村 誠・事故の負担")!;
    expect(accident).toMatchObject({ severity: "yellow", title: "事故・破損などの負担の根拠が入っていません" });
    expect(accident.detail).toContain("書面で合意した記録がありません");
    expect(accident.detail).toContain("根拠");
    // 34,430 − 100,000 = −65,570
    const neg = find(issues, "negative_total", ids.D07)[0];
    expect(neg.severity).toBe("red");
    expect(neg.detail).toContain("マイナス 65,570円");
    // 内訳は明細の値そのまま：57,000 ＋ 5,700 − 28,270 − 100,000 = −65,570
    expect(neg.detail).toContain("委託料 57,000円 ＋ 消費税相当額 5,700円 − 控除 28,270円（消費税を含む） − 調整 100,000円");
    const d07 = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH)).find((d) => d.driverId === ids.D07)!;
    expect(d07.total).toBe(-65570);
    expect(d07.subtotal + d07.tax - (d07.deductionTotal + d07.deductionTax) + d07.adjustmentTotal + d07.adjustmentTax).toBe(-65570);
    expect(find(issues, "no_bank", ids.D07)).toHaveLength(0);
    await db.delete(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.label, "事故の負担")));
  });

  it("登録番号の形・確かめた日", async () => {
    await db.update(s.drivers).set({ registrationNo: "T123" }).where(eq(s.drivers.id, ids.D01));
    await db.update(s.drivers).set({ registrationCheckedOn: "2026-10-20" }).where(eq(s.drivers.id, ids.D02));
    const issues = await run();
    expect(find(issues, "invoice_number", ids.D01)[0]).toMatchObject({ severity: "yellow", title: "登録番号の形が正しくありません" });
    const check = find(issues, "invoice_number", "registration_check")[0];
    expect(check.severity).toBe("info");
    expect(check.detail).toContain("3人");
    expect(check.detail).not.toContain("井上 美咲");
    expect(check.sourceUrl).toBe(SOURCES.invoiceRegistry);
    await db.update(s.drivers).set({ registrationNo: "T9876543210987" }).where(eq(s.drivers.id, ids.D01));
  });

  it("6か月以上続いた委託の終了：予告が 30 日未満 → 黄、30 日以上前 → 出ない", async () => {
    await db.update(s.drivers).set({ startedOn: "2026-01-01", endOn: "2026-10-31", endNoticedOn: "2026-10-15" }).where(eq(s.drivers.id, ids.D08));
    const [i] = find(await run(), "contract_end", ids.D08);
    expect(i.severity).toBe("yellow");
    expect(i.detail).toContain("16日前");
    expect(i.basis).toContain("第16条");
    expect(i.fixHref).toBe(`/settings/drivers/${ids.D08}`);
    // 予告の記録が無いときは、30 日前の日を書く（10/31 の 30 日前は 10/1。今日 10/31 にはもう過ぎている）
    await db.update(s.drivers).set({ endNoticedOn: null }).where(eq(s.drivers.id, ids.D08));
    const [none] = find(await run(), "contract_end", ids.D08);
    expect(none.title).toBe("委託の終了を伝えた日の記録がありません");
    expect(none.detail).toContain("終了日の30日前は2026年10月1日で、すでに過ぎています");
    await db.update(s.drivers).set({ endNoticedOn: "2026-09-15" }).where(eq(s.drivers.id, ids.D08));
    expect(find(await run(), "contract_end", ids.D08)).toHaveLength(0);
    // 6 か月に満たない委託は出ない
    await db.update(s.drivers).set({ startedOn: "2026-06-01", endNoticedOn: null }).where(eq(s.drivers.id, ids.D08));
    expect(find(await run(), "contract_end", ids.D08)).toHaveLength(0);
    await db.update(s.drivers).set({ startedOn: null, endOn: null, endNoticedOn: null }).where(eq(s.drivers.id, ids.D08));
  });

  it("前月は稼働があった人に今月の稼働が無い → お知らせ。まだ誰の稼働も無い月には人ごとに出さない", async () => {
    await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, ids.D08)));
    const [i] = find(await run(), "work_missing", ids.D08);
    expect(i.severity).toBe("info");
    expect(i.subjectLabel).toBe("佐藤 亮");
    expect(i.title).toBe("前月は稼働があった方に、この月の稼働がありません");
    // 11 月はまだ誰の稼働も入っていない（10 月に 7 人いても人ごとには出さない。画面の「稼働がまだありません」の案内だけ）
    expect(find(await run("2026-11-01", "2026-11-01"), "work_missing")).toHaveLength(0);
  });

  it("取適法の目安：資本金 3,000 万円 → 「対象になる可能性」", async () => {
    await setSettings(db, tenantId, { capitalYen: 30_000_000, employees: 12 });
    const [i] = find(await run(), "toriteki");
    expect(i.title).toBe("取適法の対象になる可能性があります");
    expect(i.detail).toContain("支払期日・手形の禁止・書面の保存などを弁護士等にご確認ください");
    await setSettings(db, tenantId, { capitalYen: 5_000_000, employees: 12 });
    expect(find(await run(), "toriteki")).toHaveLength(0);
  });

  it("前の締めた月の明細より単価が下がった → 黄（協議した記録の確認）", async () => {
    // 10 月を締め、11 月に同じ人が安い単価で稼働する
    await generateStatements(db, tenantId, DEMO_MONTH);
    await db.insert(s.monthCloses).values({ tenantId, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
    const takuhai = projects.find((p) => p.name === "宅配（個建て）")!;
    await db.insert(s.rateOverrides).values({ tenantId, driverId: ids.D03, projectId: takuhai.id, payRate: 140, agreedOn: "2026-10-25" });
    await db.insert(s.workEntries).values({ tenantId, month: "2026-11-01", driverId: ids.D03, projectId: takuhai.id, qty: 1800 });
    const issues = await run("2026-11-01", "2026-11-30");
    const [i] = find(issues, "rate_down", `${ids.D03}:${takuhai.id}`);
    expect(i.severity).toBe("yellow");
    expect(i.detail).toContain("150円 から 140円");
    expect(i.detail).toContain("18,000円");
    expect(i.detail).toContain("前月より単価が下がっています。協議した記録を確認してください");
    expect(i.fixHref).toBe(`/settings/rates?driver=${ids.D03}&project=${takuhai.id}`);
    // 合意の日がある単価なので「単価を変えた記録」は出ない
    expect(find(issues, "rate_changed_without_record", ids.D03)).toHaveLength(0);
    expectWellFormed(issues);
  });
});

describe("見張り番：確認済みにしたあとで中身が変わったら知らせる", () => {
  it("制服代を確認済みにしたあと 5,000円 → 50,000円 に変わる → 「確かめ直して」（締めは止めない）。書き直すと消える。他社の記録は見ない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const uniform = await ruleId(db, tenantId, "制服代");
    const key = { month: DEMO_MONTH, code: "deduction_no_agreement", subjectId: uniform };
    await ackWatchIssue(db, tenantId, { ...key, note: "制服の購入の申込書（本人の署名つき）を確認" }, null, { today: TODAY });
    let issues = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
    expect(await changedSinceAck(db, tenantId, DEMO_MONTH, issues)).toHaveProperty("size", 0);

    await db.update(s.deductionRules).set({ amount: 50000 }).where(eq(s.deductionRules.id, uniform));
    issues = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
    const [i] = find(issues, "deduction_no_agreement", uniform);
    expect(i.detail).toContain("木村 誠さん・50,000円");
    // 確認済みのまま（締めは止めない）で、中身が変わったことだけ知らせる
    expect(i).toMatchObject({ acked: true, blocksClose: false });
    expect([...(await changedSinceAck(db, tenantId, DEMO_MONTH, issues))]).toEqual([`deduction_no_agreement\u0000${uniform}`]);
    // 黄の確認済み（ロイヤリティの合意の日）は、取り込みで額が動いても知らせない
    const royalty = await ruleId(db, tenantId, "ロイヤリティ");
    await ackWatchIssue(db, tenantId, { month: DEMO_MONTH, code: "deduction_no_agreement", subjectId: royalty, note: "契約書 第8条で合意" }, null, { today: TODAY });
    await db.update(s.deductionRules).set({ rate: 0.08 }).where(eq(s.deductionRules.id, royalty));
    issues = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
    expect(find(issues, "deduction_no_agreement", royalty)[0].acked).toBe(true);
    expect([...(await changedSinceAck(db, tenantId, DEMO_MONTH, issues))]).toEqual([`deduction_no_agreement\u0000${uniform}`]);
    // 他社の同じ月の記録は混ざらない
    const other = await runWatch(db, otherId, DEMO_MONTH, { today: TODAY });
    expect(await changedSinceAck(db, otherId, DEMO_MONTH, other)).toHaveProperty("size", 0);

    // 確かめ直してメモを書き直す → 知らせは消える
    await ackWatchIssue(db, tenantId, { ...key, note: "50,000円に変えた申込書（本人の署名つき）を確認" }, null, { today: TODAY });
    issues = await runWatch(db, tenantId, DEMO_MONTH, { today: TODAY });
    expect(await changedSinceAck(db, tenantId, DEMO_MONTH, issues)).toHaveProperty("size", 0);
    await client.close();
  });
});
