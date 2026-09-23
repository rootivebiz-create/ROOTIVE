import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import { buildStatementDrafts } from "~/server/calc/statement";
import { formatRate, guessText, inferDeductionRule, type DeductionObservation } from "~/server/features/import/deductions";
import { parseDeductionFormula } from "~/server/features/import/formula-read";
import { formulaHintFor, formulaText } from "~/server/features/import/proposals";
import { createDraftFromFile, loadDraftView } from "~/server/features/import/service";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 控除の提案：Excel に残っている数式（=E5*0.1 → 10%）も読む（SPEC P0-3.1）。
 * 数式は手がかりにだけ使い、値と合うときだけ提案に使う（税込の列に掛けた式を、税抜の委託料の率にしない）。
 */

describe("数式を読む（純関数）", () => {
  it("列 × 数・数 × 列・列 ÷ 数と、端数の関数で包んだもの", () => {
    expect(parseDeductionFormula("=E5*0.1")).toEqual({ factor: 0.1, col: 4, row: 5, rounding: null });
    expect(parseDeductionFormula("=ROUNDDOWN(E5*10%,0)")).toEqual({ factor: 0.1, col: 4, row: 5, rounding: "floor" });
    expect(parseDeductionFormula("=INT($E$5*0.08)")).toEqual({ factor: 0.08, col: 4, row: 5, rounding: "floor" });
    expect(parseDeductionFormula("=-ROUND(0.1*E5,0)")).toEqual({ factor: 0.1, col: 4, row: 5, rounding: "round" });
    expect(parseDeductionFormula("=ROUNDUP((AB12*0.05),0)")).toEqual({ factor: 0.05, col: 27, row: 12, rounding: "ceil" });
    expect(parseDeductionFormula("=E5/10")).toEqual({ factor: 0.1, col: 4, row: 5, rounding: null });
    expect(parseDeductionFormula("=FLOOR(E5*0.1,1)")).toEqual({ factor: 0.1, col: 4, row: 5, rounding: "floor" });
    expect(parseDeductionFormula("ｅ５＊０．１")).toEqual({ factor: 0.1, col: 4, row: 5, rounding: null });
    // ルールで表せないもの：10 円単位の丸め・率のセルを掛ける・合計・足し算
    expect(parseDeductionFormula("=ROUND(E5*0.1,-1)")).toBeNull();
    expect(parseDeductionFormula("=E5*$K$1")).toBeNull();
    expect(parseDeductionFormula("=SUM(E5:F5)")).toBeNull();
    expect(parseDeductionFormula("=E5*0.1+500")).toBeNull();
    expect(parseDeductionFormula("=VLOOKUP(A5,率!A:B,2,0)*E5")).toBeNull();
    expect(parseDeductionFormula("")).toBeNull();
  });

  it("列の数式から、いちばん多い形を手がかりにする（数量の列なら 数量 × 単価）", () => {
    const header = ["氏名", "個数", "委託料", "ロイヤリティ", "燃料"];
    const roles = ["driver", "qty", "ignore", "ignore", "ignore"];
    const resolved = [2, 3, 4, 5].map((rowNo) => ({ rowNo }));
    const formulas = { D2: "=C2*0.1", D3: "=C3*0.1", D4: "=ROUNDDOWN(C4*0.1,0)", D5: "=C5*0.08", E2: "=B2*3", E3: "=B3*3", E4: "=B4*3" };
    const royalty = formulaHintFor(3, resolved, formulas, header, roles)!;
    expect(royalty).toEqual({ sample: "=C2*0.1", refHeader: "委託料", guess: { kind: "percent", rate: 0.1 }, rows: 3 });
    expect(formulaText(royalty)).toBe("「委託料」× 10%");
    const fuel = formulaHintFor(4, resolved, formulas, header, roles)!;
    expect(fuel.guess).toEqual({ kind: "per_unit", rate: 3 });
    expect(formulaText(fuel)).toBe("「個数」× 3円");
    // 数式が 1 行だけ・ばらばら・別の行を見ている式は、手がかりにしない
    expect(formulaHintFor(3, resolved, { D2: "=C2*0.1" }, header, roles)).toBeNull();
    expect(formulaHintFor(3, resolved, { D2: "=C2*0.1", D3: "=C3*0.2", D4: "=C4*0.3", D5: "=C5*0.4" }, header, roles)).toBeNull();
    expect(formulaHintFor(3, resolved, { D2: "=C1*0.1", D3: "=C1*0.1" }, header, roles)).toBeNull();
    expect(formulaHintFor(3, resolved, undefined, header, roles)).toBeNull();
  });

  it("0.5% きざみでない率（8.33%）も、数式があれば値と照らして読める。数式が無ければ読めない", () => {
    const obs: DeductionObservation[] = Array.from({ length: 12 }, (_, i) => {
      const base = 300000 + i * 10000 + 37;
      return { driverId: `d${i}`, name: `ドライバー${i}`, value: Math.floor(base * 0.0833), base, qty: 1000 };
    });
    expect(inferDeductionRule(obs).inference).toBeNull();
    const res = inferDeductionRule(obs, { kind: "percent", rate: 0.0833 });
    expect(res.inference!.guess).toEqual({ kind: "percent", rate: 0.0833 });
    expect(res.inference!.matched).toHaveLength(12);
    expect(guessText(res.inference!.guess)).toBe("委託料 × 8.33%");
    expect(formatRate(0.1)).toBe("10%");
    expect(formatRate(0.085)).toBe("8.5%");
    // 値と合わない数式（税込の額に掛けた率など）は使わない
    const wrong = inferDeductionRule(
      obs.map((o) => ({ ...o, value: Math.floor(o.base * 0.1) })),
      { kind: "percent", rate: 0.11 },
    );
    expect(wrong.inference!.guess).toEqual({ kind: "percent", rate: 0.1 });
  });
});

