import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import {
  clearParallelChecks,
  explainDiff,
  goLive,
  goLiveMonth,
  loadParallel,
  parallelHistory,
  parallelSummary,
  partsOf,
  readParallelFile,
  readParallelPaste,
  saveParallelChecks,
  undoGoLive,
} from "~/server/features/parallel";
import { readAmountTable } from "~/server/features/parallel/paste";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";
import type { Db } from "~/db/client";

async function draftsByCode(db: Db, tenantId: string, month = DEMO_MONTH) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  return Object.fromEntries(drafts.map((d) => [d.driver.code!, d]));
}

async function driverIds(db: Db, tenantId: string): Promise<Record<string, string>> {
  const rows = await db.select({ id: s.drivers.id, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  return Object.fromEntries(rows.map((r) => [r.code!, r.id]));
}

describe("差の理由の見当（デモの 10 月の額で）", () => {
  it("消費税・控除・調整・端数・源泉徴収・どれでもない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const D = await draftsByCode(db, tenantId);

    // 青木：357,555 円。Excel が消費税 37,450 円を足していない（Excel = 357,555 − 37,450）
    expect(D.D01.total).toBe(357_555);
    expect(D.D01.tax).toBe(37_450);
    const aoki = explainDiff(partsOf(D.D01), 357_555 - 320_105);
    expect(aoki[0].kind).toBe("tax");
    expect(aoki[0].title).toBe("消費税の扱いが違う可能性");
    expect(aoki[0].detail).toContain("しめ日ラボの方が 37,450円 多く");
    expect(aoki[0].detail).toContain("委託料の消費税（37,450円）");
    // ロイヤリティ（委託料の 10%）も同じ額なので、ほかの候補として出す
    expect(aoki.map((e) => e.title)).toContain("「ロイヤリティ」の控除");

    // 井上：Excel が管理費 15,000 円を引いていない（Excel の方が多い）
    expect(D.D02.total).toBe(357_720);
    const inoue = explainDiff(partsOf(D.D02), 357_720 - 372_720);
    expect(inoue[0]).toMatchObject({ kind: "deduction", title: "「管理費」の控除" });
    expect(inoue[0].detail).toContain("Excel の方が 15,000円 多く");
    expect(inoue[0].detail).toContain("Excel で「管理費」を引いていない可能性");
    // 管理費の消費税 1,500 円だけの差
    expect(explainDiff(partsOf(D.D02), -1_500)[0].detail).toContain("「管理費」の控除の消費税（1,500円）");

    // 上田：車両修理の負担分 −11,000 円が Excel に入っていない
    expect(D.D03.total).toBe(245_740);
    const ueda = explainDiff(partsOf(D.D03), 245_740 - 256_740);
    expect(ueda[0]).toMatchObject({ kind: "adjustment", title: "「車両修理の負担分」の調整" });

    // 岡田：1 円の差は端数（明細の行 2・控除 2・消費税 2 の 6 か所）
    expect(D.D05.total).toBe(368_709);
    const okada = explainDiff(partsOf(D.D05), 368_709 - 368_708);
    expect(okada[0].kind).toBe("rounding");
    expect(okada[0].title).toBe("端数の処理の違い（四捨五入・切り捨て）");
    expect(okada[0].detail).toContain("6 か所");
    expect(explainDiff(partsOf(D.D05), 7)[0].kind).toBe("unknown");

    // どれでもない差
    const other = explainDiff(partsOf(D.D08), 12_345);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ kind: "unknown", title: "内訳を確かめてください" });
    expect(explainDiff(partsOf(D.D08), 0)[0].kind).toBe("match");
    expect(explainDiff(null, -50_000)[0].kind).toBe("no_data");

    // 源泉徴収：加藤さんを 1 号（デザイン等）にすると 190,000 × 10.21% = 19,399 円を引く
    const ids = await driverIds(db, tenantId);
    await db.update(s.drivers).set({ withholdingCategory: "ko1" }).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, ids.D06)));
    const W = await draftsByCode(db, tenantId);
    expect(W.D06.withholding?.amount).toBe(19_399);
    expect(W.D06.total).toBe(171_600 - 19_399);
    const kato = explainDiff(partsOf(W.D06), W.D06.total - 171_600);
    expect(kato[0]).toMatchObject({ kind: "withholding", title: "源泉徴収" });
    expect(kato[0].detail).toContain("19,399円");
    await client.close();
  });

  it("数量・単価の違い：Excel の稼働が 1 日少ない・単価が 5 円違う（計算し直した額で）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const ids = await driverIds(db, tenantId);
    const input = await loadBuildInput(db, tenantId, DEMO_MONTH);
    const D = Object.fromEntries(buildStatementDrafts(input).map((d) => [d.driver.code!, d]));
    const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));

    // 井上：Excel は企業配を 20 日で計算（しめ日ラボは 21 日）→ 消費税・ロイヤリティを入れて 17,820 円の差
    const fewer = buildStatementDrafts({ ...input, work: input.work.map((w) => (w.driverId === ids.D02 ? { ...w, qty: 20 } : w)) });
    const inoueDiff = D.D02.total - fewer.find((d) => d.driverId === ids.D02)!.total;
    expect(inoueDiff).toBe(17_820);
    const inoue = explainDiff(partsOf(D.D02), inoueDiff);
    expect(inoue[0]).toMatchObject({ kind: "qty", title: "「企業配（日当）」の数量" });
    expect(inoue[0].detail).toContain("しめ日ラボの方が「企業配（日当）」を 1日 多く数えている可能性");
    expect(inoue[0].detail).toContain("1日 × 18,000円 ＝ 18,000円（消費税・率で引く控除を入れると 17,820円）");

    // 青木：Excel は宅配を 1 個 155 円で計算（しめ日ラボは 150 円）→ Excel の方が 11,435 円多い
    const higher = buildStatementDrafts({ ...input, overrides: [...input.overrides, { driverId: ids.D01, projectId: takuhai.id, payRate: 155 }] });
    const aokiDiff = D.D01.total - higher.find((d) => d.driverId === ids.D01)!.total;
    expect(aokiDiff).toBe(-11_435);
    const aoki = explainDiff(partsOf(D.D01), aokiDiff);
    const price = aoki.find((e) => e.kind === "price");
    expect(price?.title).toBe("「宅配（個建て）」の単価");
    expect(price?.detail).toContain("Excel の方が「宅配（個建て）」の単価が 1個あたり 5円 高い可能性");
    await client.close();
  });

  it("「8人中 6人が一致」と差の合計（Excel の額を入れた人だけ数える）", () => {
    expect(parallelSummary([]).sentence).toBe("まだ比べていません");
    const rows = [
      ...Array.from({ length: 6 }, () => ({ excelTotal: 1, diff: 0 })),
      { excelTotal: 1, diff: 5, note: "Excel の端数を直す" },
      { excelTotal: 1, diff: -3 },
      { excelTotal: null, diff: null },
    ];
    expect(parallelSummary(rows)).toEqual({
      compared: 8,
      matched: 6,
      different: 2,
      unexplained: 1,
      diffTotal: 2,
      oursHigher: 5,
      excelHigher: 3,
      allExplained: false,
      sentence: "8人中 6人が一致",
    });
  });
});

