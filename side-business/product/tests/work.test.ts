import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import { adjustmentSchema, qtyInputSchema, workEntrySchema } from "~/server/features/import/schemas";
import { applyBatch, createDraftFromFile, readSampleFile } from "~/server/features/import/service";
import {
  addAdjustment,
  addWorkEntry,
  deleteAdjustment,
  deleteWorkEntry,
  loadWorkMonth,
  updateAdjustment,
  updateWorkEntry,
} from "~/server/features/import/work";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

async function ids(db: Db, tenantId: string) {
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
  return {
    D: Object.fromEntries(drivers.map((d) => [d.code!, d.id])),
    P: Object.fromEntries(projects.map((p) => [p.name, p.id])),
  };
}

async function totalOf(db: Db, tenantId: string, code: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
  return drafts.find((d) => d.driver.code === code)?.total ?? 0;
}

describe("稼働と調整の画面の中身", () => {
  it("ドライバー × 案件の合計と、出どころ（手入力・取り込みのファイル名）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const w = await loadWorkMonth(db, tenantId, DEMO_MONTH);
    expect(w.closed).toBe(false);
    expect(w.groups).toHaveLength(8);
    expect(w).toMatchObject({ entryCount: 11, importedCount: 0, manualCount: 11 });
    const aoki = w.groups.find((g) => g.code === "D01")!;
    expect(aoki.lines.map((l) => [l.projectName, l.qty, l.unit, l.sources.map((x) => x.label)])).toEqual([
      ["スポット便", 4, "件", ["手入力"]],
      ["宅配（個建て）", 2310, "個", ["手入力"]],
    ]);
    expect(w.byProject.find((p) => p.name === "宅配（個建て）")?.qty).toBe(2310 + 1840 + 420 + 380);
    expect(w.adjustments.map((a) => [a.driverName, a.label, a.amount])).toEqual([
      ["青木 翔太", "駐車場代の立替", 3300],
      ["上田 健", "車両修理の負担分", -11000],
    ]);
    expect((await loadWorkMonth(db, tenantId, DEMO_PREV_MONTH)).closed).toBe(true);

    // 取り込んだ行は、ファイル名が出どころになる
    const { fileName, bytes } = await readSampleFile("wide");
    const draft = await createDraftFromFile(db, tenantId, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await applyBatch(db, tenantId, { id: null }, draft.id, { mode: "replaceAll", confirmDuplicates: false });
    const w2 = await loadWorkMonth(db, tenantId, DEMO_MONTH);
    expect(w2).toMatchObject({ entryCount: 11, importedCount: 11, manualCount: 0 });
    expect(w2.groups[0].lines[0].sources).toEqual([{ label: fileName, batchId: draft.id }]);
    await client.close();
  });

  it("手で足す・直す・消す：明細の振込額が 1 円単位でそのとおり動く", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { D, P } = await ids(db, tenantId);
    expect(await totalOf(db, tenantId, "D01")).toBe(357555);

    // スポット便を 1 件足す：委託料 +7,000・消費税 +700・ロイヤリティ −700・その消費税 −70
    const { row } = await addWorkEntry(db, tenantId, DEMO_MONTH, { driverId: D.D01, projectId: P["スポット便"], qty: 1, workDate: "2026-10-15", note: "臨時" });
    expect(await totalOf(db, tenantId, "D01")).toBe(364485);
    const w = await loadWorkMonth(db, tenantId, DEMO_MONTH);
    const spot = w.groups.find((g) => g.code === "D01")!.lines.find((l) => l.projectName === "スポット便")!;
    expect(spot.qty).toBe(5);
    expect(spot.entries.map((e) => [e.qty, e.workDate, e.note])).toContainEqual([1, "2026-10-15", "臨時"]);

    const { before, after } = await updateWorkEntry(db, tenantId, row.id, { driverId: D.D01, projectId: P["スポット便"], qty: 2, workDate: null, note: null });
    expect([before.qty, after.qty, after.workDate]).toEqual([1, 2, null]);
    expect(await totalOf(db, tenantId, "D01")).toBe(357555 + 6930 * 2);

    await deleteWorkEntry(db, tenantId, row.id);
    expect(await totalOf(db, tenantId, "D01")).toBe(357555);
    await client.close();
  });

  it("調整：足す・直す・消す（課税しない調整は、そのままの額だけ振込額が動く）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { D } = await ids(db, tenantId);
    const before = await totalOf(db, tenantId, "D02");
    const { row } = await addAdjustment(db, tenantId, DEMO_MONTH, {
      driverId: D.D02,
      label: "高速代の立替",
      amount: 2000,
      taxable: false,
      agreedInWriting: true,
      basis: "領収書",
    });
    expect(await totalOf(db, tenantId, "D02")).toBe(before + 2000);
    await updateAdjustment(db, tenantId, row.id, {
      driverId: D.D02,
      label: "事故の負担分",
      amount: -5000,
      taxable: false,
      agreedInWriting: false,
      basis: null,
    });
    expect(await totalOf(db, tenantId, "D02")).toBe(before - 5000);
    const w = await loadWorkMonth(db, tenantId, DEMO_MONTH);
    expect(w.adjustments.find((a) => a.id === row.id)).toMatchObject({ label: "事故の負担分", amount: -5000, agreedInWriting: false });
    await deleteAdjustment(db, tenantId, row.id);
    expect(await totalOf(db, tenantId, "D02")).toBe(before);
    await client.close();
  });

  it("締めた月（2026年9月）は、足すことも直すことも消すこともできない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { D, P } = await ids(db, tenantId);
    await expect(
      addWorkEntry(db, tenantId, DEMO_PREV_MONTH, { driverId: D.D01, projectId: P["スポット便"], qty: 1, workDate: null, note: null }),
    ).rejects.toThrow("締め済み");
    await expect(
      addAdjustment(db, tenantId, DEMO_PREV_MONTH, { driverId: D.D01, label: "x", amount: 100, taxable: false, agreedInWriting: true, basis: null }),
    ).rejects.toThrow("締め済み");
    const [sept] = await db
      .select()
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_PREV_MONTH)));
    await expect(
      updateWorkEntry(db, tenantId, sept.id, { driverId: sept.driverId, projectId: sept.projectId, qty: 1, workDate: null, note: null }),
    ).rejects.toThrow("締め済み");
    await expect(deleteWorkEntry(db, tenantId, sept.id)).rejects.toThrow("締め済み");
    const [still] = await db.select().from(s.workEntries).where(eq(s.workEntries.id, sept.id));
    expect(still.qty).toBe(sept.qty);
    await client.close();
  });

  it("別の会社のドライバー・案件・稼働・調整は使えず、変えられない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId: t1 } = await seedDemo(db);
    const { tenantId: t2 } = await seedDemo(db);
    const a = await ids(db, t1);
    const b = await ids(db, t2);
    await expect(addWorkEntry(db, t1, DEMO_MONTH, { driverId: b.D.D01, projectId: a.P["スポット便"], qty: 1, workDate: null, note: null })).rejects.toThrow(
      "ドライバーが見つかりません",
    );
    await expect(addWorkEntry(db, t1, DEMO_MONTH, { driverId: a.D.D01, projectId: b.P["スポット便"], qty: 1, workDate: null, note: null })).rejects.toThrow(
      "案件が見つかりません",
    );
    await expect(
      addAdjustment(db, t1, DEMO_MONTH, { driverId: b.D.D01, label: "x", amount: 1, taxable: false, agreedInWriting: true, basis: null }),
    ).rejects.toThrow("見つかりません");

    const [e1] = await db
      .select()
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, t1), eq(s.workEntries.month, DEMO_MONTH)));
    await expect(updateWorkEntry(db, t2, e1.id, { driverId: b.D.D01, projectId: b.P["スポット便"], qty: 999, workDate: null, note: null })).rejects.toThrow(
      "見つかりません",
    );
    await expect(deleteWorkEntry(db, t2, e1.id)).rejects.toThrow("見つかりません");
    // 自分の行を、別の会社のドライバーに付け替えることもできない
    await expect(updateWorkEntry(db, t1, e1.id, { driverId: b.D.D01, projectId: e1.projectId, qty: 1, workDate: null, note: null })).rejects.toThrow(
      "見つかりません",
    );
    const [still] = await db.select().from(s.workEntries).where(eq(s.workEntries.id, e1.id));
    expect(still).toMatchObject({ qty: e1.qty, driverId: e1.driverId, tenantId: t1 });

    const [adj] = await db.select().from(s.adjustments).where(eq(s.adjustments.tenantId, t1));
    await expect(
      updateAdjustment(db, t2, adj.id, { driverId: b.D.D01, label: "x", amount: 1, taxable: false, agreedInWriting: true, basis: null }),
    ).rejects.toThrow("見つかりません");
    await expect(deleteAdjustment(db, t2, adj.id)).rejects.toThrow("見つかりません");
    expect((await db.select().from(s.adjustments).where(eq(s.adjustments.id, adj.id)))[0].amount).toBe(adj.amount);

    // 画面の読み出しも、その会社の分だけ
    const w2 = await loadWorkMonth(db, t2, DEMO_MONTH);
    expect(w2.groups.flatMap((g) => g.lines.flatMap((l) => l.entries)).some((e) => e.id === e1.id)).toBe(false);
    await expect(deleteWorkEntry(db, t1, "not-a-uuid")).rejects.toThrow("見つかりません");
    await client.close();
  });
});

