import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  confirmationRecordRows,
  getStatementDetail,
  getStatementRow,
  listMonthStatements,
  markQuestionsRead,
  markStatementSent,
  monthPdfSources,
  recreateStatementLink,
  replyToDriver,
  resolveThread,
  statementPdfSource,
  staffLinkToken,
} from "~/server/features/statements";
import { askFromPortal, findStatementByToken } from "~/server/features/portal";
import { summaryRows, toDriverView, PURCHASE_TITLE, PLAIN_TITLE } from "~/server/features/statements/view";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, readSnapshot } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

const DAY = 86_400_000;
const pause = () => new Promise((r) => setTimeout(r, 5));

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

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("明細の一覧", () => {
  it("8 人の明細・合計・状態の件数（デモの数字）", async () => {
    const list = await listMonthStatements(db, tenantId, DEMO_MONTH);
    expect(list.items).toHaveLength(8);
    expect(list.totals).toEqual({ subtotal: 2_410_600, tax: 241_060, deductions: 437_866, adjustments: -7_700, withholding: 0, total: 2_206_094 });
    expect(list.counts).toMatchObject({ all: 8, unsent: 8, confirmed: 0 });
    expect(list.deemedDays).toBe(7);
    // 1 人ずつ：委託料＋消費税−控除＋調整−源泉＝振込額
    for (const i of list.items) expect(i.subtotal + i.tax - i.deductions + i.adjustments - i.withholding).toBe(i.total);
    const aoki = list.items.find((i) => i.code === "D01")!;
    expect(aoki).toMatchObject({ name: "青木 翔太", subtotal: 374_500, tax: 37_450, deductions: 57_695, adjustments: 3_300, total: 357_555, version: 1 });
    expect(list.items.map((i) => i.code)).toEqual(["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08"]);
  });
});

