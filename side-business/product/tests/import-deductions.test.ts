import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import { adoptDeductionProposal, PROPOSAL_BASIS } from "~/server/features/import/adopt";
import { classifyMoneyHeader, findMoneyColumns, perDriverValues } from "~/server/features/import/columns";
import { guessText, inferDeductionRule, type DeductionObservation } from "~/server/features/import/deductions";
import { applyBatch, createDraftFromFile, loadDraftView } from "~/server/features/import/service";
import { runWatch } from "~/server/features/watch";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 控除の提案（SPEC P0-3.1〜3.4）：Excel の控除の列の値から、式（率・定額・数量 × 単価）を読み取る。
 * 振込手数料の列は、控除のルールにしない。
 */

/** 12 人：委託料は 30 万円から 1 万円ずつ違う・数量も人ごとに違う */
function twelve(value: (base: number, qty: number, i: number) => number): DeductionObservation[] {
  return Array.from({ length: 12 }, (_, i) => {
    const base = 300000 + i * 10000 + 37;
    const qty = 1500 + i * 37;
    return { driverId: `d${i + 1}`, name: `ドライバー${String(i + 1).padStart(2, "0")}`, value: value(base, qty, i), base, qty };
  });
}

describe("控除の式を読み取る（純関数）", () => {
  it("全員が 委託料 × 10%（切り捨て）→ percent 10%・12人中12人一致", () => {
    const res = inferDeductionRule(twelve((b) => Math.floor(b * 0.1)));
    expect(res.reason).toBeNull();
    expect(res.inference!.guess).toEqual({ kind: "percent", rate: 0.1 });
    expect(res.inference!.matched).toHaveLength(12);
    expect(res.inference!.total).toBe(12);
    expect(res.inference!.outliers).toEqual([]);
    // 1 人目：300,037 × 10% = 30,003.7 → 切り捨て 30,003
    expect(res.inference!.roundings).toEqual(["floor"]);
    expect(guessText(res.inference!.guess)).toBe("委託料 × 10%");
  });

  it("全員 5,000 円 → fixed 5,000・稼働した月だけ", () => {
    const res = inferDeductionRule(twelve(() => 5000));
    expect(res.inference!.guess).toEqual({ kind: "fixed", amount: 5000 });
    expect(res.inference!.matched).toHaveLength(12);
    expect(guessText(res.inference!.guess)).toBe("毎月 5,000円（稼働した月だけ）");
  });

  it("1 人だけ 8%：10% の式で 12人中11人一致、その人は「この人だけ 8%」で説明できる", () => {
    const res = inferDeductionRule(twelve((b, _q, i) => Math.round(b * (i === 4 ? 0.08 : 0.1))));
    const inf = res.inference!;
    expect(inf.guess).toEqual({ kind: "percent", rate: 0.1 });
    expect(inf.matched).toHaveLength(11);
    expect(inf.outliers).toEqual([
      // 340,037 × 8% = 27,202.96 → 27,203。10% なら 34,004
      { driverId: "d5", name: "ドライバー05", value: 27203, expected: 34004, own: { kind: "percent", rate: 0.08 } },
    ]);
  });

  it("数量 × 3 円 → per_unit 3 円。マイナスで書いてあっても額として読む", () => {
    const res = inferDeductionRule(twelve((_b, q) => -q * 3));
    expect(res.inference!.guess).toEqual({ kind: "per_unit", rate: 3 });
    expect(res.inference!.matched).toHaveLength(12);
    expect(guessText(res.inference!.guess)).toBe("数量 × 3円");
  });

  it("5,000 円の定額で、1 人だけ引いていない → 11人一致、その人は 0 円（その人だけ引かない）", () => {
    const res = inferDeductionRule(twelve((_b, _q, i) => (i === 0 ? 0 : 5000)));
    expect(res.inference!.guess).toEqual({ kind: "fixed", amount: 5000 });
    expect(res.inference!.outliers).toEqual([{ driverId: "d1", name: "ドライバー01", value: 0, expected: 5000, own: { kind: "fixed", amount: 0 } }]);
  });

  it("人ごとにばらばらの額（立替の精算など）は、式を出さずに理由を返す。1 人だけ・全員 0 も同じ", () => {
    const odd = inferDeductionRule(twelve((_b, _q, i) => [1200, 3300, 880, 0, 15000, 420, 7700, 0, 2980, 610, 0, 5140][i]));
    expect(odd.inference).toBeNull();
    expect(odd.reason).toContain("決まった式が見つかりませんでした");
    expect(inferDeductionRule([{ driverId: "a", name: "A", value: 5000, base: 100000, qty: 10 }]).reason).toContain("1 人分");
    expect(inferDeductionRule(twelve(() => 0)).reason).toContain("額が入っている人がいません");
  });
});

