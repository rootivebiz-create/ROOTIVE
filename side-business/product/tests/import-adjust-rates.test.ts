import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { buildStatementDrafts } from "~/server/calc/statement";
import { adoptRateProposals } from "~/server/features/import/adopt";
import { adjustDefaults, signedAmount } from "~/server/features/import/adjust";
import { parseAdjustmentPaste } from "~/server/features/import/adjust-paste";
import { classifyMoneyHeader, classifyRateHeader } from "~/server/features/import/columns";
import { assertDemoUploadBudget, DEMO_MAX_UPLOADS, demoFileProblem } from "~/server/features/import/demo-budget";
import { applyBatch, createDraftFromFile, loadDraftView, setAdjustColumn, undoBatch } from "~/server/features/import/service";
import { addAdjustment, bulkAddAdjustments } from "~/server/features/import/work";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 取り込み：金額の列を「その月の調整」に（C03）・単価の列を「人ごとの単価」に（C04）・
 * 調整の貼り付け（C03）・デモの置ける量（SEC-2）
 */

const user = { id: null };
const NOV = "2026-11-01";
const DEC = "2026-12-01";

function csv(text: string) {
  return new TextEncoder().encode(text);
}

async function ids(db: Db, tenantId: string) {
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
  return {
    D: Object.fromEntries(drivers.map((d) => [d.code!, d.id])),
    P: Object.fromEntries(projects.map((p) => [p.name, p.id])),
  };
}

async function monthAdjustments(db: Db, tenantId: string, month: string) {
  return db
    .select()
    .from(s.adjustments)
    .where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, month)));
}

async function totals(db: Db, tenantId: string, month: string) {
  const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, month));
  return Object.fromEntries(drafts.map((d) => [d.driver.code, { total: d.total, adjustments: d.adjustments.map((a) => [a.label, a.amount]) }]));
}

/** 燃料代（人ごとにばらばら）と立替金の列がある稼働の表 */
const FUEL = (aoki = 12400) => csv(`氏名,コース,個数,燃料代,立替金\n青木 翔太,宅配,100,${aoki},\n上田 健,宅配,80,9800,3280\n木村 誠,企業配,20,,\n合計,,200,,\n`);

