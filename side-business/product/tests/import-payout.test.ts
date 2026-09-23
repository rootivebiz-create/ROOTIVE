import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import { readPayout } from "~/server/features/import/columns";
import { loadParallel } from "~/server/features/parallel";
import { applyBatch, createDraftFromFile, loadDraftView } from "~/server/features/import/service";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 振込額の列 → 並行運用（SPEC P0-9.1）：稼働の Excel に「差引支給額」などの列があれば、反映のあとで
 * parallel_checks.excel_total に入れる。縦持ちの表でも 1 人 1 回。理由のメモが付いている人は上書きしない。
 */

const enc = (t: string) => new TextEncoder().encode(t);

async function octoberTotals(db: Db, tenantId: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
  return new Map(drafts.map((d) => [d.driver.name, d.total]));
}

async function checks(db: Db, tenantId: string) {
  const rows = await db
    .select({ driverId: s.parallelChecks.driverId, excelTotal: s.parallelChecks.excelTotal, note: s.parallelChecks.note, name: s.drivers.name })
    .from(s.parallelChecks)
    .innerJoin(s.drivers, eq(s.drivers.id, s.parallelChecks.driverId))
    .where(and(eq(s.parallelChecks.tenantId, tenantId), eq(s.parallelChecks.month, DEMO_MONTH)));
  return Object.fromEntries(rows.map((r) => [r.name, { excelTotal: r.excelTotal, note: r.note }]));
}

/** 縦持ち（1 行 1 件）。人ごとの差引支給額を、その人の行すべてに書き写した Excel（よくある形） */
function longCsv(totals: Map<string, number>, tweak: Record<string, number> = {}): Uint8Array {
  const rows: [string, string, number][] = [
    ["青木 翔太", "宅配", 2310],
    ["青木 翔太", "スポット", 4],
    ["井上 美咲", "企業配", 21],
    ["上田 健", "宅配", 1840],
    ["遠藤 大輔", "ルート", 168],
    ["遠藤 大輔", "スポット便", 2],
    ["岡田 拓也", "企業配", 18],
    ["岡田 拓也", "宅配", 420],
    ["加藤 由美", "夜間", 20],
    ["木村 誠", "宅配", 380],
    ["佐藤 亮", "企業配", 22],
  ];
  const lines = ["2026年10月 稼働集計", "No,ドライバー,コース,個数・日数,差引支給額"];
  rows.forEach(([name, project, qty], i) => lines.push([i + 1, name, project, qty, (totals.get(name) ?? 0) + (tweak[name] ?? 0)].join(",")));
  return enc(lines.join("\n") + "\n");
}

describe("振込額の列を読む（純関数）", () => {
  it("人ごとの額が毎行にあっても 1 人 1 回。同じ人の行で額が違えば、行ごとの額なので振込額とみなさない", () => {
    const mapping = { headerRow: 0, headerDepth: 1 as const, roles: ["driver", "project", "qty", "ignore"] as never, fixedProjectId: null, useDates: false };
    const names = new Map([
      ["a", "青木 翔太"],
      ["b", "井上 美咲"],
    ]);
    const resolved = [
      { rowNo: 2, driverId: "a" },
      { rowNo: 3, driverId: "a" },
      { rowNo: 4, driverId: "b" },
    ];
    const once = readPayout(
      [["氏名", "案件", "個数", "振込額"], ["青木", "宅配", "2310", "¥357,555"], ["青木", "スポット", "4", "357,555"], ["井上", "企業配", "21", "401,940"]],
      mapping,
      ["氏名", "案件", "個数", "振込額"],
      resolved,
      names,
    )!;
    expect(once.header).toBe("振込額");
    expect(once.perRow).toBe(false);
    expect(once.entries).toEqual([
      { driverId: "b", name: "井上 美咲", amount: 401940 },
      { driverId: "a", name: "青木 翔太", amount: 357555 },
    ]);
    const perRow = readPayout(
      [["氏名", "案件", "個数", "支払額"], ["青木", "宅配", "2310", "346500"], ["青木", "スポット", "4", "28000"], ["井上", "企業配", "21", "378000"]],
      mapping,
      ["氏名", "案件", "個数", "支払額"],
      resolved,
      names,
    )!;
    expect(perRow.perRow).toBe(true);
    expect(perRow.entries).toEqual([]);
    // 振込額らしい列が無ければ null
    expect(readPayout([["氏名", "案件", "個数"]], mapping, ["氏名", "案件", "個数"], resolved, names)).toBeNull();
  });
});