describe("ドライバーに見せる形", () => {
  it("登録ありは仕入明細書の形・会社の売上や受注の単価は入らない・足し引きが振込額に合う", async () => {
    const { st } = await statementOf("D01");
    const v = toDriverView(readSnapshot(st), st);
    expect(v.title).toBe(PURCHASE_TITLE);
    expect(v.driver.registrationNo).toBe("T9876543210987");
    expect(v.company).toEqual({ name: "サンプル運送株式会社（架空）", registrationNo: "T1234567890123" });
    expect(v.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(v.payDate).toBe("2026-11-25");
    expect(v.lines.map((l) => [l.project, l.qty, l.rate, l.amount])).toEqual([
      ["スポット便", 4, 7000, 28000],
      ["宅配（個建て）", 2310, 150, 346500],
    ]);
    expect(v.taxLabel).toBe("消費税");
    expect(v.version).toBe(1);
    expect(v.hashShort).toBe(st.hash.slice(0, 12));
    const json = JSON.stringify(v);
    for (const word of ["sales", "billRate", "invoiceBurden", "deductibleRate", "474900", "22000"]) expect(json).not.toContain(word);
    const rows = summaryRows(v);
    expect(rows.map((r) => [r.key, r.amount])).toEqual([
      ["subtotal", 374_500],
      ["tax", 37_450],
      ["deductions", -52_450],
      ["deductionTax", -5_245],
      ["adjustments", 3_300],
    ]);
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(357_555);
  });

  it("登録なしは「支払明細書」「消費税相当額」。調整は adj:<番号>", async () => {
    const { st } = await statementOf("D03");
    const v = toDriverView(readSnapshot(st), st);
    expect(v.title).toBe(PLAIN_TITLE);
    expect(v.taxLabel).toBe("消費税相当額");
    expect(v.driver.registrationNo).toBeNull();
    expect(v.adjustments).toEqual([{ key: "adj:0", label: "車両修理の負担分", amount: -11_000, taxable: false, agreedInWriting: true }]);
    expect(summaryRows(v).reduce((n, r) => n + r.amount, 0)).toBe(245_740);
  });

  it("源泉徴収のある人は、区分と式を載せ、足し引きが振込額に合う", async () => {
    const { driver } = await statementOf("D02");
    await db.update(s.drivers).set({ withholdingCategory: "ko1" }).where(eq(s.drivers.id, driver.id));
    await generateStatements(db, tenantId, DEMO_MONTH);
    const { st } = await statementOf("D02");
    const v = toDriverView(readSnapshot(st), st);
    expect(v.withholding?.label).toBe("源泉徴収（1号）");
    expect(v.withholding?.amount).toBe(st.withholding);
    expect(v.withholding!.amount).toBeGreaterThan(0);
    expect(v.withholding?.formula).toContain("378,000円");
    const rows = summaryRows(v);
    expect(rows.at(-1)).toMatchObject({ key: "withholding", amount: -st.withholding });
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(st.total);
    expect(st.total).toBe(357_720 - st.withholding);
  });

  it("全員分：足し引きの行の合計が振込額と 1 円まで同じ（画面と PDF は同じ行を使う）", async () => {
    const sources = await monthPdfSources(db, tenantId, DEMO_MONTH);
    expect(sources).toHaveLength(8);
    for (const src of sources) expect(summaryRows(src.view).reduce((n, r) => n + r.amount, 0)).toBe(src.view.total);
    const kimura = sources.find((x) => x.view.driver.code === "D07")!;
    expect(kimura.account).toBeNull(); // 口座の無い人
    expect(kimura.view.deductions.find((d) => d.name === "制服代")?.agreedInWriting).toBe(false);
    const aoki = sources.find((x) => x.view.driver.code === "D01")!;
    expect(aoki.account).toEqual({ bank: "ﾐｽﾞﾎ", branch: "ｻﾝﾌﾟﾙ", type: "普通", last3: "567" });
    expect(aoki.confirmationText).toBe("ドライバーの確認：記録はまだありません");
  });
});

describe("送った記録", () => {
  it("最初の日時を残す。送ったあとで中身が変わったら、送り直しの印 → 送り直すと日時が今になる", async () => {
    const { driver, st } = await statementOf("D01");
    const first = new Date();
    await markStatementSent(db, tenantId, st.id, null, "line", first);
    await markStatementSent(db, tenantId, st.id, null, "copy", new Date(first.getTime() + 60_000));
    expect((await getStatementRow(db, tenantId, st.id))!.sentAt!.getTime()).toBe(first.getTime());
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.send")));
    expect(logs.map((l) => l.detail.channel)).toEqual(["line", "copy"]);

    await pause();
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "高速代の立替", amount: 1200, agreedInWriting: true });
    await generateStatements(db, tenantId, DEMO_MONTH);
    let item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item).toMatchObject({ version: 2, total: 358_755 });
    expect(item.status).toMatchObject({ key: "sent", needsResend: true });

    const again = new Date();
    await markStatementSent(db, tenantId, st.id, null, "sms", again);
    item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item.status.needsResend).toBe(false);
    // 送ってから 7 日、連絡が無くても、取引条件にみなし確認の条項が無ければ未確認のまま
    const at7 = new Date(again.getTime() + 7 * DAY);
    let later = (await listMonthStatements(db, tenantId, DEMO_MONTH, at7)).items.find((i) => i.id === st.id)!;
    expect(later.status).toMatchObject({ key: "sent", deemedBlockedByClause: true });
    // 条項の入った取引条件の記録があれば「みなし確認」
    await db.insert(s.termsRecords).values({ tenantId, driverId: driver.id, version: 1, issuedOn: "2026-09-01", content: {}, deemedClause: true });
    later = (await listMonthStatements(db, tenantId, DEMO_MONTH, at7)).items.find((i) => i.id === st.id)!;
    expect(later.status).toMatchObject({ key: "deemed", label: "みなし確認（7日経過）", deemedBlockedByClause: false });
    // 新しい版の取引条件で条項を外すと、また未確認に戻る（いちばん新しい記録を見る）
    await db.insert(s.termsRecords).values({ tenantId, driverId: driver.id, version: 2, issuedOn: "2026-10-01", content: {}, deemedClause: false });
    later = (await listMonthStatements(db, tenantId, DEMO_MONTH, at7)).items.find((i) => i.id === st.id)!;
    expect(later.status.key).toBe("sent");
  });

  it("みなし確認までの日数は会社の設定から", async () => {
    await db.update(s.tenants).set({ settings: { deemedConfirmDays: 3 } }).where(eq(s.tenants.id, tenantId));
    const { st, driver } = await statementOf("D02");
    await db.insert(s.termsRecords).values({ tenantId, driverId: driver.id, version: 1, issuedOn: "2026-09-01", content: {}, deemedClause: true });
    const sent = new Date();
    await markStatementSent(db, tenantId, st.id, null, "mail", sent);
    const list = await listMonthStatements(db, tenantId, DEMO_MONTH, new Date(sent.getTime() + 3 * DAY));
    expect(list.deemedDays).toBe(3);
    expect(list.counts.deemed).toBe(1);
  });
});