// ---------------------------------------------------------------- DB：数式の残った Excel

async function octoberSubtotals(db: Db, tenantId: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
  return new Map(drafts.map((d) => [d.driver.name, d.subtotal]));
}

/** 10 月の稼働（人 × 案件）に、委託料・ロイヤリティ（数式。岡田さんだけ 8%）・税込金額・保険（税込金額 × 2% の数式）を足したブック */
async function workbookWithFormulas(sub: Map<string, number>): Promise<Uint8Array> {
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
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("10月");
  ws.addRow(["氏名", "宅配（個）", "企業配（日）", "スポット（件）", "ルート（時間）", "夜間便（便）", "委託料", "ロイヤリティ", "税込金額", "保険"]);
  data.forEach(([name, q], i) => {
    const r = i + 2;
    const base = sub.get(name)!;
    const rate = name === "岡田 拓也" ? 0.08 : 0.1;
    ws.addRow([name, ...q, base]);
    // ロイヤリティ：1 行目は数式、2 行目からは下へコピーした数式（共有の数式）。岡田さんだけ 8%
    if (name === "岡田 拓也") ws.getCell(`H${r}`).value = { formula: `ROUNDDOWN(G${r}*0.08,0)`, result: Math.floor(base * rate) };
    else if (r === 2) ws.getCell("H2").value = { formula: "ROUNDDOWN(G2*0.1,0)", result: Math.floor(base * rate), shareType: "shared", ref: "H2:H4" } as ExcelJS.CellFormulaValue;
    else if (r <= 4) ws.getCell(`H${r}`).value = { sharedFormula: "H2", result: Math.floor(base * rate) } as ExcelJS.CellSharedFormulaValue;
    else ws.getCell(`H${r}`).value = { formula: `ROUNDDOWN(G${r}*0.1,0)`, result: Math.floor(base * rate) };
    const incl = Math.floor(base * 1.1);
    ws.getCell(`I${r}`).value = { formula: `G${r}*1.1`, result: incl };
    ws.getCell(`J${r}`).value = { formula: `ROUNDDOWN(I${r}*2%,0)`, result: Math.floor(incl * 0.02) };
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe("数式の残った Excel の控除の提案（DB）", () => {
  it("委託料 × 10% の数式を読み、値とも合うので提案に使う。税込の額に掛けた保険の数式は、委託料の率にしない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const sub = await octoberSubtotals(db, tenantId);
    const bytes = await workbookWithFormulas(sub);
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "稼働と控除_2026年10月.xlsx", bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, d.id))!;
    expect(view.blockers).toEqual([]);
    // 共有の数式（下へコピーした数式）も、その行の番地に直して持つ
    const f = view.summary.formulas!["10月"];
    expect(f.H2).toBe("=ROUNDDOWN(G2*0.1,0)");
    expect(f.H3).toBe("=ROUNDDOWN(G3*0.1,0)");
    expect(f.H6).toBe("=ROUNDDOWN(G6*0.08,0)");
    expect(f.J2).toBe("=ROUNDDOWN(I2*2%,0)");
    // 控除の式として読めない数式（G2*1.1 は掛けているが、控除の列ではないので使われない）
    const ex = view.extras!;
    expect(ex.base).toEqual({ from: "column", header: "委託料" });
    const royalty = ex.proposals.find((p) => p.header === "ロイヤリティ")!;
    expect(royalty.inference!.guess).toEqual({ kind: "percent", rate: 0.1 });
    expect(royalty.inference!.matched).toHaveLength(7);
    expect(royalty.formula).toEqual({ sample: "=ROUNDDOWN(G2*0.1,0)", refHeader: "委託料", guess: { kind: "percent", rate: 0.1 }, rows: 7, used: true });
    // 岡田さん：389,100 × 8% = 31,128
    expect(royalty.exceptionRules).toEqual([expect.objectContaining({ name: "岡田 拓也", guess: { kind: "percent", rate: 0.08 } })]);
    expect(royalty.inference!.outliers[0]).toMatchObject({ value: 31128, expected: 38910 });

    // 保険：税込金額 × 2%（委託料 × 2.2% にあたる）。委託料 × 2% では合わないので、式にしない（数式は見せる）
    const insurance = ex.proposals.find((p) => p.header === "保険")!;
    expect(insurance.inference).toBeNull();
    expect(insurance.formula).toMatchObject({ refHeader: "税込金額", guess: { kind: "percent", rate: 0.02 }, rows: 8, used: false });
    expect(formulaText(insurance.formula!)).toBe("「税込金額」× 2%");
    await client.close();
  });

  it("CSV には数式が無い（値だけで読む）。別の会社の下書きは読めない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: other } = await seedDemo(db);
    const csv = "氏名,宅配（個）,企業配（日）,ロイヤリティ\n青木 翔太,2310,0,34650\n上田 健,1840,0,27600\n井上 美咲,0,21,37800\n";
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "10月.csv", bytes: new TextEncoder().encode(csv), pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, d.id))!;
    expect(view.summary.formulas).toBeUndefined();
    const p = view.extras!.proposals[0];
    expect(p.formula).toBeNull();
    // 委託料：青木 2310 × 150 = 346,500 → 10% = 34,650・井上 21 × 18,000 = 378,000 → 37,800
    expect(p.inference!.guess).toEqual({ kind: "percent", rate: 0.1 });
    expect(await loadDraftView(db, other, d.id)).toBeNull();
    await client.close();
  });
});