describe("金額の列を、その月の調整として入れる（燃料・立替 など）", () => {
  it("式にならない燃料代・立替金の列を調整にする → 反映で人ごとに入り、取り消しで消える。翌月は覚えた読み方で、置いて反映するだけ", async () => {
    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { D } = await ids(db, tenantId);
    const { id, month } = await createDraftFromFile(db, tenantId, user, { fileName: "稼働_2026年11月.csv", bytes: FUEL(), pageMonth: DEMO_MONTH });
    expect(month).toBe(NOV);
    let view = (await loadDraftView(db, tenantId, id))!;
    expect(view.blockers).toEqual([]);
    const ex = view.extras!;
    // 燃料代は人ごとにばらばら：式の提案は出ず、調整として入れられる列に出る
    expect(ex.proposals.find((p) => p.header === "燃料代")?.inference).toBeNull();
    expect(ex.adjust.map((c) => [c.header, c.kindLabel, c.draft.sign, c.draft.taxable, c.entries.length])).toEqual([
      ["燃料代", "燃料", "minus", true, 2],
      ["立替金", "立替の精算", "plus", false, 1],
    ]);
    expect(view.preview!.adjustments.count).toBe(0);

    await setAdjustColumn(db, tenantId, id, { col: 3, enabled: true, label: "燃料代", sign: "minus", taxable: false, agreedInWriting: true, basis: null });
    await setAdjustColumn(db, tenantId, id, { col: 4, enabled: true, label: "高速代の立替", sign: "plus", taxable: false, agreedInWriting: true, basis: "領収書" });
    view = (await loadDraftView(db, tenantId, id))!;
    expect(view.preview!.adjustments).toEqual({ count: 3, total: -12400 - 9800 + 3280, drivers: 2 });
    // 調整にした列は、控除のルールの提案に出さない（二重に引かない）
    expect(view.extras!.proposals.some((p) => p.header === "燃料代")).toBe(false);
    // 明細の見通しにも入る（青木さん：燃料代 −12,400）
    const aoki = view.preview!.statements.find((x) => x.name === "青木 翔太")!;
    expect(aoki.afterTotal).toBeLessThan(aoki.afterSubtotal);

    const applied = await applyBatch(db, tenantId, user, id, { mode: "add", confirmDuplicates: false });
    expect(applied).toMatchObject({ adjustments: 3, adjustmentTotal: -18920 });
    const adj = await monthAdjustments(db, tenantId, NOV);
    expect(adj.map((a) => [a.driverId, a.label, a.amount, a.taxable, a.agreedInWriting]).sort()).toEqual(
      [
        [D.D01, "燃料代", -12400, false, true],
        [D.D03, "燃料代", -9800, false, true],
        [D.D03, "高速代の立替", 3280, false, true],
      ].sort(),
    );
    expect(adj.find((a) => a.label === "燃料代")!.basis).toBe("取り込み：稼働_2026年11月.csvの「燃料代」の列");
    expect(adj.find((a) => a.label === "高速代の立替")!.basis).toBe("領収書");
    expect((await totals(db, tenantId, NOV)).D01.adjustments).toEqual([["燃料代", -12400]]);

    // 翌月：同じ形のファイルは、覚えた読み方で調整まで入る（置いて反映するだけ）
    const dec = await createDraftFromFile(db, tenantId, user, { fileName: "稼働_2026年12月.csv", bytes: FUEL(11000), pageMonth: DEMO_MONTH });
    const dv = (await loadDraftView(db, tenantId, dec.id))!;
    expect(dv.summary.mappingFrom).toBe("profile");
    expect(dv.summary.mapping.adjust?.map((a) => a.label)).toEqual(["燃料代", "高速代の立替"]);
    // 同じ人・同じ名前の調整がもう入っていれば、確かめてもらう
    await addAdjustment(db, tenantId, DEC, { driverId: D.D01, label: "燃料代", amount: -500, taxable: false, agreedInWriting: true, basis: null });
    const dv2 = (await loadDraftView(db, tenantId, dec.id))!;
    expect(dv2.preview!.modes.add.adjustDuplicates.map((d) => [d.driverName, d.label, d.existing, d.incoming])).toEqual([["青木 翔太", "燃料代", -500, -11000]]);
    await expect(applyBatch(db, tenantId, user, dec.id, { mode: "add", confirmDuplicates: false })).rejects.toThrow("同じ人・同じ名前の調整");
    await applyBatch(db, tenantId, user, dec.id, { mode: "add", confirmDuplicates: true });
    expect((await monthAdjustments(db, tenantId, DEC)).filter((a) => a.label === "燃料代").map((a) => a.amount).sort((a, b) => a - b)).toEqual([-11000, -9800, -500]);

    // 11 月を直したファイルで入れ替える → 前の取り込みの調整は消えて、新しい額に。取り消すと前の額に戻る
    const fixed = await createDraftFromFile(db, tenantId, user, { fileName: "稼働_2026年11月_直し.csv", bytes: FUEL(12000), pageMonth: DEMO_MONTH });
    const fv = (await loadDraftView(db, tenantId, fixed.id))!;
    expect(fv.preview!.modes.replace.removeAdjustments).toBe(3);
    await applyBatch(db, tenantId, user, fixed.id, { mode: "replace", confirmDuplicates: false });
    expect((await monthAdjustments(db, tenantId, NOV)).map((a) => a.amount).sort((a, b) => a - b)).toEqual([-12000, -9800, 3280]);
    const back = await undoBatch(db, tenantId, user, fixed.id);
    expect(back).toMatchObject({ deletedAdjustments: 3, restoredAdjustments: 3 });
    expect((await monthAdjustments(db, tenantId, NOV)).map((a) => a.amount).sort((a, b) => a - b)).toEqual([-12400, -9800, 3280]);
    // 戻した取り込みを取り消すと、戻した調整も消える（戻したときに新しくなった番号を覚えている）
    const gone = await undoBatch(db, tenantId, user, id);
    expect(gone.deletedAdjustments).toBe(3);
    expect(await monthAdjustments(db, tenantId, NOV)).toEqual([]);
  });

  it("列の種類ごとの既定：燃料は引く・立替は足す・＋と−が混じる列は符号のまま。手当は足す", () => {
    expect(classifyMoneyHeader("高速代")).toEqual({ kind: "deduction", category: "toll" });
    expect(classifyMoneyHeader("事故負担金")).toEqual({ kind: "deduction", category: "accident" });
    expect(classifyMoneyHeader("安全手当")).toEqual({ kind: "allowance" });
    expect(classifyMoneyHeader("調整額")).toEqual({ kind: "adjust" });
    expect(adjustDefaults({ kind: "deduction", category: "fuel" }, [100, 200])).toEqual({ sign: "minus", taxable: true });
    expect(adjustDefaults({ kind: "deduction", category: "toll" }, [100])).toEqual({ sign: "minus", taxable: false });
    expect(adjustDefaults({ kind: "deduction", category: "fuel" }, [100, -200])).toEqual({ sign: "asIs", taxable: false });
    expect(adjustDefaults({ kind: "allowance" }, [3000])).toEqual({ sign: "plus", taxable: true });
    expect(signedAmount(-1200.4, "minus")).toBe(-1200);
    expect(signedAmount(1200, "minus")).toBe(-1200);
    expect(signedAmount(-1200, "plus")).toBe(1200);
    expect(signedAmount(-1200, "asIs")).toBe(-1200);
  });
});

