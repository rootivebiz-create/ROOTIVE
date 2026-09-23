/**
 * 突合の見直しで足した確かめ：
 * - 取引をやめた元請でも、すでにある月のお支払通知は直したものに入れ替えられる（新しい月は上げない）
 * - 取り戻せた額（確定）は、直したファイルの列が読めず行が 0 のあいだも消えない
 * - 突き合わせ直して未対応に戻った差を、もう一度問い合わせると「返事待ち」は今日から数える
 * - 画面の部品で使う締めの期間（closingSpan）は、明細の計算の periodOf と同じ
 * DB はメモリ（PGlite）。デモの会社（架空）で確かめる。
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { periodOf } from "~/server/calc/statement";
import { foundMoney, importNotice, listWaiting, loadLetterSource, loadNoticeView, loadReport, markItemsAsked, runReconcile, setItemStatus } from "~/server/features/reconcile";
import { closingSpan } from "~/server/features/reconcile/labels";
import { buildLetter, letterDocument } from "~/server/features/reconcile/letter";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

const csv = (text: string) => new TextEncoder().encode(text);
const DAY = 86400000;
/** デモの A物流 10 月分と同じ内容（宅配 4,520個・企業配 61件・夜間便 20便 × 11,500円） */
const SAME_AS_DEMO = "品目,数量,単価,金額\n宅配,4520,190,858800\n企業配,61,22000,1342000\n夜間便,20,11500,230000\n";

async function setup() {
  const { db, client } = await createTestDb();
  const { tenantId } = await seedDemo(db);
  const clients = await db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId));
  const a = clients.find((c) => c.name.startsWith("A物流"))!;
  const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
  const [owner] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  return { db, client, tenantId, a, noticeId: notice.id, userId: owner.id };
}

async function items(db: Db, tenantId: string, noticeId: string) {
  const rows = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
  return rows.sort((x, y) => x.label.localeCompare(y.label, "ja") || x.kind.localeCompare(y.kind));
}

describe("取引をやめた元請の、直したお支払通知", () => {
  it("すでにある月は入れ替えられる（状態・取り戻せた額は残る）。新しい月・入れ替えにしていないときは断る。ほかの会社は変わらない", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    const other = await seedDemo(db);
    await runReconcile(db, tenantId, noticeId, userId);
    const takuhai = (await items(db, tenantId, noticeId)).find((r) => r.label === "宅配（個建て）")!;
    await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: [takuhai.id] });
    const askedBefore = (await items(db, tenantId, noticeId)).find((r) => r.id === takuhai.id)!.askedAt;
    expect(askedBefore).toBeInstanceOf(Date);
    await db.update(s.clients).set({ active: false }).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.id, a.id)));

    // 新しい月（11 月）は上げない
    await expect(
      importNotice(db, tenantId, userId, { clientId: a.id, month: "2026-11-01", fileName: "11月.csv", bytes: csv(SAME_AS_DEMO), replace: true }),
    ).rejects.toThrow("取引をやめた元請");
    // すでにある月でも「入れ替える」にしていなければ断る
    await expect(importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "10月.csv", bytes: csv(SAME_AS_DEMO), replace: false })).rejects.toThrow(
      "取引をやめた元請",
    );
    expect(await db.select().from(s.paymentNotices).where(and(eq(s.paymentNotices.tenantId, tenantId), eq(s.paymentNotices.month, "2026-11-01")))).toEqual([]);

    // 10 月分を直したもの（夜間便の単価が 12,000円 に直った）に入れ替える
    const fixed = "品目,数量,単価,金額\n宅配,4520,190,858800\n企業配,61,22000,1342000\n夜間便,20,12000,240000\n";
    const res = await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "10月_直し.csv", bytes: csv(fixed), replace: true });
    expect(res).toMatchObject({ noticeId, replaced: true, lineCount: 3 });
    const after = await items(db, tenantId, noticeId);
    expect(after.map((r) => [r.label, r.status, r.diff])).toEqual([["宅配（個建て）", "asked", -81700]]);
    expect(after[0].id).toBe(takuhai.id);
    expect(after[0].askedAt?.getTime()).toBe(askedBefore!.getTime());

    // ほかの会社の同じ名前の元請・通知は変わらない
    const [otherNotice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, other.tenantId));
    expect(otherNotice.fileName).not.toBe("10月_直し.csv");
    expect((await loadNoticeView(db, other.tenantId, otherNotice.id)).totals.short).toBe(91700);
    // ほかの会社の元請の id では入れ替えられない
    const [otherA] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, other.tenantId), eq(s.clients.name, a.name)));
    await expect(
      importNotice(db, tenantId, userId, { clientId: otherA.id, month: DEMO_MONTH, fileName: "x.csv", bytes: csv(SAME_AS_DEMO), replace: true }),
    ).rejects.toThrow("元請が見つかりません");
    await client.close();
  });
});

