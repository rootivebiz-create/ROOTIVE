import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  auditSummary,
  closeMonth,
  loadCloseChecklist,
  monthAuditLog,
  normalizeMinutes,
  OVERRIDE_REASON_MIN,
  reopenMonth,
} from "~/server/features/close";
import type { WatchIssue } from "~/server/features/watch-types";
import { isMonthClosed } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/** 10 月分の振込額の合計（架空の会社 8 人） */
const OCTOBER_TOTAL = 2206094;

const red: WatchIssue = {
  code: "terms_missing",
  severity: "red",
  title: "取引条件の明示の記録が見つかりません",
  detail: "遠藤 大輔さん",
  subjectId: "d04",
  subjectLabel: "遠藤 大輔",
  acked: false,
  blocksClose: true,
};
const watchRed = { runWatch: async () => [red] };
const REASON = "取引条件の書面は 11/10 に渡す予定。支払日に間に合わせるため先に締める";

describe("締め：オーナーが理由を書いて締める・締めにかかった分数", () => {
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

  it("分数：全角でも読み、空は入れない。1〜6000 の整数だけ", () => {
    expect(normalizeMinutes("９０")).toBe(90);
    expect(normalizeMinutes(" 45 ")).toBe(45);
    expect(normalizeMinutes("")).toBeNull();
    expect(normalizeMinutes(null)).toBeNull();
    expect(() => normalizeMinutes("1時間")).toThrow("分の数");
    expect(() => normalizeMinutes("0")).toThrow("1〜6000");
    expect(() => normalizeMinutes("6001")).toThrow("1〜6000");
    expect(() => normalizeMinutes("1.5")).toThrow("分の数");
    // 「1,200」「90分」「９０ 分」も受け取る
    expect(normalizeMinutes("1,200")).toBe(1200);
    expect(normalizeMinutes("90分")).toBe(90);
    expect(normalizeMinutes("９０ 分")).toBe(90);
    expect(() => normalizeMinutes("分")).not.toThrow();
    expect(normalizeMinutes("分")).toBeNull();
  });

  it("赤（未確認）だけが止めているときは「オーナーなら理由を書いて締められる」", async () => {
    const c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, watchRed);
    expect(c.overridable).toBe(true);
    expect(c.blockers.join()).toContain("見張り番の赤い指摘が 1 件");
    // 稼働の無い月は、理由を書いても締められない
    expect((await loadCloseChecklist(db, tenantId, "2026-12-01", watchRed)).overridable).toBe(false);
    // 見張り番が動かないときも、理由では締められない
    const broken = await loadCloseChecklist(db, tenantId, DEMO_MONTH, {
      runWatch: async () => {
        throw new Error("boom");
      },
    });
    expect(broken.overridable).toBe(false);
  });

  it("事務は、理由を書いても赤が残っていれば締められない", async () => {
    await expect(closeMonth(db, tenantId, DEMO_MONTH, staffId, { ...watchRed, role: "staff", overrideReason: REASON })).rejects.toThrow(
      /見張り番の赤い指摘が 1 件あるため、締めていません[\s\S]*オーナーは、理由を書いて締めることもできます[\s\S]*取引条件の明示の記録が見つかりません（遠藤 大輔）/,
    );
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(false);
  });

  it(`オーナーでも、理由が ${OVERRIDE_REASON_MIN} 文字に満たなければ締めない`, async () => {
    await expect(closeMonth(db, tenantId, DEMO_MONTH, ownerId, { ...watchRed, role: "owner" })).rejects.toThrow("理由を 10 文字以上");
    await expect(closeMonth(db, tenantId, DEMO_MONTH, ownerId, { ...watchRed, role: "owner", overrideReason: "急ぐので先に締める" })).rejects.toThrow(
      "理由を 10 文字以上",
    );
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(false);
    expect(await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)))).toHaveLength(0);
  });

  it("オーナーが理由を書けば締められる。理由とそのときの指摘・分数を記録に残し、画面にも出す", async () => {
    const result = await closeMonth(db, tenantId, DEMO_MONTH, ownerId, { ...watchRed, role: "owner", overrideReason: `  ${REASON}  `, minutesSpent: 45 });
    expect(result.total).toBe(OCTOBER_TOTAL);
    expect(await isMonthClosed(db, tenantId, DEMO_MONTH)).toBe(true);
    const [mc] = await db.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    expect(mc.minutesSpent).toBe(45);
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "month.close")));
    expect(log.userId).toBe(ownerId);
    expect(log.detail).toMatchObject({
      minutesSpent: 45,
      override: { reason: REASON, issues: [{ code: "terms_missing", subjectId: "d04", title: "取引条件の明示の記録が見つかりません", subject: "遠藤 大輔" }] },
    });
    const c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, watchRed);
    expect(c.override).toMatchObject({ reason: REASON, byName: "デモ 社長", issues: ["取引条件の明示の記録が見つかりません"] });
    expect(c.minutesSpent).toBe(45);
    expect(c.overridable).toBe(false);
    const [row] = await monthAuditLog(db, tenantId, DEMO_MONTH, 1);
    expect(row.summary).toBe(`8人・振込額の合計 2,206,094円・かかった時間 45分・赤い指摘が残ったまま締めた（理由：${REASON}）`);
    expect(row.actor).toBe("デモ 社長さん");
  });

  it("締めを外した理由は締めの行に残り、締め直しても消えない。分数は入れたときだけ変える", async () => {
    await reopenMonth(db, tenantId, DEMO_MONTH, { id: ownerId, role: "owner" }, "書面を渡したので確認済みにして締め直す");
    let c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, { runWatch: async () => [] });
    expect(c.reopenReason).toBe("書面を渡したので確認済みにして締め直す");
    expect(c.override).toBeNull();
    // 分数を入れずに締め直す → 前の 45 分のまま。赤が無いので理由は要らない（事務でも締められる）
    await closeMonth(db, tenantId, DEMO_MONTH, staffId, { runWatch: async () => [], role: "staff" });
    c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, { runWatch: async () => [] });
    expect(c.minutesSpent).toBe(45);
    expect(c.override).toBeNull();
    expect(c.reopenReason).toBe("書面を渡したので確認済みにして締め直す");
    // 締め直しの記録には「赤が残ったまま」は付かない
    const [last] = await monthAuditLog(db, tenantId, DEMO_MONTH, 1);
    expect(last.action).toBe("month.close");
    expect(last.summary).not.toContain("赤い指摘");
    // 分数を入れて締め直すと入れ替わる
    await reopenMonth(db, tenantId, DEMO_MONTH, { id: ownerId, role: "owner" }, "もう一度だけ直すところがあった");
    await closeMonth(db, tenantId, DEMO_MONTH, ownerId, { runWatch: async () => [], role: "owner", minutesSpent: 20 });
    c = await loadCloseChecklist(db, tenantId, DEMO_MONTH, { runWatch: async () => [] });
    expect(c.minutesSpent).toBe(20);
  });

  it("分数の入れ間違いは締めない", async () => {
    await expect(closeMonth(db, otherTenantId, DEMO_MONTH, null, { runWatch: async () => [], minutesSpent: 0 })).rejects.toThrow("1〜6000");
    expect(await isMonthClosed(db, otherTenantId, DEMO_MONTH)).toBe(false);
  });

  it("他社には、この会社の締め・理由・分数は出ない", async () => {
    const c = await loadCloseChecklist(db, otherTenantId, DEMO_MONTH, watchRed);
    expect(c.closed).toBe(false);
    expect(c.override).toBeNull();
    expect(c.minutesSpent).toBeNull();
    expect((await monthAuditLog(db, otherTenantId, DEMO_MONTH)).some((r) => r.action === "month.close")).toBe(false);
  });

  it("記録の 1 行：締めのまとめ", () => {
    expect(auditSummary("month.close", { drivers: 8, total: 100, minutesSpent: 30 })).toBe("8人・振込額の合計 100円・かかった時間 30分");
    expect(auditSummary("month.close", { drivers: 8, total: 100, override: { reason: "理由です理由です理由" } })).toBe("8人・振込額の合計 100円・赤い指摘が残ったまま締めた（理由：理由です理由です理由）");
  });
});
