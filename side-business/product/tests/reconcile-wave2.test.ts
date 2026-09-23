/**
 * 突合の続き：扱いの流れ（問い合わせた日・返事待ち・取り戻せた額）・見つけたお金・元請の締め日・取引をやめた元請・問い合わせ文の PDF。
 * DB はメモリ（PGlite）。デモの会社（架空）で確かめる。
 */
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  foundMoney,
  importNotice,
  listMonth,
  listWaiting,
  loadLetterSource,
  loadNoticeView,
  loadReport,
  markItemsAsked,
  runReconcile,
  setItemStatus,
} from "~/server/features/reconcile";
import { letterDocument, pickLetterItems } from "~/server/features/reconcile/letter";
import { periodNotes } from "~/server/features/reconcile/period";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { letterPdfFileName, renderLetterPdf } from "~/server/pdf/reconcile-pdf";
import { createTestDb } from "./helpers/db";

const csv = (text: string) => new TextEncoder().encode(text);
const DAY = 86400000;

async function setup() {
  const { db, client } = await createTestDb();
  const { tenantId } = await seedDemo(db);
  const clients = await db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId));
  const a = clients.find((c) => c.name.startsWith("A物流"))!;
  const b = clients.find((c) => c.name.startsWith("B商事"))!;
  const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
  const P = Object.fromEntries(projects.map((p) => [p.name, p]));
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  const D = Object.fromEntries(drivers.map((d) => [d.code!, d]));
  const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
  const [owner] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  return { db, client, tenantId, a, b, P, D, noticeId: notice.id, userId: owner.id };
}

async function items(db: Db, tenantId: string, noticeId: string) {
  const rows = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
  return rows.sort((x, y) => x.label.localeCompare(y.label, "ja") || x.kind.localeCompare(y.kind));
}