describe("金額の列を見分ける", () => {
  it("控除・振込手数料・委託料・振込額を見出しの言葉で分ける（率・単価・合計の列は額ではない）", () => {
    expect(classifyMoneyHeader("ロイヤリティ")).toEqual({ kind: "deduction", category: "royalty" });
    expect(classifyMoneyHeader("事務手数料")).toEqual({ kind: "deduction", category: "admin" });
    expect(classifyMoneyHeader("車両リース代")).toEqual({ kind: "deduction", category: "lease" });
    expect(classifyMoneyHeader("任意保険")).toEqual({ kind: "deduction", category: "insurance" });
    expect(classifyMoneyHeader("燃料代")).toEqual({ kind: "deduction", category: "fuel" });
    expect(classifyMoneyHeader("立替金")).toEqual({ kind: "deduction", category: "advance" });
    expect(classifyMoneyHeader("振込手数料")).toEqual({ kind: "fee" });
    expect(classifyMoneyHeader("委託料（税抜）")).toEqual({ kind: "base" });
    expect(classifyMoneyHeader("差引支給額")).toEqual({ kind: "payout", strength: 3 });
    expect(classifyMoneyHeader("支払額")).toEqual({ kind: "payout", strength: 1 });
    expect(classifyMoneyHeader("ロイヤリティ率")).toBeNull();
    // 見出しに率を書き添えた額の列は読む。率だけの列は読まない
    expect(classifyMoneyHeader("ロイヤリティ（10%）")).toEqual({ kind: "deduction", category: "royalty" });
    expect(classifyMoneyHeader("管理費 5.5％")).toEqual({ kind: "deduction", category: "admin" });
    expect(classifyMoneyHeader("ロイヤリティ%")).toBeNull();
    expect(classifyMoneyHeader("控除合計")).toBeNull();
    expect(classifyMoneyHeader("消費税")).toBeNull();
    // 稼働として読む列（数量など）は見ない
    const cols = findMoneyColumns(["氏名", "宅配", "ロイヤリティ", "振込手数料"], ["driver", "value", "ignore", "ignore"]);
    expect(cols.map((c) => [c.header, c.kind])).toEqual([
      ["ロイヤリティ", "deduction"],
      ["振込手数料", "fee"],
    ]);
  });

  it("縦持ちの表：人ごとの額が毎行に書いてあれば 1 回だけ、行ごとに違えば足す", () => {
    const rows = [
      ["氏名", "案件", "個数", "管理費", "燃料"],
      ["青木", "宅配", "100", "15000", "300"],
      ["青木", "企業配", "2", "15000", "500"],
      ["井上", "宅配", "80", "15000", ""],
    ];
    const mapping = { headerRow: 0, headerDepth: 1 as const, roles: ["driver", "project", "qty", "ignore", "ignore"] as never, fixedProjectId: null, useDates: false };
    const resolved = [
      { rowNo: 2, driverId: "a" },
      { rowNo: 3, driverId: "a" },
      { rowNo: 4, driverId: "b" },
    ];
    const admin = perDriverValues(rows, mapping, resolved, 3);
    expect(admin.perRow).toBe(false);
    expect(Object.fromEntries(admin.values)).toEqual({ a: 15000, b: 15000 });
    const fuel = perDriverValues(rows, mapping, resolved, 4);
    expect(fuel.perRow).toBe(true);
    expect(Object.fromEntries(fuel.values)).toEqual({ a: 800 });
  });
});