describe("単価の列から、人ごとの単価（C04）", () => {
  it("台帳と違う単価の人だけを下書きにし、登録できる（合意した日は空 → 見張り番が知らせる）。行ごとに違う人は知らせるだけ", async () => {
    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { D, P } = await ids(db, tenantId);
    const bytes = csv("氏名,コース,個数,単価\n青木 翔太,宅配,100,150\n上田 健,宅配,80,160\n岡田 拓也,宅配,50,155\n遠藤 大輔,宅配,10,150\n遠藤 大輔,宅配,20,170\n");
    const { id } = await createDraftFromFile(db, tenantId, user, { fileName: "単価つき_2026年11月.csv", bytes, pageMonth: DEMO_MONTH });
    let view = (await loadDraftView(db, tenantId, id))!;
    expect(view.blockers).toEqual([]);
    const f = view.extras!.rates[0];
    expect(f).toMatchObject({ header: "単価", kind: "rate", matched: 2, billLike: false });
    expect(f.proposals.map((p) => [p.driverName, p.projectName, p.current, p.rate])).toEqual([["上田 健", "宅配（個建て）", 150, 160]]);
    expect(f.varying).toEqual([{ driverName: "遠藤 大輔", projectName: "宅配（個建て）", rates: [150, 170] }]);

    const { adopted } = await adoptRateProposals(db, tenantId, id, { col: f.col });
    expect(adopted.map((a) => [a.driverName, a.after.payRate, a.after.agreedOn, a.created])).toEqual([["上田 健", 160, null, true]]);
    const [o] = await db
      .select()
      .from(s.rateOverrides)
      .where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, D.D03), eq(s.rateOverrides.projectId, P["宅配（個建て）"])));
    expect(o).toMatchObject({ payRate: 160, agreedOn: null });
    view = (await loadDraftView(db, tenantId, id))!;
    expect(view.extras!.rates[0]).toMatchObject({ matched: 3, proposals: [] });
    await expect(adoptRateProposals(db, tenantId, id, { col: f.col })).rejects.toThrow("登録する単価がありません");
  });

  it("金額の列なら 金額 ÷ 数量 で読む。受注単価（元請からの単価）と同じ値ばかりの列は、支払の単価とみなさない", async () => {
    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const a = await createDraftFromFile(db, tenantId, user, {
      fileName: "金額_2026年11月.csv",
      bytes: csv("氏名,コース,個数,金額\n青木 翔太,宅配,100,15000\n上田 健,宅配,80,12800\n"),
      pageMonth: DEMO_MONTH,
    });
    const fa = (await loadDraftView(db, tenantId, a.id))!.extras!.rates[0];
    expect(fa).toMatchObject({ kind: "amount", matched: 1 });
    expect(fa.proposals.map((p) => [p.driverName, p.rate])).toEqual([["上田 健", 160]]);
    const b = await createDraftFromFile(db, tenantId, user, {
      fileName: "元請単価_2026年11月.csv",
      bytes: csv("氏名,コース,個数,単価\n青木 翔太,宅配,100,190\n上田 健,宅配,80,190\n"),
      pageMonth: DEMO_MONTH,
    });
    const fb = (await loadDraftView(db, tenantId, b.id))!.extras!.rates[0];
    expect(fb).toMatchObject({ billLike: true, proposals: [] });
    expect(classifyRateHeader("請求単価")).toBeNull();
    expect(classifyRateHeader("支払単価")).toBe("rate");
    expect(classifyRateHeader("支払金額")).toBe("amount");
  });
});