describe("取り戻せた額（確定）は消えない", () => {
  it("直したファイルの列が読めず行が 0 のあいだも、見つけたお金の確定は残る（見込みは比べられないので 0）", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const takuhai = (await items(db, tenantId, noticeId)).find((r) => r.label === "宅配（個建て）")!;
    await setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "resolved", note: "11月分に上乗せ", recoveredAmount: 81700 });
    expect(await foundMoney(db, tenantId, DEMO_MONTH)).toMatchObject({ confirmed: 81700, confirmedCount: 1, estimated: 10000 });

    // 列の分からないファイルで入れ替えた（行は 0。差の記録は残る）
    const res = await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "読めない.csv", bytes: csv("あ,い,う\nx,y,z\n"), replace: true });
    expect(res).toMatchObject({ lineCount: 0, run: null });
    expect(res.problem).not.toBeNull();
    expect((await items(db, tenantId, noticeId)).find((r) => r.id === takuhai.id)).toMatchObject({ status: "resolved", recoveredAmount: 81700 });

    const found = await foundMoney(db, tenantId, DEMO_MONTH);
    expect(found).toMatchObject({ confirmed: 81700, confirmedCount: 1, estimated: 0, estimatedCount: 0 });
    const cell = (await loadReport(db, tenantId, DEMO_MONTH, DEMO_MONTH)).cells.find((c) => c.clientName === "A物流（架空）")!;
    expect(cell).toMatchObject({ recovered: 81700, recoveredCount: 1, short: 0 });
    expect(cell.notice?.lineCount).toBe(0);
    // 結果の画面も同じ額
    expect((await loadNoticeView(db, tenantId, noticeId)).totals).toMatchObject({ recovered: 81700, recoveredCount: 1 });
    // 行が読めていないあいだは、前のファイルの数字で問い合わせ文を作らない（夜間便の未対応の差 −10,000円 は残っている）
    expect((await items(db, tenantId, noticeId)).find((r) => r.label === "夜間便")).toMatchObject({ status: "open", diff: -10000 });
    expect(await loadLetterSource(db, tenantId, noticeId)).toMatchObject({ unreadable: true, items: [] });
    await client.close();
  });
});

