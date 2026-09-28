import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { goLive, goLiveFrom, goLiveGate, loadParallelReport, saveParallelChecks } from "~/server/features/parallel";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";
import type { Db } from "~/db/client";

async function driverIds(db: Db, tenantId: string): Promise<Record<string, string>> {
  const rows = await db.select({ id: s.drivers.id, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  return Object.fromEntries(rows.map((r) => [r.code!, r.id]));
}

const row = (name: string, ours: number | null, excel: number | null, note: string | null = null, extra: Partial<{ stale: boolean; explanations: { title: string }[] }> = {}) => ({
  driverId: `id-${name}`,
  name,
  ours,
  excelTotal: excel,
  diff: excel === null ? null : (ours ?? 0) - excel,
  note,
  ...extra,
});

describe("本番に切り替える条件（純関数 goLiveGate）", () => {
  it("比べた人がいない → 押せない。差があってメモの無い人 → 押せない（差の大きい順に名前と原因の候補）", () => {
    const empty = goLiveGate([row("青木", 100, null)]);
    expect(empty.ready).toBe(false);
    expect(empty.blockers).toEqual(["まだ Excel の振込額を 1 人も入れていません。Excel の額を入れて比べてから切り替えてください。"]);
    expect(empty.notEntered).toEqual([{ driverId: "id-青木", name: "青木" }]);

    const g = goLiveGate(
      [
        row("青木", 357_555, 357_555),
        row("井上", 357_720, 372_720, null, { explanations: [{ title: "「管理費」の控除" }] }),
        row("上田", 245_740, 245_739),
        row("岡田", 368_709, 368_708, "Excel の端数を四捨五入に直す"),
        row("加藤", 171_600, null),
        row("木村", 34_430, 34_430, null, { stale: true }),
      ],
      1,
    );
    expect(g.ready).toBe(false);
    expect(g.missingNotes).toEqual([
      { driverId: "id-井上", name: "井上", diff: -15_000, candidate: "「管理費」の控除" },
      { driverId: "id-上田", name: "上田", diff: 1, candidate: null },
    ]);
    expect(g.blockers).toEqual(["差があって、理由のメモがまだ無い人が 2人います（井上さん −15,000円・上田さん 1円）。どちらに合わせるかを決めて、メモに残してください。"]);
    expect(g.explained).toEqual([{ driverId: "id-岡田", name: "岡田", diff: 1, note: "Excel の端数を四捨五入に直す" }]);
    expect(g).toMatchObject({ compared: 5, matched: 2, stale: 1, streak: 1, streakOk: false });
    expect(g.notEntered.map((n) => n.name)).toEqual(["加藤"]);
    expect(g.cautions).toEqual([
      "Excel の額をまだ入れていない人が 1人います（加藤さん）。この人たちは比べていません。",
      "明細を作ったあとに稼働・設定が変わった人が 1人います。比べているのは保存した明細の額です。",
      "続けて一致（または説明済み）の月は 1 か月です。目安の 2〜3 か月に届いていません。",
    ]);
  });

  it("全員一致、または差のある人全員にメモ → 押せる（未入力の人・続けての月数は知らせるだけ）。空白だけのメモは無いのと同じ", () => {
    const ok = goLiveGate([row("青木", 100, 100), row("井上", 200, 150, "Excel で管理費を引き忘れ。しめ日ラボに合わせる"), row("加藤", 50, null)], 2);
    expect(ok.ready).toBe(true);
    expect(ok.blockers).toEqual([]);
    expect(ok.streakOk).toBe(true);
    expect(ok.cautions).toEqual(["Excel の額をまだ入れていない人が 1人います（加藤さん）。この人たちは比べていません。"]);
    expect(goLiveGate([row("井上", 200, 150, "   ")], 3).ready).toBe(false);
    expect(goLiveGate([row("青木", 100, 100)], 3)).toMatchObject({ ready: true, cautions: [] });
    // しめ日ラボに額が無い人（明細なし）の未入力は数えない
    expect(goLiveGate([row("青木", 100, 100), row("辞めた人", null, null)], 3).notEntered).toEqual([]);
  });

  it("本番に切り替えた月は onboarding.golive の YYYY-MM-01 だけ", () => {
    expect(goLiveFrom({ golive: "2026-10-01" })).toBe("2026-10-01");
    expect(goLiveFrom({ golive: "2026-10" })).toBeNull();
    expect(goLiveFrom({})).toBeNull();
    expect(goLiveFrom(null)).toBeNull();
  });
});

describe("本番に切り替える（DB）と並行運用レポートの中身", () => {
  it("メモの無い人の名前を出して止める。メモが付くと記録し、差のあった人とメモを操作の記録に残す。ほかの会社には残らない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const ids = await driverIds(db, tenantId);
    // 青木は一致、井上は Excel が管理費を引き忘れ（Excel の方が 15,000円多い）、上田は 11,000円の調整が Excel に無い
    await saveParallelChecks(db, tenantId, DEMO_MONTH, [
      { driverId: ids.D01, excelTotal: 357_555 },
      { driverId: ids.D02, excelTotal: 372_720 },
      { driverId: ids.D03, excelTotal: 256_740 },
    ]);
    let r = await loadParallelReport(db, tenantId, DEMO_MONTH);
    expect(r.companyName).toBe("サンプル運送株式会社（架空）");
    expect(r.totals).toEqual({ ours: 357_555 + 357_720 + 245_740, excel: 357_555 + 372_720 + 256_740 });
    expect(r.view.summary).toMatchObject({ compared: 3, matched: 1, different: 2, diffTotal: -26_000, oursHigher: 0, excelHigher: 26_000 });
    expect(r.gate.ready).toBe(false);
    expect(r.gate.missingNotes.map((m) => [m.name, m.diff, m.candidate])).toEqual([
      ["井上 美咲", -15_000, "「管理費」の控除"],
      ["上田 健", -11_000, "「車両修理の負担分」の調整"],
    ]);
    expect(r.gate.notEntered).toHaveLength(5);
    await expect(goLive(db, tenantId, DEMO_MONTH, null)).rejects.toThrow("理由のメモがまだ無い人が 2人います（井上 美咲さん・上田 健さん）");
    expect(r.golive).toBeNull();

    await saveParallelChecks(db, tenantId, DEMO_MONTH, [
      { driverId: ids.D02, excelTotal: 372_720, note: "Excel で管理費を引き忘れていた。しめ日ラボに合わせる" },
      { driverId: ids.D03, excelTotal: 256_740, note: "修理の負担分を Excel に入れ忘れ" },
    ]);
    r = await loadParallelReport(db, tenantId, DEMO_MONTH);
    expect(r.gate).toMatchObject({ ready: true, blockers: [], streak: 1, streakOk: false });
    await goLive(db, tenantId, DEMO_MONTH, null);
    r = await loadParallelReport(db, tenantId, DEMO_MONTH);
    expect(r.golive).toBe(DEMO_MONTH);
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "parallel.golive")));
    expect(log.detail).toMatchObject({
      compared: 3,
      matched: 1,
      explained: 2,
      streak: 1,
      was: null,
      notEntered: 5,
      diffTotal: -26_000,
      notes: [
        { driverId: ids.D02, name: "井上 美咲", diff: -15_000, note: "Excel で管理費を引き忘れていた。しめ日ラボに合わせる" },
        { driverId: ids.D03, name: "上田 健", diff: -11_000, note: "修理の負担分を Excel に入れ忘れ" },
      ],
    });

    // ほかの会社：比べていないので止まる。切り替えの記録も無い
    const o = await loadParallelReport(db, otherId, DEMO_MONTH);
    expect(o.golive).toBeNull();
    expect(o.view.summary.compared).toBe(0);
    await expect(goLive(db, otherId, DEMO_MONTH, null)).rejects.toThrow("まだ Excel の額を入れていません");
    expect(await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, otherId), eq(s.auditLog.action, "parallel.golive")))).toHaveLength(0);

    // 締めた 9 月も同じ中身で読める
    const sep = await loadParallelReport(db, tenantId, DEMO_PREV_MONTH);
    expect(sep.view.closed).toBe(true);
    expect(sep.gate.compared).toBe(0);
    await client.close();
  });
});