describe("リンクの作り直し", () => {
  it("古いリンクは使えなくなり、送った・開いた記録は外れる", async () => {
    const { st } = await statementOf("D01");
    const old = staffLinkToken(st).token;
    expect((await findStatementByToken(db, old))?.id).toBe(st.id);
    await markStatementSent(db, tenantId, st.id, null, "copy");
    await db.update(s.statements).set({ viewedAt: new Date() }).where(eq(s.statements.id, st.id));

    await recreateStatementLink(db, tenantId, st.id, null);
    const now = (await getStatementRow(db, tenantId, st.id))!;
    expect(now.linkNonce).not.toBe(st.linkNonce);
    expect(now.sentAt).toBeNull();
    expect(now.viewedAt).toBeNull();
    expect(await findStatementByToken(db, old)).toBeNull();
    expect((await findStatementByToken(db, staffLinkToken(now).token))?.id).toBe(st.id);
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.relink")));
    expect(log.entityId).toBe(st.id);
  });
});

describe("質問への返事と解決", () => {
  it("行ごとにまとまり、返事・既読・解決ができる", async () => {
    const { st } = await statementOf("D01");
    const token = staffLinkToken(st).token;
    const ctx = { ipHash: "ip-1", userAgent: "Mozilla/5.0 (iPhone)" };
    const v = toDriverView(readSnapshot(st), st);
    const takuhai = v.lines.find((l) => l.project === "宅配（個建て）")!.key;
    await askFromPortal(db, token, { lineKey: takuhai, body: "個数は 2,350 個だと思います" }, ctx);
    await askFromPortal(db, token, { lineKey: "adj:0", body: "駐車場代はいくらでしたか" }, ctx);

    let detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.status).toMatchObject({ openQuestions: 2, unread: 2 });
    expect(detail.threads.map((t) => t.label).sort()).toEqual(["宅配（個建て）", "駐車場代の立替"].sort());
    expect((await listMonthStatements(db, tenantId, DEMO_MONTH)).counts.question).toBe(1);

    expect(await markQuestionsRead(db, tenantId, st.id)).toBe(2);
    await replyToDriver(db, tenantId, st.id, null, { lineKey: takuhai, body: "元請の記録では 2,310 個でした。日ごとの表をお送りします" });
    await expect(replyToDriver(db, tenantId, st.id, null, { lineKey: "nope", body: "x" })).rejects.toThrow("どの行への返事か");
    await expect(replyToDriver(db, tenantId, st.id, null, { lineKey: null, body: "  " })).rejects.toThrow("1〜1,000 文字");
    await expect(replyToDriver(db, tenantId, st.id, null, { lineKey: null, body: "あ".repeat(1001) })).rejects.toThrow("1〜1,000 文字");

    const r = await resolveThread(db, tenantId, st.id, null, takuhai, true);
    expect(r.count).toBe(1);
    detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.status).toMatchObject({ openQuestions: 1, unread: 0 });
    const th = detail.threads.find((t) => t.lineKey === takuhai)!;
    expect(th.open).toBe(0);
    expect(th.messages.map((m) => m.author)).toEqual(["driver", "staff"]);
    // 未解決に戻せる
    await resolveThread(db, tenantId, st.id, null, takuhai, false);
    expect((await getStatementDetail(db, tenantId, st.id))!.status.openQuestions).toBe(2);
    // 全体の話（lineKey なし）は別の話
    await resolveThread(db, tenantId, st.id, null, null, true);
    expect((await getStatementDetail(db, tenantId, st.id))!.status.openQuestions).toBe(2);
  });
});