describe("入力の確かめ", () => {
  it("数量：全角・カンマを読む。0 や文字は断る", () => {
    expect(qtyInputSchema.parse("２，３１０")).toBe(2310);
    expect(qtyInputSchema.parse("12.5")).toBe(12.5);
    expect(qtyInputSchema.safeParse("0").success).toBe(false);
    expect(qtyInputSchema.safeParse("たくさん").success).toBe(false);
    expect(qtyInputSchema.safeParse("1.23456").success).toBe(false);
  });

  it("調整：「引く」を選ぶとマイナスになる。0 円・空の内容は断る", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(
      adjustmentSchema.parse({ driverId: id, label: "事故の負担分", direction: "minus", amount: "3,300", taxable: "", agreedInWriting: "on" }),
    ).toMatchObject({
      amount: -3300,
      taxable: false,
      agreedInWriting: true,
      basis: null,
    });
    expect(adjustmentSchema.parse({ driverId: id, label: "立替", direction: "plus", amount: "１１００" }).amount).toBe(1100);
    expect(adjustmentSchema.safeParse({ driverId: id, label: "x", direction: "plus", amount: "0" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ driverId: id, label: " ", direction: "plus", amount: "100" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ driverId: id, label: "x", direction: "plus", amount: "10.5" }).success).toBe(false);
  });

  it("稼働：日付は空なら無し、形が違えば断る", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(workEntrySchema.parse({ driverId: id, projectId: id, qty: "3", workDate: "", note: "" })).toMatchObject({ qty: 3, workDate: null, note: null });
    expect(workEntrySchema.safeParse({ driverId: id, projectId: id, qty: "3", workDate: "2026-02-30" }).success).toBe(false);
    expect(workEntrySchema.safeParse({ driverId: "x", projectId: id, qty: "3" }).success).toBe(false);
  });
});