describe("Excel の額を入れる・読む（DB）", () => {
  it("保存 → 差と理由 → 明細を作ると明細の額で比べる → 消す。ほかの会社は読めない・書けない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const ids = await driverIds(db, tenantId);
    const otherIds = await driverIds(db, otherId);

    let v = await loadParallel(db, tenantId, DEMO_MONTH);
    expect(v.rows).toHaveLength(8);
    expect(v.rows.every((r) => r.source === "draft" && r.excelTotal === null)).toBe(true);
    expect(v.summary.sentence).toBe("まだ比べていません");
    expect(v.rows[0].name).toBe("青木 翔太"); // よみの順

    await saveParallelChecks(db, tenantId, DEMO_MONTH, [
      { driverId: ids.D01, excelTotal: 320_105, note: "Excel は税抜で計算" },
      { driverId: ids.D02, excelTotal: 357_720 },
      { driverId: ids.D03, excelTotal: 256_740 },
    ]);
    v = await loadParallel(db, tenantId, DEMO_MONTH);
    expect(v.summary.sentence).toBe("3人中 1人が一致");
    const aoki = v.rows.find((r) => r.driverId === ids.D01)!;
    expect(aoki).toMatchObject({ ours: 357_555, excelTotal: 320_105, diff: 37_450, note: "Excel は税抜で計算", source: "draft" });
    expect(aoki.explanations[0].kind).toBe("tax");
    expect(v.rows.find((r) => r.driverId === ids.D03)!.explanations[0].kind).toBe("adjustment");

    // 上書き（同じ人・同じ月は 1 行）と、null で消す
    await saveParallelChecks(db, tenantId, DEMO_MONTH, [
      { driverId: ids.D01, excelTotal: 357_555 },
      { driverId: ids.D03, excelTotal: null },
    ]);
    v = await loadParallel(db, tenantId, DEMO_MONTH);
    expect(v.summary.sentence).toBe("2人中 2人が一致");
    expect((await db.select().from(s.parallelChecks).where(eq(s.parallelChecks.tenantId, tenantId))).length).toBe(2);

    // 明細を作ると、保存した明細の額で比べる。作ったあとで稼働が変わると知らせる
    await generateStatements(db, tenantId, DEMO_MONTH);
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: ids.D01, label: "高速代の立替", amount: 1_200 });
    v = await loadParallel(db, tenantId, DEMO_MONTH);
    const aoki2 = v.rows.find((r) => r.driverId === ids.D01)!;
    expect(aoki2).toMatchObject({ source: "saved", ours: 357_555, stale: true, draftTotal: 358_755, diff: 0 });

    // ほかの会社の人の id では書けない。ほかの会社からは見えない
    await expect(saveParallelChecks(db, tenantId, DEMO_MONTH, [{ driverId: otherIds.D01, excelTotal: 1 }])).rejects.toThrow("ドライバーが見つかりません");
    await expect(saveParallelChecks(db, tenantId, DEMO_MONTH, [{ driverId: "not-a-uuid", excelTotal: 1 }])).rejects.toThrow("ドライバーが見つかりません");
    await expect(saveParallelChecks(db, tenantId, DEMO_MONTH, [{ driverId: ids.D01, excelTotal: 1.5 }])).rejects.toThrow("1 円単位");
    const other = await loadParallel(db, otherId, DEMO_MONTH);
    expect(other.rows.every((r) => r.excelTotal === null)).toBe(true);
    expect(other.summary.compared).toBe(0);

    // 消す（この会社・この月だけ）
    await saveParallelChecks(db, otherId, DEMO_MONTH, [{ driverId: otherIds.D01, excelTotal: 357_555 }]);
    expect(await clearParallelChecks(db, tenantId, DEMO_MONTH)).toBe(2);
    expect((await loadParallel(db, tenantId, DEMO_MONTH)).summary.compared).toBe(0);
    expect((await loadParallel(db, otherId, DEMO_MONTH)).summary.compared).toBe(1);
    const log = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "parallel.save")));
    expect(log).toHaveLength(2);
    await client.close();
  });

  it("Excel をやめる記録：差に理由のメモが無いと記録しない。続けて一致の月を数える。ほかの会社には残らない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const ids = await driverIds(db, tenantId);
    await expect(goLive(db, tenantId, DEMO_MONTH)).rejects.toThrow("まだ Excel の額を入れていません");
    await saveParallelChecks(db, tenantId, DEMO_MONTH, [
      { driverId: ids.D01, excelTotal: 357_555 },
      { driverId: ids.D02, excelTotal: 372_720 },
    ]);
    await expect(goLive(db, tenantId, DEMO_MONTH)).rejects.toThrow("理由のメモがまだ無い人が 1人");
    let h = await parallelHistory(db, tenantId, DEMO_MONTH);
    expect(h.months.map((m) => m.state)).toEqual(["diff", "none", "none"]);
    expect(h.streak).toBe(0);

    await saveParallelChecks(db, tenantId, DEMO_MONTH, [{ driverId: ids.D02, excelTotal: 372_720, note: "Excel で管理費を引き忘れていた。しめ日ラボに合わせる" }]);
    await saveParallelChecks(db, tenantId, DEMO_PREV_MONTH, [{ driverId: ids.D01, excelTotal: 338_415 }]);
    h = await parallelHistory(db, tenantId, DEMO_MONTH);
    expect(h.months.map((m) => m.state)).toEqual(["ok", "ok", "none"]);
    expect(h.streak).toBe(2);

    await goLive(db, tenantId, DEMO_MONTH, null);
    expect(await goLiveMonth(db, tenantId)).toBe(DEMO_MONTH);
    expect(await goLiveMonth(db, otherId)).toBeNull();
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "parallel.golive")));
    expect(log.detail).toMatchObject({ compared: 2, matched: 1, explained: 1, streak: 2 });
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t.onboarding).toMatchObject({ parallel: "done", golive: DEMO_MONTH });
    await undoGoLive(db, tenantId, null);
    expect(await goLiveMonth(db, tenantId)).toBeNull();
    await client.close();
  });

  it("締めた月（9 月）にも入れられる。明細の保存が無い月は、今の稼働から出した額と比べる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const ids = await driverIds(db, tenantId);
    await saveParallelChecks(db, tenantId, DEMO_PREV_MONTH, [{ driverId: ids.D01, excelTotal: 338_415 }]);
    const v = await loadParallel(db, tenantId, DEMO_PREV_MONTH);
    expect(v.closed).toBe(true);
    const aoki = v.rows.find((r) => r.driverId === ids.D01)!;
    expect(aoki).toMatchObject({ ours: 338_415, source: "draft", stale: false, diff: 0 });
    expect(v.summary.sentence).toBe("1人中 1人が一致");
    await client.close();
  });

  it("貼り付け：2 列・表記ゆれ・全角・当たらない名前。見出しつきの表は振込額の列を選ぶ。ファイルも読む", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const ids = await driverIds(db, tenantId);

    const two = await readParallelPaste(db, tenantId, "青木翔太\t357,555\nいのうえ みさき\t３５７，７２０円\nD03\t245740\n知らない 人\t1000\n青木 翔太\t1\n合計\t9999");
    expect(two.headerRow).toBeNull();
    expect(two).toMatchObject({ nameCol: 0, amountCol: 1, matched: 3, unmatched: 2 });
    expect(two.rows.filter((r) => !r.problem).map((r) => [r.driverId, r.amount])).toEqual([
      [ids.D01, 357_555],
      [ids.D02, 357_720],
      [ids.D03, 245_740],
    ]);
    expect(two.rows[3].problem).toContain("見つかりません");
    expect(two.rows[4].problem).toContain("もう 1 行");

    // 振込の一覧（列がたくさん）：「振込額」の列を選ぶ
    const wide = await readParallelPaste(
      db,
      tenantId,
      ["10月分 支払一覧", "", "No\t氏名\t委託料\t消費税\t控除\t振込額", "1\t青木 翔太\t374,500\t37,450\t57,695\t357,555", "2\t上田 健\t276,000\t27,600\t46,860\t245,740"].join("\n"),
    );
    expect(wide).toMatchObject({ headerRow: 3, nameCol: 1, amountCol: 5, matched: 2 });
    expect(wide.rows[0].amount).toBe(357_555);
    // 表の上に「ドライバー支払一覧」のような題があっても、題の行を見出しにしない（委託料の列を振込額と取り違えない）
    const titled = await readParallelPaste(db, tenantId, ["ドライバー支払一覧（10月分）", "氏名\t委託料\t振込額", "青木 翔太\t374,500\t357,555"].join("\n"));
    expect(titled).toMatchObject({ headerRow: 2, nameCol: 0, amountCol: 2, matched: 1 });
    expect(titled.rows[0]).toMatchObject({ driverId: ids.D01, amount: 357_555 });
    // 列を選び直す
    const chosen = await readParallelPaste(db, tenantId, ["No\t氏名\t委託料\t振込額", "1\t青木 翔太\t374,500\t357,555"].join("\n"), { amountCol: 2 });
    expect(chosen.rows[0].amount).toBe(374_500);

    // 見出しが無く、数の列がいくつもある：いちばん右の数の列
    const t = readAmountTable([["青木 翔太", "374500", "357555"]], [{ id: "x", name: "青木 翔太" }]);
    expect(t).toMatchObject({ nameCol: 0, amountCol: 2 });

    // ファイル（CSV）
    const csv = new TextEncoder().encode("名前,振込額\r\n青木 翔太,357555\r\n");
    const f = await readParallelFile(db, tenantId, "10月振込.csv", csv);
    expect(f.matched).toBe(1);
    expect(f.rows[0]).toMatchObject({ driverId: ids.D01, amount: 357_555 });

    // ほかの会社の名前は当たらない（その会社のドライバーだけを見る）
    const { tenantId: otherId } = await seedDemo(db);
    const o = await readParallelPaste(db, otherId, "青木 翔太\t1");
    expect(o.rows[0].driverId).not.toBe(ids.D01);
    await expect(readParallelPaste(db, tenantId, "   ")).rejects.toThrow("貼り付けてください");
    await client.close();
  });
});