describe("扱いの流れ：問い合わせた日・返事待ち・解決の条件", () => {
  it("「解決」は取り戻せた額（差と違ってよい）か説明のメモが必須。了承は理由が必須。日付が残る", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const rows = await items(db, tenantId, noticeId);
    const takuhai = rows.find((r) => r.label === "宅配（個建て）")!;
    const yakan = rows.find((r) => r.label === "夜間便")!;
    expect([takuhai.diff, yakan.diff]).toEqual([-81700, -10000]);
    // 見つけた日（保存した日時）が残る
    expect(takuhai.createdAt).toBeInstanceOf(Date);

    const before = Date.now();
    expect(await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: [takuhai.id, yakan.id] })).toBe(2);
    const asked = (await items(db, tenantId, noticeId)).find((r) => r.id === takuhai.id)!;
    expect(asked.status).toBe("asked");
    expect(asked.askedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // 額もメモも無い「解決」は断る（空白だけのメモも）
    await expect(setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "resolved", note: null })).rejects.toThrow("取り戻せた額");
    await expect(setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "resolved", note: "  ", recoveredAmount: null })).rejects.toThrow("メモ");
    await expect(setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "resolved", note: null, recoveredAmount: 1.5 })).rejects.toThrow("0 以上");
    await expect(setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "accepted", note: null })).rejects.toThrow("理由");

    // 取り戻せた額だけ（差の 81,700円 と違う 60,000円 でもよい）
    await setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "resolved", note: null, recoveredAmount: 60000 });
    // メモだけ（自社の記録を直した）
    await setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "resolved", note: "自社の記録を直した（夜間便の単価は 11,500円 が正しかった）", recoveredAmount: null });
    const after = await items(db, tenantId, noticeId);
    const t = after.find((r) => r.id === takuhai.id)!;
    expect(t).toMatchObject({ status: "resolved", recoveredAmount: 60000, note: null });
    expect(t.resolvedAt).toBeInstanceOf(Date);
    expect(t.askedAt?.getTime()).toBe(asked.askedAt?.getTime());
    expect(after.find((r) => r.id === yakan.id)).toMatchObject({ status: "resolved", recoveredAmount: null });

    // 画面の差にも日付が載る（見つけた・問い合わせた・片付けた）
    const view = await loadNoticeView(db, tenantId, noticeId);
    const v = view.display.find((i) => i.id === takuhai.id)!;
    expect(v.createdAt).toBeInstanceOf(Date);
    expect(v.askedAt).toBeInstanceOf(Date);
    expect(v.resolvedAt).toBeInstanceOf(Date);
    expect(view.totals).toMatchObject({ short: 0, recovered: 60000, recoveredCount: 1 });
    await client.close();
  });

  it("前からある行（日付・取り戻せた額の無い「解決」「問い合わせ済み」）もそのまま読める", async () => {
    const { db, client, tenantId, noticeId, userId, P } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    // 日付の列を入れる前に保存した形：解決（額・日付なし）と問い合わせ済み（日付なし）
    await db
      .update(s.reconciliationItems)
      .set({ status: "resolved", askedAt: null, resolvedAt: null, recoveredAmount: null, note: null })
      .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.projectId, P["夜間便"].id)));
    await db
      .update(s.reconciliationItems)
      .set({ status: "asked", askedAt: null })
      .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.projectId, P["宅配（個建て）"].id)));
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.display.map((i) => [i.label, i.status, i.askedAt, i.resolvedAt, i.recoveredAmount])).toEqual([
      ["宅配（個建て）", "asked", null, null, null],
      ["夜間便", "resolved", null, null, null],
    ]);
    expect(view.totals).toMatchObject({ short: 81700, shortCount: 1, settledCount: 1, recovered: 0 });
    const found = await foundMoney(db, tenantId, DEMO_MONTH);
    expect(found).toMatchObject({ confirmed: 0, estimated: 81700, estimatedCount: 1, waitingLong: 0 });
    // 返事待ちの一覧：日付の無い差は日数を出さずに並べる
    expect((await listWaiting(db, tenantId)).map((w) => [w.label, w.days])).toEqual([["宅配（個建て）", null]]);
    await client.close();
  });

  it("返事待ち：長く待っている順。14 日を過ぎた差を数える（ほかの会社の差は混ざらない）", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    const other = await seedDemo(db);
    const [otherNotice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, other.tenantId));
    await runReconcile(db, other.tenantId, otherNotice.id, null);
    const otherItems = await items(db, other.tenantId, otherNotice.id);
    await markItemsAsked(db, other.tenantId, null, { noticeId: otherNotice.id, itemIds: otherItems.map((i) => i.id) });

    await runReconcile(db, tenantId, noticeId, userId);
    const rows = await items(db, tenantId, noticeId);
    await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: rows.map((r) => r.id) });
    const now = new Date("2026-11-30T09:00:00+09:00");
    const takuhai = rows.find((r) => r.label === "宅配（個建て）")!;
    const yakan = rows.find((r) => r.label === "夜間便")!;
    await db.update(s.reconciliationItems).set({ askedAt: new Date(now.getTime() - 20 * DAY) }).where(eq(s.reconciliationItems.id, takuhai.id));
    await db.update(s.reconciliationItems).set({ askedAt: new Date(now.getTime() - 3 * DAY) }).where(eq(s.reconciliationItems.id, yakan.id));

    const waiting = await listWaiting(db, tenantId, now);
    expect(waiting.map((w) => [w.label, w.days, w.clientName, w.month, w.diff])).toEqual([
      ["宅配（個建て）", 20, "A物流（架空）", DEMO_MONTH, -81700],
      ["夜間便", 3, "A物流（架空）", DEMO_MONTH, -10000],
    ]);
    const found = await foundMoney(db, tenantId, DEMO_MONTH, now);
    expect(found.waitingLong).toBe(1);
    const month = await listMonth(db, tenantId, DEMO_MONTH, now);
    expect(month.rows.find((r) => r.clientName === "A物流（架空）")!.notice).toMatchObject({ askedCount: 2, waitingLong: 1 });
    // ほかの会社の返事待ちは、自分の会社の一覧に入らない（逆も同じ）
    expect(waiting.every((w) => rows.some((r) => r.id === w.itemId))).toBe(true);
    expect((await listWaiting(db, other.tenantId, now)).every((w) => otherItems.some((r) => r.id === w.itemId))).toBe(true);
    await client.close();
  });
});