describe("振込額の列 → 並行運用の比べ合わせ（DB）", () => {
  it("反映すると 8 人ぶんの Excel の振込額が入り、しめ日ラボと 1 円まで一致する。メモのある人は上書きしない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: other } = await seedDemo(db);
    const totals = await octoberTotals(db, tenantId);
    expect(totals.get("青木 翔太")).toBe(357555);
    const aoki = (await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01"))))[0];
    // 青木さんには、前に比べたときの理由のメモがある
    await db.insert(s.parallelChecks).values({ tenantId, month: DEMO_MONTH, driverId: aoki.id, excelTotal: 357000, note: "Excel は駐車場代の立替を入れ忘れ" });

    // 木村さんだけ、Excel の額が 1 円違う
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "稼働と支給_2026年10月.csv", bytes: longCsv(totals, { "木村 誠": 1 }), pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, d.id))!;
    expect(view.blockers).toEqual([]);
    expect(view.extras!.payout).toMatchObject({ header: "差引支給額", perRow: false });
    expect(view.extras!.payout!.entries).toHaveLength(8);
    // 数量としては読んでいない（稼働は 11 件・5,205）
    expect(view.stats).toMatchObject({ records: 11, totalQty: 5205 });

    const res = await applyBatch(db, tenantId, { id: null }, d.id, { mode: "replaceAll", confirmDuplicates: false });
    expect(res.payouts).toMatchObject({ header: "差引支給額", saved: 7, kept: ["青木 翔太"] });
    const saved = await checks(db, tenantId);
    expect(saved["青木 翔太"]).toEqual({ excelTotal: 357000, note: "Excel は駐車場代の立替を入れ忘れ" });
    expect(saved["木村 誠"].excelTotal).toBe(totals.get("木村 誠")! + 1);
    expect(saved["井上 美咲"].excelTotal).toBe(totals.get("井上 美咲"));
    expect(Object.keys(saved)).toHaveLength(8);
    // 反映済みの取り込みにも残る（画面の「今の Excel の振込額も読みました（7人）」）
    const after = (await loadDraftView(db, tenantId, d.id))!;
    expect(after.summary.applied!.payouts).toMatchObject({ saved: 7, kept: ["青木 翔太"] });

    // 並行運用の画面：6 人一致（青木さんは前の額・木村さんは 1 円差）
    const par = await loadParallel(db, tenantId, DEMO_MONTH);
    const diff = Object.fromEntries(par.rows.filter((r) => r.excelTotal !== null).map((r) => [r.name, r.diff]));
    expect(diff["木村 誠"]).toBe(-1);
    expect(diff["青木 翔太"]).toBe(555);
    expect(Object.values(diff).filter((v) => v === 0)).toHaveLength(6);

    // 別の会社の比べ合わせには何も入らない
    expect(await checks(db, other)).toEqual({});
    await client.close();
  });

  it("振込額の列が無いファイルでは、比べ合わせに何も入れない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "応援.csv", bytes: enc("ドライバー,コース,個数\n青木 翔太,宅配,10\n"), pageMonth: "2026-11-01" });
    const res = await applyBatch(db, tenantId, { id: null }, d.id, { mode: "add", confirmDuplicates: false });
    expect(res.payouts).toBeUndefined();
    const rows = await db.select().from(s.parallelChecks).where(eq(s.parallelChecks.tenantId, tenantId));
    expect(rows).toEqual([]);
    await client.close();
  });
});