describe("調整をまとめて貼り付ける（稼働と調整）", () => {
  const drivers = [
    { id: "d1", name: "青木 翔太", code: "D01" },
    { id: "d3", name: "上田 健", code: "D03" },
    { id: "d9", name: "上田 美和", code: "D09" },
  ];

  it("Excel の「名前・内容・金額」を読む。見出しと 0 円は飛ばし、△・(…) はマイナス。番号でも当たる", () => {
    const r = parseAdjustmentPaste("氏名\t内容\t金額\n青木 翔太\t燃料代\t△12,400\nD03\t高速代\t3,280\n上田 健\t燃料代\t0\n", drivers);
    expect(r.problems).toEqual([]);
    expect(r.skipped).toBe(2);
    expect(r.rows.map((x) => [x.driverId, x.label, x.amount])).toEqual([
      ["d1", "燃料代", -12400],
      ["d3", "高速代", 3280],
    ]);
    // 2 列だけなら「内容（全員同じとき）」の名前。向きは「すべて引く」もできる
    const two = parseAdjustmentPaste("青木 翔太\t1200\n上田 健\t800", drivers, { defaultLabel: "燃料代", sign: "minus" });
    expect(two.rows.map((x) => [x.label, x.amount])).toEqual([
      ["燃料代", -1200],
      ["燃料代", -800],
    ]);
  });

  it("台帳に無い名前・名前の一部だけ・金額の無い行は、行番号つきで返す", () => {
    const r = parseAdjustmentPaste("山田 花子\t燃料代\t100\n上田\t燃料代\t100\n青木 翔太\t燃料代\n青木 翔太\t\t100", drivers);
    expect(r.rows).toEqual([]);
    expect(r.problems).toEqual([
      "1行目：「山田 花子」は台帳に見つかりません。台帳の名前か番号で書いてください",
      expect.stringContaining("2行目：「上田」"),
      expect.stringContaining("3行目「青木 翔太"),
      expect.stringContaining("4行目（青木 翔太）：内容がありません"),
    ]);
  });

  it("DB：1 行でも読めなければ何も入れない。そろえば一度に入れる。締めた月には入れない", async () => {
    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const base = { defaultLabel: null, sign: "asIs" as const, taxable: false, agreedInWriting: true, basis: "領収書" };
    const before = (await monthAdjustments(db, tenantId, DEMO_MONTH)).length;
    await expect(bulkAddAdjustments(db, tenantId, DEMO_MONTH, { ...base, text: "青木 翔太\t燃料代\t-1000\n誰か\t燃料代\t-500" })).rejects.toThrow("2行目");
    expect(await monthAdjustments(db, tenantId, DEMO_MONTH)).toHaveLength(before);
    const out = await bulkAddAdjustments(db, tenantId, DEMO_MONTH, { ...base, text: "青木 翔太\t燃料代\t-1000\n上田 健\t燃料代\t-500" });
    expect(out.rows.map((r) => [r.driverName, r.amount])).toEqual([
      ["青木 翔太", -1000],
      ["上田 健", -500],
    ]);
    const after = await monthAdjustments(db, tenantId, DEMO_MONTH);
    expect(after).toHaveLength(before + 2);
    expect(after.filter((a) => a.label === "燃料代").every((a) => a.basis === "領収書" && a.agreedInWriting)).toBe(true);
    await expect(bulkAddAdjustments(db, tenantId, DEMO_PREV_MONTH, { ...base, text: "青木 翔太\t燃料代\t-1000" })).rejects.toThrow("締め済み");
  });
});

describe("デモの置ける量（DB をいっぱいにしない）", () => {
  const prev = process.env.DEMO_MODE;
  afterEach(() => {
    if (prev === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = prev;
  });

  it("デモでは 1MB を超えるファイル・会社ごとの件数と中身の量を超える取り込みを止める（本番は止めない）", async () => {
    expect(demoFileProblem(2 * 1024 * 1024, true)).toContain("デモでは 1MB まで");
    expect(demoFileProblem(512 * 1024, true)).toBeNull();
    expect(demoFileProblem(2 * 1024 * 1024, false)).toBeNull();

    const { db } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const other = (await seedDemo(db)).tenantId;
    await assertDemoUploadBudget(db, tenantId, 1000, true);
    await expect(assertDemoUploadBudget(db, tenantId, 2 * 1024 * 1024, true)).rejects.toThrow("中身の量を超えます");
    await db.insert(s.importBatches).values(
      Array.from({ length: DEMO_MAX_UPLOADS }, (_, i) => ({ tenantId, month: DEMO_MONTH, kind: "work", fileName: `f${i}.csv`, status: "discarded", summary: {} })),
    );
    await expect(assertDemoUploadBudget(db, tenantId, 10, true)).rejects.toThrow(`${DEMO_MAX_UPLOADS} 件まで`);
    // ほかのデモの会社は数えない・本番は止めない
    await assertDemoUploadBudget(db, other, 10, true);
    await assertDemoUploadBudget(db, tenantId, 10, false);

    // 置く入口でも止まる（DEMO_MODE=1）
    process.env.DEMO_MODE = "1";
    await expect(
      createDraftFromFile(db, other, user, { fileName: "大きい.csv", bytes: new Uint8Array(1024 * 1024 + 10).fill(0x31), pageMonth: DEMO_MONTH }),
    ).rejects.toThrow("デモでは 1MB まで");
    await expect(createDraftFromFile(db, tenantId, user, { fileName: "小さい.csv", bytes: csv("氏名,コース,個数\n青木 翔太,宅配,1\n"), pageMonth: DEMO_MONTH })).rejects.toThrow(
      "件まで",
    );
    const ok = await createDraftFromFile(db, other, user, { fileName: "小さい.csv", bytes: csv("氏名,コース,個数\n青木 翔太,宅配,1\n"), pageMonth: DEMO_MONTH });
    expect(ok.id).toBeTruthy();
  });
});