describe("見つけたお金（確定と見込みを分けて、足さない）", () => {
  it("見込み＝未解決の受け取りが少ない可能性の合計、確定＝取り戻せた額の合計。多い可能性は見込みに入れない", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    let found = await foundMoney(db, tenantId, DEMO_MONTH);
    expect(found).toMatchObject({ from: DEMO_MONTH, to: DEMO_MONTH, confirmed: 0, confirmedCount: 0, estimated: 91700, estimatedCount: 2, notices: 1 });
    // 待機料（＋3,000円）のある見本に入れ替えても、見込みは受け取りが少ない可能性だけ
    const fixedWithCharge = csv("品目,数量,単価,金額\n宅配,4520,190,858800\n企業配,61,22000,1342000\n夜間便,20,11500,230000\n待機料,3,1000,3000\n");
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "見本.csv", bytes: fixedWithCharge, replace: true });
    found = await foundMoney(db, tenantId, "2026-10");
    expect(found).toMatchObject({ confirmed: 0, estimated: 91700, estimatedCount: 2 });

    // 宅配を問い合わせ → 11 月分に上乗せで 81,700円（確定）。夜間便はまだ（見込み 10,000円）
    const rows = await items(db, tenantId, noticeId);
    const takuhai = rows.find((r) => r.label === "宅配（個建て）")!;
    await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: [takuhai.id] });
    await setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "resolved", note: "11月分に上乗せ", recoveredAmount: 81700 });
    found = await foundMoney(db, tenantId, DEMO_MONTH);
    expect(found).toMatchObject({ confirmed: 81700, confirmedCount: 1, estimated: 10000, estimatedCount: 1 });
    // 足し合わせた数（91,700円）は作らない
    expect(Object.keys(found).sort()).toEqual(["byMonth", "confirmed", "confirmedCount", "estimated", "estimatedCount", "from", "notices", "to", "waitingLong"]);
    // 一覧の画面・レポートと同じ数
    const month = await listMonth(db, tenantId, DEMO_MONTH);
    expect(month.found).toEqual(found);
    const report = await loadReport(db, tenantId, DEMO_MONTH, DEMO_MONTH);
    expect(report.totals).toMatchObject({ short: found.estimated, recovered: found.confirmed });

    // 期間（3 か月）：月ごとの内訳。9 月（通知なし）は 0
    const range = await foundMoney(db, tenantId, { from: "2026-08", to: "2026-10" });
    expect(range.from).toBe("2026-08-01");
    expect(range.byMonth).toEqual([
      { month: "2026-08-01", confirmed: 0, estimated: 0 },
      { month: "2026-09-01", confirmed: 0, estimated: 0 },
      { month: DEMO_MONTH, confirmed: 81700, estimated: 10000 },
    ]);
    await expect(foundMoney(db, tenantId, "2026-13")).rejects.toThrow("月の形");
    await client.close();
  });

  it("ほかの会社の見つけたお金は混ざらない", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    const other = await seedDemo(db);
    await runReconcile(db, tenantId, noticeId, userId);
    const rows = await items(db, tenantId, noticeId);
    await setItemStatus(db, tenantId, userId, { itemId: rows[0].id, status: "resolved", note: null, recoveredAmount: 81700 });
    expect(await foundMoney(db, tenantId, DEMO_MONTH)).toMatchObject({ confirmed: 81700, estimated: 10000 });
    expect(await foundMoney(db, other.tenantId, DEMO_MONTH)).toMatchObject({ confirmed: 0, estimated: 91700, notices: 1 });
    await client.close();
  });
});