// ---------------------------------------------------------------- DB：デモの会社の 10 月

async function octoberSubtotals(db: Db, tenantId: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
  return new Map(drafts.map((d) => [d.driver.name, d.subtotal]));
}

/** 横持ちの見本（10 月の稼働と同じ数量）に、ロイヤリティ（岡田さんだけ 8%）・事務手数料 5,000 円・振込手数料 440 円の列を足した CSV */
function csvWithDeductions(sub: Map<string, number>): Uint8Array {
  const data: [string, number[]][] = [
    ["青木 翔太", [2310, 0, 4, 0, 0]],
    ["井上 美咲", [0, 21, 0, 0, 0]],
    ["上田 健", [1840, 0, 0, 0, 0]],
    ["遠藤 大輔", [0, 0, 2, 168, 0]],
    ["岡田 拓也", [420, 18, 0, 0, 0]],
    ["加藤 由美", [0, 0, 0, 0, 20]],
    ["木村 誠", [380, 0, 0, 0, 0]],
    ["佐藤 亮", [0, 22, 0, 0, 0]],
  ];
  const lines = ["2026年10月分 ドライバー別 稼働と控除", "氏名,宅配（個）,企業配（日）,スポット（件）,ルート（時間）,夜間便（便）,ロイヤリティ,事務手数料,振込手数料"];
  for (const [name, q] of data) {
    const base = sub.get(name)!;
    const royalty = Math.floor(base * (name === "岡田 拓也" ? 0.08 : 0.1));
    lines.push([name, ...q, royalty, 5000, 440].join(","));
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

describe("控除の提案（DB）", () => {
  it("ロイヤリティ 10%（岡田さんだけ 8%）・事務手数料 5,000 円を提案し、振込手数料は提案しない。採用すると合意の記録なしのルールができ、見張り番が知らせる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: other } = await seedDemo(db);
    // デモの会社にある「ロイヤリティ」のルールを止めておく（ルールの無い会社として試す）
    await db
      .update(s.deductionRules)
      .set({ active: false })
      .where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, "ロイヤリティ")));
    const sub = await octoberSubtotals(db, tenantId);
    expect(sub.get("青木 翔太")).toBe(374500);
    expect(sub.get("岡田 拓也")).toBe(389100);

    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "稼働と控除_2026年10月.csv", bytes: csvWithDeductions(sub), pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, d.id))!;
    expect(view.blockers).toEqual([]);
    const ex = view.extras!;
    expect(ex.fees).toEqual([{ col: 8, header: "振込手数料" }]);
    expect(ex.proposals.map((p) => p.header)).toEqual(["ロイヤリティ", "事務手数料"]);
    expect(ex.base.from).toBe("calc");

    const royalty = ex.proposals[0];
    expect(royalty.inference!.guess).toEqual({ kind: "percent", rate: 0.1 });
    expect(royalty.inference!.total).toBe(8);
    expect(royalty.inference!.matched).toHaveLength(7);
    // 岡田さん：389,100 × 8% = 31,128（10% なら 38,910）
    expect(royalty.inference!.outliers).toEqual([
      expect.objectContaining({ name: "岡田 拓也", value: 31128, expected: 38910, own: { kind: "percent", rate: 0.08 } }),
    ]);
    expect(royalty.existing).toBeNull();
    const admin = ex.proposals[1];
    expect(admin.inference!.guess).toEqual({ kind: "fixed", amount: 5000 });
    expect(admin.inference!.matched).toHaveLength(8);

    // 採用（岡田さんの 8% も、その人だけのルールとして作る）
    const out = await adoptDeductionProposal(db, tenantId, d.id, { col: royalty.col, withExceptions: true });
    expect(out.created.map((r) => [r.name, r.kind, r.rate, r.driverName, r.agreedInWriting, r.basis, r.onlyWhenWorked, r.taxable])).toEqual([
      ["ロイヤリティ", "percent", 0.1, null, false, PROPOSAL_BASIS, true, true],
      ["ロイヤリティ", "percent", 0.08, "岡田 拓也", false, PROPOSAL_BASIS, true, true],
    ]);
    // 同じ名前は二重に作らない
    await expect(adoptDeductionProposal(db, tenantId, d.id, { col: royalty.col, withExceptions: true })).rejects.toThrow("すでにあります");
    // 作ったあとの提案は「登録済みと同じ式」
    const again = (await loadDraftView(db, tenantId, d.id))!;
    expect(again.extras!.proposals[0].sameAsExisting).toBe(true);

    // 反映して、明細の計算に入る：青木さんのロイヤリティ 37,450 円・岡田さん 31,128 円
    await applyBatch(db, tenantId, { id: null }, d.id, { mode: "replaceAll", confirmDuplicates: false });
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const ded = (name: string) => drafts.find((x) => x.driver.name === name)!.deductions.find((x) => x.name === "ロイヤリティ")!.amount;
    expect(ded("青木 翔太")).toBe(37450);
    expect(ded("岡田 拓也")).toBe(31128);
    // 見張り番：採用したルールに「書面で合意した記録が無い控除があります」（赤）
    const issues = await runWatch(db, tenantId, DEMO_MONTH);
    const flagged = issues.filter((i) => i.code === "deduction_no_agreement" && out.created.some((r) => r.id === i.subjectId));
    expect(flagged).toHaveLength(2);
    expect(flagged.every((i) => i.severity === "red" && i.detail.includes("書面で合意した記録が見つかりません"))).toBe(true);

    // 別の会社には何もできていない・別の会社から採用できない
    const otherRules = await db.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, other), eq(s.deductionRules.basis, PROPOSAL_BASIS)));
    expect(otherRules).toEqual([]);
    const d2 = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "控除2.csv", bytes: csvWithDeductions(sub), pageMonth: "2026-11-01" });
    await expect(adoptDeductionProposal(db, other, d2.id, { col: 7, withExceptions: false })).rejects.toThrow("見つかりません");
    await client.close();
  });

  it("登録済みのルールと同じ式なら「同じ」、違えば作らない（二重に引かない）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const sub = await octoberSubtotals(db, tenantId);
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "稼働と控除.csv", bytes: csvWithDeductions(sub), pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, d.id))!;
    const royalty = view.extras!.proposals[0];
    // デモの会社のロイヤリティは 10%（全員向け）
    expect(royalty.existing?.name).toBe("ロイヤリティ");
    expect(royalty.sameAsExisting).toBe(true);
    await expect(adoptDeductionProposal(db, tenantId, d.id, { col: royalty.col, withExceptions: true })).rejects.toThrow("すでにあります");
    // 全員向けの 10% は登録済み。Excel で岡田さんだけ 8% なのは、その人だけのルールとして作れる（別の会社からは作れない）
    expect(royalty.exceptionRules).toEqual([expect.objectContaining({ name: "岡田 拓也", guess: { kind: "percent", rate: 0.08 }, hasOwnRule: false })]);
    const { tenantId: other } = await seedDemo(db);
    await expect(adoptDeductionProposal(db, other, d.id, { col: royalty.col, withExceptions: true, exceptionsOnly: true })).rejects.toThrow("見つかりません");
    const out = await adoptDeductionProposal(db, tenantId, d.id, { col: royalty.col, withExceptions: true, exceptionsOnly: true });
    expect(out.created.map((r) => [r.name, r.kind, r.rate, r.driverName, r.agreedInWriting, r.basis, r.onlyWhenWorked, r.taxable])).toEqual([
      ["ロイヤリティ", "percent", 0.08, "岡田 拓也", false, PROPOSAL_BASIS, true, true],
    ]);
    // 2 回目は作らない
    await expect(adoptDeductionProposal(db, tenantId, d.id, { col: royalty.col, withExceptions: true, exceptionsOnly: true })).rejects.toThrow("いません");
    // 明細：岡田さんだけ 389,100 × 8% = 31,128 円、青木さんは 10% のまま 37,450 円
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const ded = (name: string) => drafts.find((x) => x.driver.name === name)!.deductions.find((x) => x.name === "ロイヤリティ")!.amount;
    expect(ded("岡田 拓也")).toBe(31128);
    expect(ded("青木 翔太")).toBe(37450);
    await client.close();
  });
});