describe("締めた月", () => {
  it("中身は作り直せないが、送る・リンクの作り直し・返事はできる", async () => {
    const { st } = await statementOf("D02");
    await db.insert(s.monthCloses).values({ tenantId, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    await expect(generateStatements(db, tenantId, DEMO_MONTH)).rejects.toThrow("締め済み");
    await markStatementSent(db, tenantId, st.id, null, "line");
    await recreateStatementLink(db, tenantId, st.id, null);
    await markStatementSent(db, tenantId, st.id, null, "copy");
    await replyToDriver(db, tenantId, st.id, null, { lineKey: null, body: "今月の明細です" });
    const row = (await getStatementRow(db, tenantId, st.id))!;
    expect(row.sentAt).not.toBeNull();
    expect(row.total).toBe(357_720);
  });
});

describe("会社をまたがない", () => {
  it("B 社の明細は、A 社の関数からは読めない・変えられない", async () => {
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const { st: bSt } = await statementOf("D01", b.tenantId);

    expect(await getStatementRow(db, tenantId, bSt.id)).toBeNull();
    expect(await getStatementDetail(db, tenantId, bSt.id)).toBeNull();
    expect(await statementPdfSource(db, tenantId, bSt.id)).toBeNull();
    await expect(markStatementSent(db, tenantId, bSt.id, null, "copy")).rejects.toThrow("見つかりません");
    await expect(recreateStatementLink(db, tenantId, bSt.id, null)).rejects.toThrow("見つかりません");
    await expect(replyToDriver(db, tenantId, bSt.id, null, { lineKey: null, body: "x" })).rejects.toThrow("見つかりません");
    await expect(resolveThread(db, tenantId, bSt.id, null, null, true)).rejects.toThrow("見つかりません");
    expect(await markQuestionsRead(db, tenantId, bSt.id)).toBe(0);
    expect(await getStatementRow(db, tenantId, "not-a-uuid")).toBeNull();

    const aIds = new Set((await db.select({ id: s.statements.id }).from(s.statements).where(eq(s.statements.tenantId, tenantId))).map((r) => r.id));
    const list = await listMonthStatements(db, tenantId, DEMO_MONTH);
    expect(list.items).toHaveLength(8);
    expect(list.items.every((i) => aIds.has(i.id))).toBe(true);
    const pdf = await monthPdfSources(db, tenantId, DEMO_MONTH);
    expect(pdf).toHaveLength(8);
    const aHashes = new Set((await db.select({ h: s.statements.hash }).from(s.statements).where(eq(s.statements.tenantId, tenantId))).map((r) => r.h));
    const csv = await confirmationRecordRows(db, tenantId, DEMO_MONTH);
    expect(csv).toHaveLength(9);
    expect(csv.slice(1).every((r) => aHashes.has(String(r[4])))).toBe(true);

    // B 社の明細は変わっていない
    const bRow = (await getStatementRow(db, b.tenantId, bSt.id))!;
    expect(bRow.sentAt).toBeNull();
    expect(bRow.linkNonce).toBe(bSt.linkNonce);
  });
});

describe("確認の記録（CSV）", () => {
  it("確認 1 回ごとに 1 行、確認の無い明細も 1 行", async () => {
    const { st } = await statementOf("D01");
    await db.insert(s.statementConfirmations).values({ tenantId, statementId: st.id, totalAtConfirm: st.total, version: 1, hash: st.hash, ipHash: "abcdef0123456789", userAgent: "Mozilla/5.0 (iPhone)" });
    const rows = await confirmationRecordRows(db, tenantId, DEMO_MONTH);
    expect(rows[0]).toContain("確認時の振込額");
    expect(rows).toHaveLength(9);
    const aoki = rows.find((r) => r[2] === "青木 翔太")!;
    expect(aoki.slice(0, 7)).toEqual(["2026-10", "D01", "青木 翔太", 1, st.hash, 357_555, "確認済み"]);
    expect(aoki.slice(10)).toEqual([1, st.hash, 357_555, "abcdef01", "iPhone"]);
  });
});