describe("元請の締め日（B商事は 20 日締め）", () => {
  /** B商事の稼働を日付つきに入れ替える（10 月は開いている月。11 月も入れる） */
  async function datedB(db: Db, tenantId: string, P: Record<string, typeof s.projects.$inferSelect>, D: Record<string, typeof s.drivers.$inferSelect>) {
    const bProjects = [P["スポット便"].id, P["ルート配送（時給）"].id];
    await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), inArray(s.workEntries.projectId, bProjects)));
    const row = (month: string, date: string, driver: string, project: string, qty: number) => ({ tenantId, month, workDate: date, driverId: D[driver].id, projectId: P[project].id, qty });
    await db.insert(s.workEntries).values([
      row(DEMO_MONTH, "2026-10-05", "D04", "ルート配送（時給）", 8), // 11 月分の期間（10/21〜11/20）の外
      row(DEMO_MONTH, "2026-10-22", "D04", "ルート配送（時給）", 8),
      row(DEMO_MONTH, "2026-10-25", "D01", "スポット便", 1),
      row("2026-11-01", "2026-11-10", "D01", "スポット便", 2),
      row("2026-11-01", "2026-11-18", "D04", "ルート配送（時給）", 8),
      row("2026-11-01", "2026-11-25", "D01", "スポット便", 3), // 12 月分
    ]);
  }

  it("稼働に日付があれば、元請の締めの期間（10/21〜11/20）の稼働で比べる", async () => {
    const { db, client, tenantId, b, P, D, userId } = await setup();
    await datedB(db, tenantId, P, D);
    // B商事の 11 月分：スポット便 3 件 × 9,000円、ルート配送 16 時間 × 2,600円（期間で数えるとぴったり）
    const res = await importNotice(db, tenantId, userId, {
      clientId: b.id,
      month: "2026-11-01",
      fileName: "B商事_11月.csv",
      bytes: csv("日付,品目,数量,単価,金額\n10/25,スポット,1,9000,9000\n11/10,スポット,2,9000,18000\n10/22,ルート,8,2600,20800\n11/18,ルート,8,2600,20800\n"),
      replace: false,
    });
    // 通知の日付は締めの期間の中なので「外の日付」の注意は出ない
    expect(res.warnings).toEqual([]);
    expect(res.run).toMatchObject({ items: 0 });
    const view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.period).toMatchObject({ mode: "closing", from: "2026-10-21", to: "2026-11-20", closingDay: 20, differs: true, fallback: false, emptyMonths: [] });
    expect(view.live.ourTotal).toBe(27000 + 41600);
    expect(view.live.theirTotal).toBe(27000 + 41600);
    expect(view.display).toEqual([]);
    expect(periodNotes(view.period, "B商事（架空）").map((n) => n.title)).toEqual(["B商事（架空）の締めの期間（2026年10月21日〜2026年11月20日）で比べています"]);

    // 暦の月（11 月）で比べていたら、スポット便 5 件・ルート配送 8 時間 になり、偽の差が出ていた
    const report = await loadReport(db, tenantId, DEMO_MONTH, "2026-12-01");
    const nov = report.cells.find((c) => c.clientName === "B商事（架空）" && c.month === "2026-11-01")!;
    expect(nov).toMatchObject({ ourTotal: 68600, short: 0, over: 0 });
    expect(nov.period).toMatchObject({ mode: "closing", from: "2026-10-21", to: "2026-11-20" });
    // 12 月分（通知なし）：11/21〜12/20 の稼働（11/25 のスポット便 3 件）
    const dec = report.cells.find((c) => c.clientName === "B商事（架空）" && c.month === "2026-12-01")!;
    expect(dec).toMatchObject({ notice: null, ourTotal: 27000 });
    // 10 月分：期間（9/21〜10/20）にかかる 9 月の稼働に日付が無いので、月単位で比べる
    const oct = report.cells.find((c) => c.clientName === "B商事（架空）" && c.month === DEMO_MONTH)!;
    expect(oct.period).toMatchObject({ mode: "month", fallback: true, from: "2026-10-01", to: "2026-10-31" });
    // A物流（月末締め）は今までどおり暦の月
    expect(report.cells.find((c) => c.clientName === "A物流（架空）" && c.month === DEMO_MONTH)!.period).toMatchObject({ mode: "month", differs: false, fallback: false });

    // 数量が違う通知なら、期間の数量で差を出す（スポット便 4 件 → ＋9,000円）
    const more = await importNotice(db, tenantId, userId, {
      clientId: b.id,
      month: "2026-11-01",
      fileName: "B商事_11月_2.csv",
      bytes: csv("品目,数量,単価,金額\nスポット,4,9000,36000\nルート,16,2600,41600\n"),
      replace: true,
    });
    expect(more.run).toMatchObject({ items: 1 });
    const it = (await items(db, tenantId, more.noticeId))[0];
    expect(it).toMatchObject({ kind: "qty", label: "スポット便", ourQty: 3, theirQty: 4, diff: 9000 });

    // 問い合わせ文には締めの期間を書く
    const src = await loadLetterSource(db, tenantId, more.noticeId);
    expect(src.period).toEqual({ from: "2026-10-21", to: "2026-11-20" });
    const doc = letterDocument({ clientName: src.clientName, contactName: "", companyName: src.view.tenantName, senderName: "", month: "2026-11-01", items: src.items, offerRecords: false, period: src.period });
    expect(doc.body).toContain("2026年11月分（2026年10月21日〜2026年11月20日）のお支払通知書をお送りいただき");
    expect(doc.targetText).toBe("2026年11月分（2026年10月21日〜2026年11月20日）");
    await client.close();
  });

  it("日付の無い稼働があれば、月単位で比べ「締め日が違うため月単位で比べています」と知らせる", async () => {
    const { db, client, tenantId, b, P, D, userId } = await setup();
    await datedB(db, tenantId, P, D);
    // 11 月に日付の無い稼働（月の合計だけ）が 1 行ある
    await db.insert(s.workEntries).values({ tenantId, month: "2026-11-01", driverId: D.D04.id, projectId: P["ルート配送（時給）"].id, qty: 4 });
    const res = await importNotice(db, tenantId, userId, {
      clientId: b.id,
      month: "2026-11-01",
      fileName: "B商事_11月.csv",
      bytes: csv("品目,数量,単価,金額\nスポット,3,9000,27000\nルート,16,2600,41600\n"),
      replace: false,
    });
    const view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.period).toMatchObject({ mode: "month", fallback: true, undatedCount: 1, from: "2026-11-01", to: "2026-11-30", clientPeriod: { from: "2026-10-21", to: "2026-11-20" } });
    // 当社の月（11 月）：スポット便 2 ＋ 3 ＝ 5 件、ルート配送 8 ＋ 4 ＝ 12 時間
    expect(view.live.ourTotal).toBe(45000 + 31200);
    const notes = periodNotes(view.period, "B商事（架空）");
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("締め日が違うため月単位で比べています");
    expect(notes[0].body).toContain("日付の無いものがある（1件）");
    // 月単位で比べたときは、問い合わせ文に期間を書かない（当社の数字は 11 月の分なので）
    expect((await loadLetterSource(db, tenantId, res.noticeId)).period).toBeNull();
    const list = await listMonth(db, tenantId, "2026-11-01");
    expect(list.rows.find((r) => r.clientName === "B商事（架空）")!.period).toMatchObject({ mode: "month", fallback: true });
    await client.close();
  });

  it("お支払通知の日付が締めの期間の外なら知らせる。入金までの日数は締めの日から数える", async () => {
    const { db, client, tenantId, b, userId } = await setup();
    const res = await importNotice(db, tenantId, userId, {
      clientId: b.id,
      month: "2026-11-01",
      fileName: "B商事_11月.csv",
      bytes: csv("日付,品目,数量,単価,金額\n10/25,スポット,1,9000,9000\n11/25,スポット,1,9000,9000\n"),
      replace: false,
    });
    expect(res.warnings).toEqual(["締めの期間（2026年10月21日〜2026年11月20日）の外の日付の行が 1 行あります。別の月の分が入っていないか確かめてください。"]);
    // 11/20 締め → 1/20 は 61 日後
    await db.update(s.paymentNotices).set({ paidOn: "2027-01-20" }).where(eq(s.paymentNotices.id, res.noticeId));
    const view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.facts.map((f) => f.title)).toEqual(["入金日が締めの日から60日を超えています"]);
    expect(view.facts[0].detail).toContain("元請の締めの日（2026年11月20日）から 61日後");
    await client.close();
  });
});

