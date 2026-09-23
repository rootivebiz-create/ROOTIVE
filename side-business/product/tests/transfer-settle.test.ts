import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { buildStatementDrafts } from "~/server/calc/statement";
import { closeMonth, loadCloseChecklist, reopenMonth, searchAuditLog } from "~/server/features/close";
import { deleteAdjustment } from "~/server/features/import/work";
import {
  createTransferBatch,
  listTransferBatches,
  loadPaidDifferences,
  loadTransferPlan,
  setTransferExecutedOn,
  settlePaidDifference,
  settlementLabel,
  undoSettlement,
} from "~/server/features/transfer";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 振り込んだあとに間違いが分かったとき：締めを外して明細を作り直すと、振り込んだ額と明細の額が合わなくなる。
 * 人ごとの差（振り込んだ額・今の明細・差）を出し、翌月の明細の調整か、別の方法で精算したことを記録する。
 */
const state: { db?: Db; user?: SessionUser } = {};
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => state.user,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const NOV = "2026-11-01";
const noWatch = { runWatch: async () => [] };

async function render(m: string): Promise<string> {
  const { default: TransferPage } = await import("~/app/(app)/transfer/page");
  const el = (await TransferPage({ searchParams: Promise.resolve({ m }) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("振り込んだあとに明細が変わったとき（差の精算）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherId: string;
  let ownerId: string;
  let staff: SessionUser;
  let viewer: SessionUser;
  const ids: Record<string, string> = {};
  const paidBefore: Record<string, number> = {};

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    state.db = db;
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    ownerId = users.find((u) => u.role === "owner")!.id;
    const st = users.find((u) => u.role === "staff")!;
    staff = { id: st.id, tenantId, email: st.email, name: st.name, role: "staff" };
    viewer = { ...staff, role: "viewer", name: "閲覧の人" };
    for (const d of await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))) ids[d.code!] = d.id;

    // 10 月分：明細 → 振込データ → 振り込んだ → 締め
    await generateStatements(db, tenantId, DEMO_MONTH);
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    for (const r of plan.included) paidBefore[r.driverCode!] = r.amount;
    const batch = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, staff.id);
    await setTransferExecutedOn(db, tenantId, batch.id, "2026-11-25", staff.id);
    await closeMonth(db, tenantId, DEMO_MONTH, ownerId, noWatch);
  });
  afterAll(async () => client.close());

  it("振り込んだあとで明細が変わらなければ、差は出ない", async () => {
    const r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    expect(r.executedBatches).toBe(1);
    expect(r.rows).toEqual([]);
    expect(r.openCount).toBe(0);
    expect((await listTransferBatches(db, tenantId, DEMO_MONTH))[0]).toMatchObject({ changed: false, paidDiffOpen: 0 });
  });

  it("締めを外して直すと、人ごとに 振り込んだ額・今の明細・差 を出す（二重に振り込まないよう、その人は「まだの人だけ」に入らない）", async () => {
    await reopenMonth(db, tenantId, DEMO_MONTH, { id: ownerId, role: "owner" }, "28日のスポット便が漏れていたため");
    // 青木：3,000 円の払い足りない／井上：2,000 円の払いすぎ
    await db.insert(s.adjustments).values([
      { tenantId, month: DEMO_MONTH, driverId: ids.D01, label: "スポット便の追加", amount: 3_000 },
      { tenantId, month: DEMO_MONTH, driverId: ids.D02, label: "二重に入れた立替の取り消し", amount: -2_000, agreedInWriting: true },
    ]);
    await generateStatements(db, tenantId, DEMO_MONTH);

    const r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    expect(r.rows.map((x) => [x.driverCode, x.paid, x.statementTotal, x.difference, x.outstanding])).toEqual([
      ["D01", paidBefore.D01, paidBefore.D01 + 3_000, 3_000, 3_000],
      ["D02", paidBefore.D02, paidBefore.D02 - 2_000, -2_000, -2_000],
    ]);
    expect(r.rows[0]).toMatchObject({ paidVersions: [1], paidOn: ["2026-11-25"], statementVersion: 2 });
    expect(r).toMatchObject({ openCount: 2, underpaid: 3_000, overpaid: 2_000, nextMonth: NOV, nextMonthClosed: false });

    const [batch] = await listTransferBatches(db, tenantId, DEMO_MONTH);
    expect(batch).toMatchObject({ changed: true, paidDiffOpen: 2 });
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    expect(plan.included.filter((x) => x.inBatches.length === 0)).toEqual([]);
    const c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, noWatch);
    expect(c.transfer).toMatchObject({ changedExecuted: 1, paidDiff: { open: 2, underpaid: 3_000, overpaid: 2_000 } });
    // ほかの会社の振込とは混ざらない
    expect((await loadPaidDifferences(db, otherId, DEMO_MONTH)).rows).toEqual([]);
  });

  it("画面：差と精算の仕方を出す。閲覧の人には記録の欄を出さない", async () => {
    state.user = staff;
    const t = text(await render("2026-10"));
    expect(t).toContain("振り込んだ額と明細の額の差");
    expect(t).toContain("精算の記録がまだの人2人");
    expect(t).toContain("払い足りない 3,000円");
    expect(t).toContain("払いすぎ 2,000円");
    expect(t).toContain("翌月（2026年11月分）の明細で精算する");
    expect(t).toContain("別の方法で精算したと記録する");
    expect(t).toContain("振り込んだ額と明細の額が違う人が 2人います");
    state.user = viewer;
    const v = text(await render("2026-10"));
    expect(v).toContain("振り込んだ額と明細の額の差");
    expect(v).not.toContain("別の方法で精算したと記録する");
    expect(v).toContain("精算の仕方を記録するのは、事務・オーナーの方です");
  });

  it("翌月の明細で精算：翌月に調整を 1 行足し（税・源泉の対象外）、どの版との差かを根拠に残す。二重には記録しない", async () => {
    await expect(
      settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D01, method: "next_month", expectedOutstanding: 2_999 }, staff.id),
    ).rejects.toThrow("画面を開いたあとに差が変わりました");
    const res = await settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D01, method: "next_month", expectedOutstanding: 3_000 }, staff.id);
    expect(res).toMatchObject({ amount: 3_000, method: "next_month", nextMonth: NOV });

    const [adj] = await db.select().from(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, NOV)));
    expect(adj).toMatchObject({ driverId: ids.D01, label: settlementLabel(DEMO_MONTH), amount: 3_000, taxable: false });
    expect(adj.label.length).toBeLessThanOrEqual(60);
    expect(adj.basis).toContain("第1版");
    expect(adj.basis).toContain("第2版");
    expect(adj.basis!.length).toBeLessThanOrEqual(200);
    // 翌月の明細にそのまま載る（消費税・源泉を足さない）
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, NOV));
    const aoki = drafts.find((d) => d.driverId === ids.D01)!;
    expect(aoki.adjustments).toEqual([expect.objectContaining({ label: settlementLabel(DEMO_MONTH), amount: 3_000 })]);
    expect(aoki.adjustmentTax).toBe(0);

    await expect(settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D01, method: "next_month", expectedOutstanding: 3_000 }, staff.id)).rejects.toThrow(
      "まだ精算していない差はありません",
    );
    const r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    const aokiRow = r.rows.find((x) => x.driverCode === "D01")!;
    expect(aokiRow).toMatchObject({ difference: 3_000, settled: 3_000, outstanding: 0 });
    expect(aokiRow.settlements[0]).toMatchObject({ method: "next_month", amount: 3_000, nextMonth: NOV, voided: false, userName: "デモ 事務" });
    expect(r.openCount).toBe(1);

    // 操作の記録：10 月の記録に「どう精算したか」、11 月の記録に調整が残る
    const oct = await searchAuditLog(db, tenantId, { month: DEMO_MONTH });
    expect(oct.rows.find((x) => x.action === "transfer.settle")?.detail).toMatchObject({ method: "next_month", amount: 3_000, nextMonth: NOV, statementVersion: 2 });
    const settleRow = oct.rows.find((x) => x.action === "transfer.settle")!;
    expect(settleRow.label).toBe("振り込んだ額と明細の額の差の精算を記録した");
    expect(settleRow.summary).toBe("青木 翔太さん・差 ＋3,000円・11月分の明細の調整で精算");
    const nov = await searchAuditLog(db, tenantId, { month: NOV });
    expect(nov.rows.find((x) => x.action === "adjustment.add")?.detail).toMatchObject({ source: "transfer.settle", amount: 3_000 });
  });

  it("別の方法で精算した記録：日付が要る。取り消すと、精算していない差に戻る（記録は消さない）", async () => {
    await expect(
      settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D02, method: "outside", expectedOutstanding: -2_000, settledOn: "" }, staff.id),
    ).rejects.toThrow("精算した日");
    await expect(
      settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D02, method: "outside", expectedOutstanding: -2_000, settledOn: "2026-09-30" }, staff.id),
    ).rejects.toThrow("対象の月より前");
    await settlePaidDifference(
      db,
      tenantId,
      DEMO_MONTH,
      { driverId: ids.D02, method: "outside", expectedOutstanding: -2_000, settledOn: "2026-12-10", note: "差額を返してもらった" },
      staff.id,
    );
    let r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    const inoue = r.rows.find((x) => x.driverCode === "D02")!;
    expect(inoue).toMatchObject({ outstanding: 0, settled: -2_000 });
    expect(inoue.settlements[0]).toMatchObject({ method: "outside", settledOn: "2026-12-10", note: "差額を返してもらった" });
    expect(r.openCount).toBe(0);
    expect((await listTransferBatches(db, tenantId, DEMO_MONTH))[0]).toMatchObject({ changed: true, paidDiffOpen: 0 });

    // 翌月の調整で精算したものは、ここでは取り消さない（調整を消すと戻る）
    const aokiSettle = r.rows.find((x) => x.driverCode === "D01")!.settlements[0];
    await expect(undoSettlement(db, tenantId, DEMO_MONTH, aokiSettle.id, staff.id)).rejects.toThrow("稼働と調整");

    await undoSettlement(db, tenantId, DEMO_MONTH, inoue.settlements[0].id, staff.id);
    r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    expect(r.rows.find((x) => x.driverCode === "D02")).toMatchObject({ outstanding: -2_000, settlements: [] });
    await expect(undoSettlement(db, tenantId, DEMO_MONTH, inoue.settlements[0].id, staff.id)).rejects.toThrow("見つかりません");
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.settle_undo")));
    expect(logs).toHaveLength(1);
    const oct = await searchAuditLog(db, tenantId, { month: DEMO_MONTH });
    expect(oct.rows.find((x) => x.action === "transfer.settle" && x.detail.method === "outside")?.summary).toBe("井上 美咲さん・差 −2,000円・別の方法で精算（2026-12-10）");
    expect(oct.rows.find((x) => x.action === "transfer.settle_undo")?.summary).toBe("井上 美咲さん・2026-12-10 の精算の記録");
  });

  it("翌月の調整を消すと、精算になっていないことを出して、また精算できる", async () => {
    const [adj] = await db.select().from(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, NOV)));
    await deleteAdjustment(db, tenantId, adj.id);
    const r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    const aoki = r.rows.find((x) => x.driverCode === "D01")!;
    expect(aoki).toMatchObject({ outstanding: 3_000, settled: 0 });
    expect(aoki.settlements[0]).toMatchObject({ voided: true });
    state.user = staff;
    expect(text(await render("2026-10"))).toContain("その調整が消されています（精算になっていません）");
  });

  it("翌月が締めてあれば、翌月の調整では精算できない（別の方法で記録する）", async () => {
    await db.insert(s.workEntries).values({ tenantId, month: NOV, driverId: ids.D03, projectId: (await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)))[0].id, qty: 10 });
    await closeMonth(db, tenantId, NOV, ownerId, noWatch);
    const r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
    expect(r.nextMonthClosed).toBe(true);
    await expect(settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D01, method: "next_month", expectedOutstanding: 3_000 }, staff.id)).rejects.toThrow(
      "2026年11月は締めてあるため",
    );
    await settlePaidDifference(db, tenantId, DEMO_MONTH, { driverId: ids.D01, method: "outside", expectedOutstanding: 3_000, settledOn: "2026-12-01" }, staff.id);
    expect((await loadPaidDifferences(db, tenantId, DEMO_MONTH)).rows.find((x) => x.driverCode === "D01")).toMatchObject({ outstanding: 0 });
  });
});

describe("作ったときの記録（操作の記録の lines）が無い振込データ", () => {
  it("作った時点の明細の版の振込額を、振り込んだ額として使う", async () => {
    const { db, client } = await createTestDb();
    try {
      const { tenantId } = await seedDemo(db);
      await generateStatements(db, tenantId, DEMO_MONTH);
      const statements = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)));
      const [d01] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
      const aoki = statements.find((x) => x.driverId === d01.id)!;
      // 記録の無い振込データ（この確かめを入れる前に作ったもの）
      await db.insert(s.transferBatches).values({
        tenantId,
        month: DEMO_MONTH,
        transferDate: "2026-11-25",
        executedOn: "2026-11-25",
        statementIds: [aoki.id],
        count: 1,
        total: aoki.total,
        fileName: "振込_2026年10月分_20261125.txt",
      });
      await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, label: "スポット便の追加", amount: 1_500 });
      await generateStatements(db, tenantId, DEMO_MONTH);
      const r = await loadPaidDifferences(db, tenantId, DEMO_MONTH);
      expect(r.rows.map((x) => [x.driverCode, x.paid, x.difference, x.paidVersions])).toEqual([["D01", aoki.total, 1_500, [1]]]);
    } finally {
      await client.close();
    }
  });
});
