import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  deleteNotice,
  lineKey,
  findSampleClient,
  importNotice,
  listMonth,
  loadNoticeView,
  loadReport,
  markItemsAsked,
  runReconcile,
  setDriverMapping,
  setItemStatus,
  setLineMapping,
  updateNoticeColumns,
  updateNoticeMeta,
} from "~/server/features/reconcile";
import { buildLetter } from "~/server/features/reconcile/letter";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

const samples = path.join(__dirname, "..", "public", "samples");
const sjis = () => new Uint8Array(fs.readFileSync(path.join(samples, "元請_支払通知_2026年10月_SJIS.csv")));
const utf8 = () => new Uint8Array(fs.readFileSync(path.join(samples, "元請_支払通知_2026年10月_UTF8.csv")));
const csv = (text: string) => new TextEncoder().encode(text);

async function setup() {
  const { db, client } = await createTestDb();
  const { tenantId } = await seedDemo(db);
  const clients = await db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId));
  const a = clients.find((c) => c.name.startsWith("A物流"))!;
  const b = clients.find((c) => c.name.startsWith("B商事"))!;
  const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
  const P = Object.fromEntries(projects.map((p) => [p.name, p]));
  const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
  const [owner] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  return { db, client, tenantId, a, b, P, noticeId: notice.id, userId: owner.id };
}

async function items(db: Db, tenantId: string, noticeId: string) {
  const rows = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
  return rows.sort((x, y) => x.label.localeCompare(y.label, "ja") || x.kind.localeCompare(y.kind));
}

const pick = (r: { kind: string; label: string; ourQty: number | null; theirQty: number | null; ourPrice: number | null; theirPrice: number | null; ourAmount: number; theirAmount: number; diff: number }) => ({
  kind: r.kind,
  label: r.label,
  ourQty: r.ourQty,
  theirQty: r.theirQty,
  ourPrice: r.ourPrice,
  theirPrice: r.theirPrice,
  ourAmount: r.ourAmount,
  theirAmount: r.theirAmount,
  diff: r.diff,
});

// デモの 10 月：宅配（個建て）は 青木 2,310 ＋ 上田 1,840 ＋ 岡田 420 ＋ 木村 380 ＝ 4,950 個
const TAKUHAI_OURS = 4950;

