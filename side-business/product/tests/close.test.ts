import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { auditLabel, auditSummary, closeMonth, loadCloseChecklist, monthAuditLog, reopenMonth } from "~/server/features/close";
import type { WatchIssue } from "~/server/features/watch-types";
import { pgErrorMessage } from "~/server/db-errors";
import { isMonthClosed } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** 10 月分の振込額の合計（架空の会社 8 人） */
const OCTOBER_TOTAL = 2206094;

function redIssue(acked: boolean): WatchIssue {
  return {
    code: "deduction_unagreed",
    severity: "red",
    title: "合意の記録が無い控除があります",
    detail: "制服代 5,000円",
    subjectId: "rule-1",
    subjectLabel: "木村 誠",
    acked,
    blocksClose: !acked,
  };
}

async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  let msg = "";
  try {
    await p;
  } catch (e) {
    msg = pgErrorMessage(e);
  }
  expect(msg).toMatch(re);
}

describe("月の締め", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;
  let ownerId: string;
  let staffId: string;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    ownerId = users.find((u) => u.role === "owner")!.id;
    staffId = users.find((u) => u.role === "staff")!.id;
  });
  afterAll(async () => client.close());

  it("締める前の確かめ：稼働 11 件・明細は未作成・見張り番の赤・Excel との差", async () => {
    const d02 = (await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D02"))))[0];
    const d01 = (await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01"))))[0];
    await db.insert(s.parallelChecks).values([
      { tenantId, month: DEMO_MONTH, driverId: d01.id, excelTotal: 357555 },
      { tenantId, month: DEMO_MONTH, driverId: d02.id, excelTotal: 357000 },
    ]);
    const c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, { runWatch: async () => [redIssue(false), redIssue(true)] });
    expect(c.closed).toBe(false);
    expect(c.work).toEqual({ entries: 11, drivers: 8, adjustments: 2 });
    expect(c.statements).toMatchObject({ skipped: false, expected: 8, saved: 0, missing: 8, upToDate: false });
    expect(c.watch.blocking).toHaveLength(1);
    expect(c.watch.redAcked).toBe(1);
    expect(c.parallel.rows).toBe(2);
    expect(c.parallel.diffs).toEqual([{ driverId: d02.id, driverName: "井上 美咲", excelTotal: 357000, ourTotal: 357720, diff: 720 }]);
    expect(c.totals).toMatchObject({ drivers: 8, total: OCTOBER_TOTAL });
    expect(c.transfer.batches).toBe(0);
    expect(c.confirm).toEqual({ statements: 0, confirmed: 0, sent: 0 });
    expect(c.blockers.join()).toContain("見張り番の赤い指摘が 1 件");
  });

  it("見張り番の赤（未確認）があると締めない", async () => {
    await expect(closeMonth(db, tenantId, DEMO_MONTH, staffId, { runWatch: async () => [redIssue(false)] })).rejects.toThrow(
      /見張り番の赤い指摘が 1 件[\s\S]*合意の記録が無い控除があります（木村 誠）/,
    );
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(false);
    // 明細も作っていない（途中まで進めない）
    expect(await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)))).toHaveLength(0);
  });

  it("見張り番が動かないときも締めない", async () => {
    await expect(
      closeMonth(db, tenantId, DEMO_MONTH, staffId, {
        runWatch: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("見張り番を確かめられなかった");
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(false);
  });

  it("確認済みにすれば締められる：明細を最新にして 8 人ぶん保存し、そのあと稼働は DB が止める", async () => {
    const result = await closeMonth(db, tenantId, DEMO_MONTH, staffId, { runWatch: async () => [redIssue(true)] });
    expect(result.generated.created).toBe(8);
    expect(result.drivers).toBe(8);
    expect(result.total).toBe(OCTOBER_TOTAL);

    const [mc] = await db.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    expect(mc.status).toBe("closed");
    expect(mc.closedBy).toBe(staffId);
    expect(mc.closedAt).toBeInstanceOf(Date);

    const statements = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)));
    expect(statements).toHaveLength(8);
    expect(statements.reduce((a, r) => a + r.total, 0)).toBe(OCTOBER_TOTAL);

    const d01 = (await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01"))))[0];
    const [project] = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)).limit(1);
    await rejectsWith(db.insert(s.workEntries).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, projectId: project.id, qty: 1 }), /MONTH_CLOSED/);
    await rejectsWith(db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, label: "立替", amount: 100 }), /MONTH_CLOSED/);

    const [closeAudit] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "month.close")));
    expect(closeAudit.detail).toMatchObject({ month: DEMO_MONTH, drivers: 8, total: OCTOBER_TOTAL });
    expect(closeAudit.userId).toBe(staffId);

    const c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, { runWatch: async () => [] });
    expect(c.closed).toBe(true);
    expect(c.closedByName).toBe("デモ 事務");
    expect(c.statements.skipped).toBe(true);
    expect(c.totals.total).toBe(OCTOBER_TOTAL);
    expect(c.confirm.statements).toBe(8);
  });

  it("締めた月をもう一度締めることはできない", async () => {
    await expect(closeMonth(db, tenantId, DEMO_MONTH, staffId, { runWatch: async () => [] })).rejects.toThrow("すでに締めてあります");
    await expect(closeMonth(db, tenantId, DEMO_PREV_MONTH, staffId, { runWatch: async () => [] })).rejects.toThrow("すでに締めてあります");
  });

  it("他社は締まっていない（会社ごとに別々）", async () => {
    expect(await isMonthClosed(db, otherTenantId, DEMO_MONTH)).toBe(false);
    const c = await loadCloseChecklist(db, otherTenantId, DEMO_MONTH, { runWatch: async () => [] });
    expect(c.closed).toBe(false);
    expect(c.parallel.rows).toBe(0);
    expect(c.confirm.statements).toBe(0);
    // 他社の記録は出ない
    expect((await monthAuditLog(db, otherTenantId, DEMO_MONTH)).some((r) => r.action === "month.close")).toBe(false);
    // 他社の月は締めを外せない（締めていない）
    await expect(reopenMonth(db, otherTenantId, DEMO_MONTH, { id: null, role: "owner" }, "他社から外そうとする")).rejects.toThrow("締めていません");
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(true);
  });

  it("締めを外せるのはオーナーだけで、理由が要る", async () => {
    await expect(reopenMonth(db, tenantId, DEMO_MONTH, { id: staffId, role: "staff" }, "稼働の入れ漏れがあったため")).rejects.toThrow("オーナーだけ");
    await expect(reopenMonth(db, tenantId, DEMO_MONTH, { id: ownerId, role: "owner" }, " 直す ")).rejects.toThrow("5 文字以上");
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(true);

    await reopenMonth(db, tenantId, DEMO_MONTH, { id: ownerId, role: "owner" }, "稼働の入れ漏れがあったため");
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(false);
    const [mc] = await db.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    expect(mc.status).toBe("open");
    expect(mc.reopenedAt).toBeInstanceOf(Date);

    // 外したあとは直せる → 明細の版が上がる
    const d01 = (await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01"))))[0];
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, label: "高速代の立替", amount: 1200 });
    await generateStatements(db, tenantId, DEMO_MONTH);
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.driverId, d01.id)));
    expect(st.version).toBe(2);
    expect(st.total).toBe(357555 + 1200);

    // もう一度締める（同じ行を更新する）
    const again = await closeMonth(db, tenantId, DEMO_MONTH, ownerId, { runWatch: async () => [] });
    expect(again.total).toBe(OCTOBER_TOTAL + 1200);
    expect(again.generated.unchanged).toBe(8);
    const closes = await db.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ status: "closed", closedBy: ownerId });
  });

  it("この月の操作の記録を、読める日本語で返す", async () => {
    const log = await monthAuditLog(db, tenantId, DEMO_MONTH);
    const actions = log.map((r) => r.action);
    expect(actions[0]).toBe("month.close");
    expect(actions).toContain("month.reopen");
    expect(actions).toContain("statement.generate");
    const reopen = log.find((r) => r.action === "month.reopen")!;
    expect(reopen.label).toBe("締めを外した");
    expect(reopen.summary).toBe("理由：稼働の入れ漏れがあったため");
    expect(reopen.userName).toBe("デモ 社長");
    expect(log[0].summary).toBe(`8人・振込額の合計 ${(OCTOBER_TOTAL + 1200).toLocaleString("ja-JP")}円`);
    expect(log.length).toBeLessThanOrEqual(50);
    // 9 月の記録には 10 月のものが混ざらない
    expect((await monthAuditLog(db, tenantId, DEMO_PREV_MONTH)).some((r) => r.action === "month.reopen")).toBe(false);
  });

  it("稼働も調整も無い月は締めない", async () => {
    await expect(closeMonth(db, tenantId, "2026-12-01", staffId, { runWatch: async () => [] })).rejects.toThrow("稼働も調整もありません");
    expect(await isMonthClosed(db, tenantId, "2026-12-01")).toBe(false);
  });

  it("操作の名前の読み替え", () => {
    expect(auditLabel("transfer.create")).toBe("振込データを作った");
    expect(auditLabel("work.bulk_something")).toBe("稼働の操作");
    expect(auditLabel("unknown")).toBe("操作");
    expect(auditSummary("transfer.create", { fileName: "振込_2026年10月分_20261125.txt", count: 7, total: 2171664 })).toBe(
      "振込_2026年10月分_20261125.txt・7人・2,171,664円",
    );
    expect(auditSummary("statement.generate", { created: 8, updated: 0, unchanged: 0, removed: 0 })).toBe("新しく 8人");
  });
});