describe("返事待ちの日数", () => {
  it("突き合わせ直して未対応に戻った差を、もう一度問い合わせると今日から数える。問い合わせ済みのまま保存しても日付は変わらない", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const yakan = (await items(db, tenantId, noticeId)).find((r) => r.label === "夜間便")!;
    await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: [yakan.id] });
    const longAgo = new Date(Date.now() - 40 * DAY);
    await db.update(s.reconciliationItems).set({ askedAt: longAgo }).where(eq(s.reconciliationItems.id, yakan.id));
    // 問い合わせ済みのままメモだけ直しても、問い合わせた日は変わらない
    await setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "asked", note: "11/2 電話でも確認" });
    expect((await listWaiting(db, tenantId)).find((w) => w.itemId === yakan.id)?.days).toBe(40);
    // 了承したが、直したお支払通知で金額が変わった → 未対応に戻る（前に問い合わせた日は残る）
    await setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "accepted", note: "この単価で合意" });
    await importNotice(db, tenantId, userId, {
      clientId: a.id,
      month: DEMO_MONTH,
      fileName: "直し.csv",
      bytes: csv("品目,数量,単価,金額\n宅配,4520,190,858800\n企業配,61,22000,1342000\n夜間便,20,11000,220000\n"),
      replace: true,
    });
    const reopened = (await items(db, tenantId, noticeId)).find((r) => r.id === yakan.id)!;
    expect(reopened).toMatchObject({ status: "open", diff: -20000 });
    expect(reopened.askedAt?.getTime()).toBe(longAgo.getTime());
    // もう一度問い合わせる → 今日から（40 日ではなく 0 日）
    await setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "asked", note: null });
    expect((await listWaiting(db, tenantId)).find((w) => w.itemId === yakan.id)?.days).toBe(0);
    await client.close();
  });
});

describe("問い合わせ文の PDF の注記（締め日が違い、月単位で比べたとき）", () => {
  it("B商事（20 日締め）の稼働に日付が無ければ、表の注記に当社の月の期間を書く。本文は画面と同じ", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    const [b] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "B商事（架空）")));
    const res = await importNotice(db, tenantId, userId, {
      clientId: b.id,
      month: DEMO_MONTH,
      fileName: "B商事_10月.csv",
      bytes: csv("品目,数量,単価,金額\nスポット,1,9000,9000\n"),
      replace: false,
    });
    const src = await loadLetterSource(db, tenantId, res.noticeId);
    expect(src).toMatchObject({ unreadable: false, period: null, ourSpan: { from: "2026-10-01", to: "2026-10-31" } });
    expect(src.items.length).toBeGreaterThan(0);
    const input = { clientName: src.clientName, contactName: "", companyName: src.view.tenantName, senderName: "", month: DEMO_MONTH, items: src.items, offerRecords: false, period: src.period };
    const doc = letterDocument(input, { ourSpan: src.ourSpan });
    expect(doc.notes).toContain("当社の記録は、当社の月（2026年10月1日〜2026年10月31日）の稼働で集計しています。お支払通知の期間と異なる場合があります。");
    expect(doc.body).toBe(buildLetter(input).body);
    expect(doc.notes.join("\n")).not.toMatch(/違反|違法|不当|法令|取適法|下請法|未払|不払|支払遅延|通報/);
    // A物流（月末締め）は注記なし
    const aSrc = await loadLetterSource(db, tenantId, noticeId);
    expect(aSrc.ourSpan).toBeNull();
    expect(letterDocument({ ...input, items: aSrc.items }, { ourSpan: aSrc.ourSpan }).notes).toHaveLength(2);
    await client.close();
  });
});

describe("締めの期間（画面の部品用）", () => {
  it("closingSpan は periodOf と同じ期間を返す（1〜30 日締め、うるう年・短い月も）。月末締めは null", () => {
    for (let y = 2026; y <= 2028; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        const month = `${y}-${String(mo).padStart(2, "0")}`;
        for (let day = 1; day <= 30; day++) expect([month, day, closingSpan(month, day)]).toEqual([month, day, periodOf(`${month}-01`, day)]);
        expect(closingSpan(month, 0)).toBeNull();
        expect(closingSpan(month, 31)).toBeNull();
      }
    }
    expect(closingSpan("2026-10", 20)).toEqual({ from: "2026-09-21", to: "2026-10-20" });
    expect(closingSpan("2028-03", 30)).toEqual({ from: "2028-03-01", to: "2028-03-30" });
    expect(closingSpan("2028-03", 28)).toEqual({ from: "2028-02-29", to: "2028-03-28" });
    expect(closingSpan("x", 20)).toBeNull();
  });
});