describe("取引をやめた元請", () => {
  it("お支払通知は上げられないが、これまでの通知は見られる。稼働も通知も無い月は並べない", async () => {
    const { db, client, tenantId, a, b, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    await db.update(s.clients).set({ active: false }).where(and(eq(s.clients.tenantId, tenantId), inArray(s.clients.id, [a.id, b.id])));
    await db.insert(s.clients).values([
      { tenantId, name: "C運輸（架空）", active: false },
      { tenantId, name: "D急便（架空）", active: true },
    ]);
    await expect(
      importNotice(db, tenantId, userId, { clientId: b.id, month: DEMO_MONTH, fileName: "b.csv", bytes: csv("品目,数量,単価,金額\nスポット,4,9000,36000\n"), replace: false }),
    ).rejects.toThrow("取引をやめた元請");

    const month = await listMonth(db, tenantId, DEMO_MONTH);
    expect(month.clients.map((c) => [c.name, c.active])).toEqual([
      ["A物流（架空）", false],
      ["B商事（架空）", false],
      ["C運輸（架空）", false],
      ["D急便（架空）", true],
    ]);
    // A物流（通知あり）・B商事（稼働あり）は並べる。C運輸（取引終了・何も無い）は並べない。D急便（取引中）は「未登録」として並べる
    expect(month.rows.map((r) => [r.clientName, r.clientActive, r.notice ? "通知" : "なし"])).toEqual([
      ["A物流（架空）", false, "通知"],
      ["B商事（架空）", false, "なし"],
      ["D急便（架空）", true, "なし"],
    ]);
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.totals.short).toBe(91700);
    await client.close();
  });
});