describe("元請の支払通知との突合（デモの A物流・2026年10月）", () => {
  it("入っている通知を突き合わせる：宅配は数量の差 −81,700円、夜間便は単価の差 −10,000円、企業配は一致", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    const run = await runReconcile(db, tenantId, noticeId, userId);
    expect(run).toMatchObject({ skipped: false, items: 2, created: 2, matchedLines: 3 });
    const rows = await items(db, tenantId, noticeId);
    expect(rows.map(pick)).toEqual([
      { kind: "qty", label: "宅配（個建て）", ourQty: TAKUHAI_OURS, theirQty: 4520, ourPrice: 190, theirPrice: 190, ourAmount: 940500, theirAmount: 858800, diff: -81700 },
      { kind: "price", label: "夜間便", ourQty: 20, theirQty: 20, ourPrice: 12000, theirPrice: 11500, ourAmount: 240000, theirAmount: 230000, diff: -10000 },
    ]);
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.stale).toBe(false);
    expect(view.live.ourTotal).toBe(940500 + 1342000 + 240000);
    expect(view.live.theirTotal).toBe(858800 + 1342000 + 230000);
    expect(view.totals).toMatchObject({ short: 91700, shortCount: 2, over: 0, overCount: 0 });
    expect(view.live.projects.find((p) => p.name === "企業配（日当）")).toMatchObject({ ourQty: 61, theirQty: 61, diff: 0 });
    // 見本の CSV（待機料つき）は元請の画面から落とした形。デモの元請が見つかる
    expect((await findSampleClient(db, tenantId))?.name).toBe("A物流（架空）");
    await client.close();
  });

  it("まだ突き合わせていない通知も、一覧・レポート・画面では突き合わせたときと同じ当て方で数える（DB は変えない）", async () => {
    const { db, client, tenantId, noticeId } = await setup();
    const month = await listMonth(db, tenantId, DEMO_MONTH);
    expect(month.rows.find((r) => r.clientName === "A物流（架空）")!.notice).toMatchObject({ short: 91700, shortCount: 2, over: 0, openCount: 2, stale: true, lineCount: 3 });
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.stale).toBe(true);
    // 画面には今の記録で計算した差を並べる（まだ保存していないので id は無く、扱いは「未対応」）
    expect(view.display.map((i) => [i.kind, i.label, i.diff, i.id, i.status])).toEqual([
      ["qty", "宅配（個建て）", -81700, null, "open"],
      ["price", "夜間便", -10000, null, "open"],
    ]);
    expect(view.totals).toMatchObject({ short: 91700, shortCount: 2 });
    expect(view.lineGroups.map((g) => [g.raw, g.role, g.projectName])).toEqual(
      expect.arrayContaining([
        ["宅配", "project", "宅配（個建て）"],
        ["企業配", "project", "企業配（日当）"],
        ["夜間便", "project", "夜間便"],
      ]),
    );
    // 画面を見ただけでは、行も差も書き換えない
    const lines = await db.select().from(s.paymentNoticeLines).where(eq(s.paymentNoticeLines.noticeId, noticeId));
    expect(lines.every((l) => l.projectId === null)).toBe(true);
    expect(await items(db, tenantId, noticeId)).toEqual([]);
    await client.close();
  });

  it("見本の CSV（Shift_JIS）で入れ替える：待機料 3 × 1,000円 が「お支払通知にだけある」＋3,000円。UTF-8 でも同じ結果", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    await expect(importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "通知.csv", bytes: sjis(), replace: false })).rejects.toThrow("すでに上げてあります");

    const res = await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "元請_支払通知_2026年10月_SJIS.csv", bytes: sjis(), replace: true });
    expect(res).toMatchObject({ noticeId, lineCount: 4, replaced: true, problem: null });
    const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.id, noticeId));
    expect(notice.total).toBe(2433800);
    const afterSjis = (await items(db, tenantId, noticeId)).map(pick);
    expect(afterSjis).toContainEqual({ kind: "extra", label: "待機料", ourQty: null, theirQty: 3, ourPrice: null, theirPrice: 1000, ourAmount: 0, theirAmount: 3000, diff: 3000 });
    expect(afterSjis.reduce((x, r) => x + r.diff, 0)).toBe(-81700 - 10000 + 3000);
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.totals).toMatchObject({ short: 91700, shortCount: 2, over: 3000, overCount: 1 });
    expect(view.batch).toMatchObject({ encoding: "shift_jis", fileTotal: 2433800, total: 2433800, warnings: [] });
    expect(view.lineGroups.find((g) => g.raw === "待機料")).toMatchObject({ role: "unknown", amount: 3000 });

    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "元請_支払通知_2026年10月_UTF8.csv", bytes: utf8(), replace: true });
    expect((await items(db, tenantId, noticeId)).map(pick)).toEqual(afterSjis);
    const view2 = await loadNoticeView(db, tenantId, noticeId);
    expect(view2.batch?.encoding).toBe("utf-8");
    // 列の対応を元請の名前で覚えている
    const [profile] = await db.select().from(s.mappingProfiles).where(and(eq(s.mappingProfiles.tenantId, tenantId), eq(s.mappingProfiles.kind, "payment_notice")));
    expect(profile.name).toBe("A物流（架空）");
    expect(profile.mapping).toMatchObject({ item: "品目", qty: "数量", unitPrice: "単価", amount: "金額" });
    await client.close();
  });

  it("突き合わせ直しても、同じ差の状態とメモは残る。金額が変わった「了承」「解決」は未対応に戻る", async () => {
    const { db, client, tenantId, a, P, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const [takuhai, yakan] = await items(db, tenantId, noticeId);
    await setItemStatus(db, tenantId, userId, { itemId: takuhai.id, status: "accepted", note: "10/31 電話で確認。10月はこの数で了承" });
    await setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "resolved", note: "来月に差額を払うとのこと" });

    await runReconcile(db, tenantId, noticeId, userId);
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "再.csv", bytes: sjis(), replace: true });
    const again = await items(db, tenantId, noticeId);
    expect(again.find((r) => r.label === "宅配（個建て）")).toMatchObject({ id: takuhai.id, status: "accepted", note: "10/31 電話で確認。10月はこの数で了承", diff: -81700 });
    expect(again.find((r) => r.label === "夜間便")).toMatchObject({ id: yakan.id, status: "resolved", note: "来月に差額を払うとのこと" });

    // 当社の記録が変わる（宅配 +10 個、夜間便 +1 便）
    const [aoki] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    const [kato] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D06")));
    await db.insert(s.workEntries).values([
      { tenantId, month: DEMO_MONTH, driverId: aoki.id, projectId: P["宅配（個建て）"].id, qty: 10 },
      { tenantId, month: DEMO_MONTH, driverId: kato.id, projectId: P["夜間便"].id, qty: 1 },
    ]);
    expect((await loadNoticeView(db, tenantId, noticeId)).stale).toBe(true);
    const run = await runReconcile(db, tenantId, noticeId, userId);
    // 宅配の差は −81,700 → −83,600 に変わったので、了承は未対応に戻す（メモは残す）
    expect(run.reopened).toBe(1);
    const after = await items(db, tenantId, noticeId);
    expect(after.find((r) => r.label === "宅配（個建て）")).toMatchObject({ id: takuhai.id, status: "open", note: "10/31 電話で確認。10月はこの数で了承", ourQty: 4960, diff: -83600 });

    // 夜間便は数量と単価の両方が違う → 2 つに分ける。単価の差（−10,000円）は変わらないので「解決」のまま
    const split = after.filter((r) => r.label === "夜間便");
    expect(split.map(pick)).toEqual([
      // 単価の差：通知の数量 20 便で、当社の単価 12,000円 と通知の単価 11,500円
      { kind: "price", label: "夜間便", ourQty: 20, theirQty: 20, ourPrice: 12000, theirPrice: 11500, ourAmount: 240000, theirAmount: 230000, diff: -10000 },
      // 数量の差：（20 − 21）× 当社の単価 12,000円
      { kind: "qty", label: "夜間便", ourQty: 21, theirQty: 20, ourPrice: 12000, theirPrice: 12000, ourAmount: 252000, theirAmount: 240000, diff: -12000 },
    ]);
    expect(split.find((r) => r.kind === "price")).toMatchObject({ id: yakan.id, status: "resolved" });
    expect(split.find((r) => r.kind === "qty")).toMatchObject({ status: "open", note: null });
    // 2 つを足すと差の全体（230,000 − 252,000）
    expect(split.reduce((x, r) => x + r.diff, 0)).toBe(230000 - 252000);
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.stale).toBe(false);
    expect(view.items.filter((i) => i.label === "夜間便").every((i) => i.split)).toBe(true);
    await client.close();
  });

  it("当たらない品目を案件に決めると別名に覚え、翌月は自動で当たる。追加の料金・対象外も覚える", async () => {
    const { db, client, tenantId, a, P, userId } = await setup();
    const nov = "2026-11-01";
    const file = csv("品目,数量,単価,金額\nポスト便,100,190,19000\n宅配（再配達）,2,1000,2000\n協力会費,1,-500,-500\n");
    const first = await importNotice(db, tenantId, userId, { clientId: a.id, month: nov, fileName: "11月.csv", bytes: file, replace: false });
    let view = await loadNoticeView(db, tenantId, first.noticeId);
    const group = (raw: string) => view.lineGroups.find((x) => x.raw === raw)!;
    expect(group("ポスト便").role).toBe("unknown");
    // 「宅配（再配達）」は再配達の料金。括弧を外すと「宅配」だが、宅配（個建て）には混ぜない
    expect(group("宅配（再配達）")).toMatchObject({ role: "unknown", suggestedProjectId: null });
    expect(group("協力会費").role).toBe("unknown");

    const res = await setLineMapping(db, tenantId, userId, { noticeId: first.noticeId, key: group("ポスト便").key, target: `project:${P["宅配（個建て）"].id}` });
    expect(res.aliasAdded).toBe(true);
    await setLineMapping(db, tenantId, userId, { noticeId: first.noticeId, key: group("宅配（再配達）").key, target: "extra" });
    await setLineMapping(db, tenantId, userId, { noticeId: first.noticeId, key: group("協力会費").key, target: "ignore" });
    const [takuhai] = await db.select().from(s.projects).where(eq(s.projects.id, P["宅配（個建て）"].id));
    expect(takuhai.aliases).toContain("ポスト便");
    view = await loadNoticeView(db, tenantId, first.noticeId);
    expect(view.live).toMatchObject({ ignoredTotal: -500, theirTotal: 21000, unknownLines: 0 });
    // 11 月は当社に稼働が無いので、宅配は「当社 0 個」との数量の差（+19,000円）
    expect(view.items.map((i) => [i.kind, i.label, i.diff, i.confirmedExtra])).toEqual([
      ["qty", "宅配（個建て）", 19000, false],
      ["extra", "宅配（再配達）", 2000, true],
    ]);

    // 翌月：同じ形のファイルは、案件・追加の料金・対象外がすべて自動で決まる
    const dec = "2026-12-01";
    const second = await importNotice(db, tenantId, userId, { clientId: a.id, month: dec, fileName: "12月.csv", bytes: file, replace: false });
    view = await loadNoticeView(db, tenantId, second.noticeId);
    expect(Object.fromEntries(view.lineGroups.map((x) => [x.raw, [x.role, x.projectName]]))).toEqual({
      ポスト便: ["project", "宅配（個建て）"],
      "宅配（再配達）": ["extra", null],
      協力会費: ["ignore", null],
    });
    expect(view.live.unknownLines).toBe(0);

    // 「決め直す」（覚えた決め方を消す）と、名前の照合に戻る。ポスト便は別名で当たる
    await setLineMapping(db, tenantId, userId, { noticeId: second.noticeId, key: lineKey("ポスト便"), target: "auto" });
    view = await loadNoticeView(db, tenantId, second.noticeId);
    expect(view.lineGroups.find((x) => x.raw === "ポスト便")).toMatchObject({ role: "project", remembered: false });
    await client.close();
  });

  it("ドライバーの列があれば、ドライバー別の内訳を出す（Excel）。名前が当たらない人は選んで覚える", async () => {
    const { db, client, tenantId, a, userId } = await setup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("支払明細");
    ws.addRow(["A物流（架空） お支払通知書"]);
    ws.addRow([]);
    ws.addRow(["日付", "担当ドライバー", "コース", "個数", "単価", "金額"]);
    ws.addRow(["2026/10/31", "青木 翔太", "宅配", 2310, 190, 438900]);
    ws.addRow(["2026/10/31", "上田健", "宅配", 1840, 190, 349600]);
    ws.addRow(["2026/10/31", "岡田 拓也", "宅配", 370, 190, 70300]);
    ws.addRow(["2026/10/31", "木村誠", "宅配", 0, 190, 0]);
    ws.addRow(["", "", "合計", "", "", 858800]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const res = await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "通知.xlsx", bytes: buf, replace: true });
    expect(res.problem).toBeNull();
    let view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.batch).toMatchObject({ encoding: "xlsx", headerIndex: 2, fileTotal: 858800, total: 858800 });
    expect(view.batch?.columns).toEqual({ date: 0, driver: 1, item: 2, qty: 3, unitPrice: 4, amount: 5 });
    const takuhai = view.live.drivers!.filter((d) => d.projectName === "宅配（個建て）");
    const byName = Object.fromEntries(takuhai.map((d) => [d.driverName, [d.ourQty, d.theirQty, d.diffAtOurPrice]]));
    expect(byName["青木 翔太"]).toEqual([2310, 2310, 0]);
    expect(byName["上田 健"]).toEqual([1840, 1840, 0]);
    expect(byName["岡田 拓也"]).toEqual([420, 370, -9500]);
    // 「木村誠」は空白の違いだけなので名簿の「木村 誠」に当たる
    expect(byName["木村 誠"]).toEqual([380, 0, -72200]);
    // 夜間便・企業配は通知に無い → 「お支払通知に無い」
    expect(view.items.filter((i) => i.kind === "missing").map((i) => [i.label, i.diff])).toEqual([
      ["企業配（日当）", -1342000],
      ["夜間便", -240000],
    ]);

    // 名前の当たらないドライバー（カナだけ）を選ぶと、別名に覚えて内訳にまとまる
    const ws2 = wb.getWorksheet("支払明細")!;
    ws2.getCell("B5").value = "ウエダ";
    const buf2 = new Uint8Array(await wb.xlsx.writeBuffer());
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "通知2.xlsx", bytes: buf2, replace: true });
    view = await loadNoticeView(db, tenantId, res.noticeId);
    const ug = view.driverGroups.find((g) => g.raw === "ウエダ")!;
    expect(ug.driverId).toBeNull();
    expect(view.live.drivers!.find((d) => d.driverName === "ウエダ")).toMatchObject({ ourQty: 0, theirQty: 1840 });
    const [ueda] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D03")));
    const mapped = await setDriverMapping(db, tenantId, userId, { noticeId: res.noticeId, key: ug.key, driverId: ueda.id });
    expect(mapped.aliasAdded).toBe(true);
    view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.driverGroups.find((g) => g.raw === "ウエダ")).toMatchObject({ driverId: ueda.id, driverName: "上田 健", remembered: true });
    expect(view.live.drivers!.find((d) => d.driverName === "上田 健")).toMatchObject({ ourQty: 1840, theirQty: 1840, diffAtOurPrice: 0 });
    const [uedaAfter] = await db.select().from(s.drivers).where(eq(s.drivers.id, ueda.id));
    expect(uedaAfter.aliases).toContain("ウエダ");
    await client.close();
  });

  it("列が分からないファイルは行を入れずに残し、列を選び直すと突き合わせる", async () => {
    const { db, client, tenantId, b, userId } = await setup();
    const file = csv("B商事（架空） 支払一覧\nA,B,C\nスポット,4,36000\nルート配送,168,436800\n");
    const res = await importNotice(db, tenantId, userId, { clientId: b.id, month: DEMO_MONTH, fileName: "b.csv", bytes: file, replace: false });
    // 見出しが A・B・C で数量・金額が分からない。品目の列だけは当てる
    expect(res.problem).toContain("金額の列が分かりません");
    expect(res.lineCount).toBe(0);
    expect(await items(db, tenantId, res.noticeId)).toEqual([]);
    const view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.batch?.problem).toContain("金額");
    const out = await updateNoticeColumns(db, tenantId, userId, { noticeId: res.noticeId, headerRow: 2, columns: { item: 0, qty: 1, unitPrice: null, amount: 2, driver: null, date: null } });
    expect(out.lineCount).toBe(2);
    // B商事の 10 月：スポット便 青木 4 ＋ 遠藤 2 ＝ 6 件 × 9,000円 ＝ 54,000円、ルート配送 168 時間 × 2,600円 ＝ 436,800円
    const rows = (await items(db, tenantId, res.noticeId)).map(pick);
    expect(rows).toEqual([
      { kind: "qty", label: "スポット便", ourQty: 6, theirQty: 4, ourPrice: 9000, theirPrice: 9000, ourAmount: 54000, theirAmount: 36000, diff: -18000 },
    ]);
    await expect(
      updateNoticeColumns(db, tenantId, userId, { noticeId: res.noticeId, headerRow: 2, columns: { item: 0, qty: 0, unitPrice: null, amount: 2, driver: null, date: null } }),
    ).rejects.toThrow("同じ列");
    await client.close();
  });

  it("締めた月（9 月）の通知も突き合わせられる（稼働は変えない）", async () => {
    const { db, client, tenantId, a, userId } = await setup();
    const file = csv("品目,数量,単価,金額\n宅配,5865,190,1114350\n企業配,58,22000,1276000\n夜間便,18,12000,216000\n");
    const res = await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_PREV_MONTH, fileName: "9月.csv", bytes: file, replace: false });
    // 9 月の宅配：青木 2,250 ＋ 上田 1,905 ＋ 岡田 410 ＋ 木村 1,300 ＝ 5,865 個、企業配 20 ＋ 17 ＋ 21 ＝ 58 日、夜間便 18 便 → すべて一致
    expect(res.run?.items).toBe(0);
    const view = await loadNoticeView(db, tenantId, res.noticeId);
    expect(view.live.ourTotal).toBe(1114350 + 1276000 + 216000);
    expect(view.live.theirTotal).toBe(view.live.ourTotal);
    await client.close();
  });

  it("入金日と差し引かれた手数料：受け取る側の事実だけを出す", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    await updateNoticeMeta(db, tenantId, userId, { noticeId, paidOn: "2026-12-30", feeDeducted: 0 });
    expect((await loadNoticeView(db, tenantId, noticeId)).facts).toEqual([]);
    await updateNoticeMeta(db, tenantId, userId, { noticeId, paidOn: "2027-01-10", feeDeducted: 660 });
    const facts = (await loadNoticeView(db, tenantId, noticeId)).facts;
    expect(facts.map((f) => f.code)).toEqual(["fee_deducted", "paid_after_60_days"]);
    expect(facts[0].detail).toContain("660円");
    expect(facts[1].detail).toContain("2027年1月10日");
    expect(facts[1].detail).toContain("2026年10月31日");
    expect(facts[1].detail).toContain("71日後");
    await expect(updateNoticeMeta(db, tenantId, userId, { noticeId, paidOn: null, feeDeducted: -1 })).rejects.toThrow("0 以上");
    await client.close();
  });

  it("問い合わせ文：未対応の差をすべて数字つきで書き、送ったら「問い合わせ済み」にできる", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "見本.csv", bytes: sjis(), replace: true });
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.stale).toBe(false);
    const open = view.items.filter((i) => i.status === "open").map((i) => ({ ...i, id: i.id! }));
    const letter = buildLetter({ clientName: "A物流（架空）", contactName: "ご担当者様", companyName: view.tenantName, senderName: "デモ 事務", month: DEMO_MONTH, items: open, offerRecords: true });
    expect(letter.subject).toBe("2026年10月分 お支払通知書の内容のご確認のお願い（サンプル運送株式会社（架空））");
    expect(letter.body).toContain("当社の記録では 宅配（個建て） 4,950個 × 190円 = 940,500円、お支払通知では 4,520個 = 858,800円（差 81,700円）");
    expect(letter.body).toContain("当社の記録では 夜間便 20便 × 12,000円 = 240,000円、お支払通知では 20便 × 11,500円 = 230,000円（差 10,000円）");
    expect(letter.body).toContain("お支払通知に「待機料」（3 × 1,000円 = 3,000円）の行がございますが");
    expect(letter.body).toContain("日ごとの稼働の記録");
    expect(letter.body).not.toMatch(/違反|違法|法律|法令|未払い|支払え/);

    const n = await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: open.filter((i) => i.diff < 0).map((i) => i.id) });
    expect(n).toBe(2);
    const after = await loadNoticeView(db, tenantId, noticeId);
    expect(after.items.filter((i) => i.status === "asked").map((i) => i.label)).toEqual(["夜間便", "宅配（個建て）"].sort((x, y) => x.localeCompare(y, "ja")));
    await client.close();
  });

  it("月の一覧とレポート（3 か月）：通知の無い月も当社の記録を出す", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "見本.csv", bytes: sjis(), replace: true });
    const month = await listMonth(db, tenantId, DEMO_MONTH);
    const rowA = month.rows.find((r) => r.clientName === "A物流（架空）")!;
    expect(rowA.ourTotal).toBe(2522500);
    expect(rowA.notice).toMatchObject({ id: noticeId, total: 2433800, short: 91700, shortCount: 2, over: 3000, overCount: 1, openCount: 3 });
    const rowB = month.rows.find((r) => r.clientName === "B商事（架空）")!;
    // B商事の 10 月：スポット便 6 件 × 9,000円 ＋ ルート配送 168 時間 × 2,600円
    expect(rowB).toMatchObject({ ourTotal: 54000 + 436800, notice: null });

    const report = await loadReport(db, tenantId, "2026-08-01", DEMO_MONTH);
    expect(report.months).toEqual(["2026-08-01", "2026-09-01", DEMO_MONTH]);
    const cellA = report.cells.find((c) => c.clientName === "A物流（架空）" && c.month === DEMO_MONTH)!;
    expect(cellA).toMatchObject({ ourTotal: 2522500, short: 91700, over: 3000, open: 3, stale: false });
    expect(cellA.notice?.theirTotal).toBe(2433800);
    // 9 月は通知が無い：当社の記録だけ（宅配 5,865 × 190 ＋ 企業配 58 × 22,000 ＋ 夜間便 18 × 12,000）
    expect(report.cells.find((c) => c.clientName === "A物流（架空）" && c.month === DEMO_PREV_MONTH)).toMatchObject({ notice: null, ourTotal: 1114350 + 1276000 + 216000 });
    expect(report.cells.some((c) => c.month === "2026-08-01")).toBe(false);
    expect(report.totals).toMatchObject({ short: 91700, shortCount: 2, over: 3000, overCount: 1, notices: 1 });
    await client.close();
  });

  it("ほかの会社の通知は読めず、変えられない", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    const other = await seedDemo(db);
    const [otherNotice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, other.tenantId));
    const [otherProject] = await db.select().from(s.projects).where(eq(s.projects.tenantId, other.tenantId));
    const [otherClient] = await db.select().from(s.clients).where(eq(s.clients.tenantId, other.tenantId));
    await runReconcile(db, other.tenantId, otherNotice.id, null);
    const otherItems = await items(db, other.tenantId, otherNotice.id);
    expect(otherItems).toHaveLength(2);

    await expect(loadNoticeView(db, tenantId, otherNotice.id)).rejects.toThrow("見つかりません");
    await expect(runReconcile(db, tenantId, otherNotice.id)).rejects.toThrow("見つかりません");
    await expect(deleteNotice(db, tenantId, userId, otherNotice.id)).rejects.toThrow("見つかりません");
    await expect(updateNoticeMeta(db, tenantId, userId, { noticeId: otherNotice.id, paidOn: null, feeDeducted: 1 })).rejects.toThrow("見つかりません");
    await expect(setItemStatus(db, tenantId, userId, { itemId: otherItems[0].id, status: "resolved", note: null })).rejects.toThrow("見つかりません");
    expect(await markItemsAsked(db, tenantId, userId, { noticeId, itemIds: otherItems.map((i) => i.id) })).toBe(0);
    await expect(importNotice(db, tenantId, userId, { clientId: otherClient.id, month: DEMO_MONTH, fileName: "x.csv", bytes: sjis(), replace: true })).rejects.toThrow("元請が見つかりません");

    // 自分の通知の行を、ほかの会社の案件に当てることはできない
    await runReconcile(db, tenantId, noticeId, userId);
    const view = await loadNoticeView(db, tenantId, noticeId);
    await expect(setLineMapping(db, tenantId, userId, { noticeId, key: view.lineGroups[0].key, target: `project:${otherProject.id}` })).rejects.toThrow("案件が見つかりません");

    // 一覧・レポートに、ほかの会社の通知は混ざらない
    const month = await listMonth(db, tenantId, DEMO_MONTH);
    expect(month.rows.filter((r) => r.notice).map((r) => r.notice!.id)).toEqual([noticeId]);
    const report = await loadReport(db, tenantId, DEMO_MONTH, DEMO_MONTH);
    expect(report.cells.filter((c) => c.notice).map((c) => c.notice!.id)).toEqual([noticeId]);

    // ほかの会社の差は何も変わっていない
    expect((await items(db, other.tenantId, otherNotice.id)).map((i) => [i.id, i.status])).toEqual(otherItems.map((i) => [i.id, "open"]));
    void a;
    await client.close();
  });

  it("通知を削除すると差も消え、操作の記録に残る", async () => {
    const { db, client, tenantId, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const res = await deleteNotice(db, tenantId, userId, noticeId);
    expect(res.month).toBe(DEMO_MONTH);
    expect(await items(db, tenantId, noticeId)).toEqual([]);
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "reconcile.notice_delete")));
    expect(logs).toHaveLength(1);
    expect((logs[0].detail as { items: unknown[] }).items).toHaveLength(2);
    await client.close();
  });
});