describe("問い合わせ文の PDF（画面と同じ文面 ＋ 差の一覧の表）", () => {
  it("選んだ差だけを表にし、合計を出す。A4 の PDF になる", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const src = await loadLetterSource(db, tenantId, noticeId);
    expect(src.items.map((i) => [i.label, i.diff, i.status])).toEqual([
      ["宅配（個建て）", -81700, "open"],
      ["夜間便", -10000, "open"],
    ]);
    // 何も選ばなければ、画面と同じく「未対応で少ない可能性」の差
    expect(pickLetterItems(src.items, []).map((i) => i.label)).toEqual(["宅配（個建て）", "夜間便"]);
    const only = pickLetterItems(src.items, [src.items[1].id]);
    expect(only.map((i) => i.label)).toEqual(["夜間便"]);
    // 「,」で区切って並べてもよい。知らない id は無視する
    expect(pickLetterItems(src.items, [`${src.items[0].id},00000000-0000-4000-8000-000000000000`]).map((i) => i.label)).toEqual(["宅配（個建て）"]);

    const input = { clientName: src.clientName, contactName: "経理部 ご担当者様", companyName: src.view.tenantName, senderName: "デモ 事務", month: DEMO_MONTH, items: src.items, offerRecords: true, period: src.period };
    const doc = letterDocument(input);
    expect(doc.subject).toBe("2026年10月分 お支払通知書の内容のご確認のお願い（サンプル運送株式会社（架空））");
    expect(doc.body).toContain("当社の記録では 宅配（個建て） 4,950個 × 190円 = 940,500円、お支払通知では 4,520個 = 858,800円（差 81,700円）");
    expect(doc.rows.map((r) => [r.no, r.title, r.ours, r.theirs, r.diffText])).toEqual([
      [1, "宅配（個建て）の数量", "4,950個 × 190円 = 940,500円", "4,520個 × 190円 = 858,800円", "−81,700円"],
      [2, "夜間便の単価", "20便 × 12,000円 = 240,000円", "20便 × 11,500円 = 230,000円", "−10,000円"],
    ]);
    expect([doc.total, doc.totalText, doc.targetText, doc.edited]).toEqual([-91700, "−91,700円", "2026年10月分", false]);
    // 画面で直した文面（CRLF で届く）ならそれを使う。直していなければ同じ文面
    expect(letterDocument(input, { body: doc.body.replace(/\n/g, "\r\n") }).edited).toBe(false);
    const edited = letterDocument(input, { body: `${doc.body}\r\n追伸：11/5 までにご返信いただけますと幸いです。` });
    expect(edited.edited).toBe(true);
    expect(edited.body.endsWith("追伸：11/5 までにご返信いただけますと幸いです。")).toBe(true);
    expect(edited.body).not.toContain("\r");

    const bytes = await renderLetterPdf(doc, new Date("2026-11-02T09:00:00+09:00"));
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.slice(0, 5)).toBe("%PDF-");
    expect(Math.max(...[...text.matchAll(/\/Count (\d+)/g)].map((x) => Number(x[1])))).toBe(1);
    expect(letterPdfFileName(doc)).toBe("問い合わせ_A物流（架空）_2026年10月分.pdf");
    expect(letterPdfFileName({ clientName: "A/B:物流", monthText: "2026年10月" })).toBe("問い合わせ_A_B_物流_2026年10月分.pdf");

    // 差がたくさんあっても、ページを分けて出せる
    const many = Array.from({ length: 40 }, (_, i) => ({ ...src.items[0], id: `x${i}`, label: `案件${i + 1}` }));
    const big = await renderLetterPdf(letterDocument({ ...input, items: many }));
    const bigText = Buffer.from(big).toString("latin1");
    expect(Math.max(...[...bigText.matchAll(/\/Count (\d+)/g)].map((x) => Number(x[1])))).toBeGreaterThan(1);

    // ほかの会社の通知の材料は読めない
    const other = await seedDemo(db);
    const [otherNotice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, other.tenantId));
    await expect(loadLetterSource(db, tenantId, otherNotice.id)).rejects.toThrow("見つかりません");
    await client.close();
  });

  it("文面と表に、責める言い方・法令の名前・決めつけが出ない", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    // 5 種類の差がそろうお支払通知（数量・単価・両方・無い・通知にだけある）
    await importNotice(db, tenantId, userId, {
      clientId: a.id,
      month: DEMO_MONTH,
      fileName: "いろいろ.csv",
      bytes: csv("品目,数量,単価,金額\n宅配,4520,185,836200\n夜間便,20,11500,230000\n待機料,3,1000,3000\n"),
      replace: true,
    });
    const src = await loadLetterSource(db, tenantId, noticeId);
    expect(new Set(src.items.map((i) => i.kind))).toEqual(new Set(["qty", "price", "missing", "extra"]));
    for (const edited of [null, "（直した文面）"]) {
      const doc = letterDocument(
        { clientName: src.clientName, contactName: "", companyName: src.view.tenantName, senderName: "デモ 事務", month: DEMO_MONTH, items: src.items, offerRecords: true, period: { from: "2026-09-21", to: "2026-10-20" } },
        { body: edited },
      );
      const all = [doc.subject, doc.body, doc.targetText, doc.totalText, ...doc.head, ...doc.notes, ...doc.rows.flatMap((r) => [r.title, r.kind, r.ours, r.theirs, r.diffText])].join("\n");
      expect(all).not.toMatch(/違反|違法|不当|法律|法令|取適法|下請法|フリーランス法|独占禁止法|物流特殊指定|未払|不払|支払遅延|支払え|請求します|法的|通報|Gメン|適法|問題ありません/);
      if (!edited) expect(all).toContain("ご確認いただけますでしょうか");
    }
    await client.close();
  });
});
