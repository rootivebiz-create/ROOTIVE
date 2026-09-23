import { describe, expect, it } from "vitest";
import { nonDeductibleTax } from "@/lib/payroll/tax";
import { buildStatementDrafts, type BuildInput, type CalcRule, type StatementDraft } from "~/server/calc/statement";
import { compareTermsContent, type TermsContent } from "~/server/features/terms-content";
import { ackAllowed } from "~/server/features/watch/acks";
import {
  dedNewOrUp,
  dedPenalty,
  dedWithoutWork,
  deductionMeasure,
  deductionNoAgreement,
  duplicateRows,
  evaluateRules,
  EXEMPT_CUT_SENTENCE,
  exemptOnlyCut,
  FEE_SENTENCE,
  FEE_SENTENCE_EARLY,
  feeDeducted,
  hasSubcontractItems,
  latePaymentPrev,
  openQuestions,
  originalPayDateFor,
  paidLate,
  PAYOUT_SWING_RATIO,
  payoutSwing,
  PENALTY_SENTENCE,
  questionLine,
  rateDown,
  RULES,
  readTermsContent,
  sixtyDays,
  sortIssues,
  termsChangeImpact,
  termsChangeText,
  termsMissing,
  termsOutdated,
  transitionalNext,
  transitionalSpan,
} from "~/server/features/watch/rules";
import { FIX, fixLink, SOURCES } from "~/server/features/watch/sources";
import type { WatchContext, WatchDriver, WatchTerms } from "~/server/features/watch/types";

/**
 * あとから足した見張り番のルール（純関数）を、ルールごとに「出る」「出ない」の両方で確かめる。
 * 明細は本物の計算（buildStatementDrafts）で作り、影響額は明細の値から手で計算した円と一致させる。
 */

const OCT = "2026-10-01";
const SEP = "2026-09-01";
const NOV = "2026-11-01";
const FORBIDDEN = /(?<!取)適法|違反です|違反はありません|問題ありません|対応済み|完全対応|防げます|大丈夫|必ず合う|ミスゼロ|完全自動|補助金|単価を下げ|引き下げ|偽装請負|労働者に当た/;
const TENANT = { closingDay: 0, payMonthOffset: 1, payDay: 25, taxMethod: "general", settings: {}, amountRounding: "round" as const };

function driver(id: string, name: string, over: Partial<WatchDriver> = {}): WatchDriver {
  return {
    id,
    name,
    code: id.toUpperCase(),
    active: true,
    invoiceRegistered: true,
    registrationNo: "T1234567890123",
    registrationCheckedOn: "2026-10-01",
    termsFirstIssuedOn: "2026-04-01",
    termsLatestIssuedOn: "2026-04-01",
    startedOn: null,
    endOn: null,
    endNoticedOn: null,
    bank: { bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "001", branchNameKana: "ﾎﾝﾃﾝ", accountType: "ordinary", accountNumber: "1234567", holderKana: "ｱｵｷ ｼｮｳﾀ" },
    firstWork: { month: "2026-04-01", minDate: null, hasUndated: true },
    ...over,
  };
}

const CALC_TENANT: BuildInput["tenant"] = {
  name: "テスト運送（架空）",
  registrationNo: "T9999999999999",
  taxMethod: "general",
  payTaxToExempt: true,
  taxRounding: "floor",
  amountRounding: "round",
  closingDay: 0,
  payMonthOffset: 1,
  payDay: 25,
};

type WorkRow = [driverId: string, projectId: string, qty: number, workDate?: string];

function drafts(month: string, drivers: WatchDriver[], work: WorkRow[], extra: Partial<BuildInput> = {}): StatementDraft[] {
  const input: BuildInput = {
    month,
    tenant: CALC_TENANT,
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, code: d.code, invoiceRegistered: d.invoiceRegistered, registrationNo: d.registrationNo, isCorporation: false, withholdingCategory: "none", active: d.active })),
    projects: [
      { id: "p1", name: "宅配", clientName: "A物流（架空）", unit: "個", billRate: 190, payRate: 150 },
      { id: "p2", name: "企業配", clientName: "A物流（架空）", unit: "日", billRate: 22000, payRate: 18000 },
    ],
    overrides: [],
    rules: [],
    work: work.map(([driverId, projectId, qty, workDate]) => ({ driverId, projectId, qty, workDate: workDate ?? null })),
    adjustments: [],
    ...extra,
  };
  return buildStatementDrafts(input);
}

function ctx(over: Partial<WatchContext> = {}): WatchContext {
  return {
    month: OCT,
    today: "2026-10-31",
    closed: false,
    tenant: TENANT,
    drafts: [],
    prevDrafts: [],
    drivers: [],
    rules: [],
    overrides: [],
    adjustments: [],
    statements: [],
    batches: [],
    statementsStatus: null,
    ...over,
  };
}

const rule = (over: Partial<CalcRule> & { id: string; name: string }): CalcRule => ({
  driverId: null,
  kind: "fixed",
  rate: null,
  amount: 1000,
  onlyWhenWorked: true,
  taxable: true,
  agreedInWriting: true,
  active: true,
  sort: 1,
  ...over,
});

const aoki = driver("d1", "青木 翔太");
const ueda = driver("d2", "上田 健", { invoiceRegistered: false, registrationNo: null });
const inoue = driver("d3", "井上 美咲");

/** 取引条件の中身（記録・今の台帳のどちらにも使う） */
function terms(over: Partial<TermsContent> = {}): TermsContent {
  return {
    serviceDescription: "荷物の配送業務",
    services: [{ projectId: "p1", name: "宅配", client: "A物流（架空）", unit: "個", payRate: 150 }],
    taxNote: "報酬とは別に消費税を支払います。",
    payment: { closingDay: 0, payMonthOffset: 1, payDay: 25, text: "毎月末日締め・翌月25日払い", periodText: "毎月1日〜末日" },
    feeBearer: "company",
    deductions: [{ ruleId: "r1", name: "管理費", kind: "fixed", rate: null, amount: 15000, onlyWhenWorked: true, how: "毎月 15,000円（稼働した月だけ）" }],
    place: "",
    period: { from: "2026-04-01", to: null },
    receipt: "",
    deemedClause: null,
    other: "",
    ...over,
  };
}

function termsRow(driverId: string, recorded: TermsContent | null, current: TermsContent | null, over: Partial<WatchTerms> = {}): WatchTerms {
  return { driverId, version: 2, issuedOn: "2026-04-01", recorded, current, changes: recorded && current ? compareTermsContent(recorded, current) : [], subcontract: null, ...over };
}

describe("取引条件の記録が古い（terms_outdated）", () => {
  const work: WorkRow[] = [["d1", "p1", 100]];
  const cur = drafts(OCT, [aoki], work, { overrides: [{ driverId: "d1", projectId: "p1", payRate: 155 }], rules: [rule({ id: "r1", name: "管理費", amount: 15000 })] });

  it("記録のあとで単価が 150 → 155 円：黄。違いを並べ、影響額は 5円 × 100個 = 500円。直す画面は /terms/<id>", () => {
    const now = terms({ services: [{ projectId: "p1", name: "宅配", client: "A物流（架空）", unit: "個", payRate: 155 }] });
    const [i] = termsOutdated(ctx({ drivers: [aoki], drafts: cur, terms: [termsRow("d1", terms(), now)] }));
    expect(i).toMatchObject({ code: "terms_outdated", severity: "yellow", subjectId: "d1", subjectLabel: "青木 翔太", fixHref: "/terms/d1", sourceUrl: SOURCES.flQa });
    expect(i.detail).toContain("版 2・2026年4月1日");
    expect(i.detail).toContain("「宅配」の単価 150円/個 → 155円/個");
    expect(i.impact).toEqual({ yen: 500, label: "条件が変わった分の2026年10月分の差額" });
    expect(fixLink(i.fixHref!, { role: "staff", closed: false }).text).toBe("直す（取引条件の記録）");
  });

  it("控除の率が 10% → 12%：委託料 15,000円 × 2% = 300円。支払期日の文だけの違いは影響額「—」", () => {
    const pct = (rate: number) => ({ ruleId: "r2", name: "ロイヤリティ", kind: "percent" as const, rate, amount: null, onlyWhenWorked: true, how: `委託料（税抜）の ${rate * 100}%（稼働した月だけ）` });
    const d = drafts(OCT, [aoki], work, { rules: [rule({ id: "r2", name: "ロイヤリティ", kind: "percent", rate: 0.12, amount: null })] })[0];
    expect(termsChangeImpact(terms({ deductions: [pct(0.1)] }), terms({ deductions: [pct(0.12)] }), d)).toBe(300);
    // 新しく加わった控除は、その月の額
    expect(termsChangeImpact(terms({ deductions: [] }), terms({ deductions: [pct(0.12)] }), d)).toBe(1800);
    const paymentOnly = terms({ payment: { ...terms().payment, text: "毎月末日締め・翌月末日払い" } });
    expect(termsChangeImpact(terms(), paymentOnly, d)).toBeNull();
    const [i] = termsOutdated(ctx({ drivers: [aoki], drafts: [d], terms: [termsRow("d1", terms(), paymentOnly)] }));
    expect(i.impact).toMatchObject({ yen: null });
    expect(i.detail).toContain("支払期日「毎月末日締め・翌月25日払い」→「毎月末日締め・翌月末日払い」");
    expect(termsChangeText({ kind: "fee", label: "振込手数料の負担", before: "company", after: "driver" })).toBe("振込手数料の負担 会社 → ドライバー");
  });

  it("違いが無い・記録が読めない・今月の明細が無い人 → 出ない", () => {
    expect(termsOutdated(ctx({ drivers: [aoki], drafts: cur, terms: [termsRow("d1", terms(), terms())] }))).toHaveLength(0);
    expect(termsOutdated(ctx({ drivers: [aoki], drafts: cur, terms: [termsRow("d1", null, terms())] }))).toHaveLength(0);
    const changed = terms({ feeBearer: "driver" });
    expect(termsOutdated(ctx({ drivers: [aoki], drafts: [], terms: [termsRow("d1", terms(), changed)] }))).toHaveLength(0);
    // 古い形（{}）や、形の崩れた記録は読まない
    expect(readTermsContent({})).toBeNull();
    expect(readTermsContent({ services: [], deductions: [], payment: {} })).toBeNull();
    expect(readTermsContent(terms({ feeBearer: undefined as never }))?.feeBearer).toBe("company");
  });

  it("取引条件の記録（最初の版）が最初の稼働より前にあれば、drivers の日付が空でも明示の記録ありとして扱う", () => {
    const d = drafts(OCT, [aoki], work);
    // 最初の版の日付は context が terms_records から入れる（ここではその値を直接渡す）
    const recorded = driver("d1", "青木 翔太", { termsFirstIssuedOn: "2026-03-20", termsLatestIssuedOn: "2026-09-01" });
    expect(termsMissing(ctx({ drivers: [recorded], drafts: d }))).toHaveLength(0);
    const none = driver("d1", "青木 翔太", { termsFirstIssuedOn: null, termsLatestIssuedOn: null });
    const [i] = termsMissing(ctx({ drivers: [none], drafts: d }));
    // 影響額はその人の今月の支払額（15,000 ＋ 1,500）
    expect(i.impact).toEqual({ yen: 16500, label: "青木 翔太さんの2026年10月分の支払額" });
  });

  it("稼働が無く差し引きだけの人（振込額がマイナス）は、マイナスの円ではなく差し引いた額を影響額にする", () => {
    const none = driver("d4", "遠藤 大輔", { termsFirstIssuedOn: null, termsLatestIssuedOn: null, invoiceRegistered: false, registrationNo: null });
    const lease = rule({ id: "r3", driverId: "d4", name: "車両リース", amount: 32000, onlyWhenWorked: false });
    const d = drafts(NOV, [aoki, none], [["d1", "p1", 100]], { rules: [lease] }).filter((x) => x.driverId === "d4");
    expect(d[0].total).toBe(-35200);
    const [i] = termsMissing(ctx({ month: NOV, drivers: [none], drafts: d }));
    expect(i.severity).toBe("red");
    expect(i.impact).toEqual({ yen: 35200, label: "遠藤 大輔さんの2026年11月分に差し引いた額（振込額は マイナス 35,200円）" });
  });

  it("記録にあった控除が今は無い：記録どおりなら引いていた額を差額にする（稼働した月だけの控除は、稼働が無ければ 0）", () => {
    const d = drafts(OCT, [aoki], work)[0];
    // 記録には管理費 15,000円（稼働した月だけ）。今の台帳には無い
    expect(termsChangeImpact(terms(), terms({ deductions: [] }), d)).toBe(15000);
    const idle = { ...d, hasWork: false, lines: [], subtotal: 0 };
    expect(termsChangeImpact(terms(), terms({ deductions: [] }), idle)).toBe(0);
    const [i] = termsOutdated(ctx({ drivers: [aoki], drafts: [d], terms: [termsRow("d1", terms(), terms({ deductions: [] }))] }));
    expect(i.detail).toContain("控除「管理費」が無くなった（毎月 15,000円（稼働した月だけ））");
    expect(i.impact?.yen).toBe(15000);
  });
});

describe("単価が下がった（rate_down）：合意した日の記録で赤と黄を分ける", () => {
  const work: WorkRow[] = [["d1", "p1", 1000]];
  const prev = drafts(SEP, [aoki], work);
  // 10 月は人ごとの単価 145 円（1,000個で 5,000円 下がる）
  const cur = drafts(OCT, [aoki], work, { overrides: [{ driverId: "d1", projectId: "p1", payRate: 145 }] });
  const override = (agreedOn: string | null, payRate = 145) => ({ id: "o1", driverId: "d1", projectId: "p1", payRate, agreedOn, updatedOn: "2026-09-20" });

  it("合意した日の記録が無い → 赤（締めを止める）。影響額は 5円 × 1,000個 = 5,000円", () => {
    const [i] = rateDown(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev, overrides: [override(null)] }));
    expect(i).toMatchObject({ code: "rate_down", severity: "red", subjectId: "d1:p1", title: "単価が下がっていますが、合意した日の記録がありません", fixHref: FIX.rates("d1", "p1") });
    expect(i.detail).toContain("150円 から 145円");
    expect(i.detail).toContain("この単価で合意した日の記録が見つかりません");
    expect(i.detail).toContain("報酬の減額にあたるおそれがあります");
    expect(i.impact).toEqual({ yen: 5000, label: "下がった分（単価の差 × この月の数量）" });
    // 合意した日が締めの期間の初日（10/1）より後 → 赤
    const [late] = rateDown(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev, overrides: [override("2026-10-15")] }));
    expect(late.severity).toBe("red");
    expect(late.detail).toContain("この単価で合意した日の記録（2026年10月15日）が、2026年10月分の締めの期間の初日（2026年10月1日）より後です");
    // 今の人ごとの単価（140 円）がこの月の単価（145 円）と違えば、その合意の日は使わない
    expect(rateDown(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev, overrides: [override("2026-09-20", 140)] }))[0].severity).toBe("red");
    // 期間の初日より後に作った取引条件の記録は、合意の代わりにならない
    const later = termsRow("d1", terms({ services: [{ projectId: "p1", name: "宅配", client: null, unit: "個", payRate: 145 }] }), null, { issuedOn: "2026-10-05" });
    expect(rateDown(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev, terms: [later] }))[0].severity).toBe("red");
  });

  it("期間の初日までに合意した日がある、または新しい単価を書いた取引条件の記録がある → 黄（協議した記録の確認）", () => {
    const [agreed] = rateDown(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev, overrides: [override("2026-10-01")] }));
    expect(agreed).toMatchObject({ severity: "yellow", title: "前月より単価が下がっています" });
    expect(agreed.detail).toContain("協議した記録を確認してください。この単価で合意した日の記録：2026年10月1日。");
    const noticed = termsRow("d1", terms({ services: [{ projectId: "p1", name: "宅配", client: null, unit: "個", payRate: 145 }] }), null, { issuedOn: "2026-09-25" });
    const [n] = rateDown(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev, terms: [noticed] }));
    expect(n.severity).toBe("yellow");
    expect(n.detail).toContain("取引条件の記録（版 2・2026年9月25日）に、この単価が書いてあります");
    expect(n.impact?.yen).toBe(5000);
    // 上がった・同じ → 出ない
    expect(rateDown(ctx({ drivers: [aoki], drafts: drafts(OCT, [aoki], work), prevDrafts: prev }))).toHaveLength(0);
  });
});

describe("振込手数料（fee_deducted）：2026年1月1日より前の月は「確認をおすすめ」に弱める", () => {
  const settings = { transferFeeBearer: "driver" as const };
  it("2025年12月分 → 黄（弱めた言い方）。2026年1月分 → 赤（合意があっても）", () => {
    const [dec] = feeDeducted(ctx({ month: "2025-12-01", today: "2025-12-31", tenant: { ...TENANT, settings } }));
    expect(dec).toMatchObject({ code: "fee_deducted", severity: "yellow", subjectId: "tenant" });
    expect(dec.detail).toContain(FEE_SENTENCE_EARLY);
    expect(dec.detail).not.toContain("合意があっても");
    const [jan] = feeDeducted(ctx({ month: "2026-01-01", today: "2026-01-31", tenant: { ...TENANT, settings } }));
    expect(jan).toMatchObject({ severity: "red" });
    expect(jan.detail).toContain(FEE_SENTENCE);
    // 会社の負担にしていれば出ない
    expect(feeDeducted(ctx({ month: "2025-12-01", tenant: { ...TENANT, settings: { transferFeeBearer: "company" } } }))).toHaveLength(0);
  });
});

describe("控除の合意の日（deduction_no_agreement）：締めの期間の初日と比べる", () => {
  it("20日締めの 10 月分（9/21〜）で、合意が 9/25 → 黄（期間の途中）。9/21 → 出ない", () => {
    const tenant20 = { ...CALC_TENANT, closingDay: 20 };
    const d = drafts(OCT, [aoki], [["d1", "p1", 100]], { tenant: tenant20, rules: [rule({ id: "r1", name: "管理費", amount: 5000 })] });
    expect(d[0].period.from).toBe("2026-09-21");
    const agreed = (agreedOn: string) => [{ id: "r1", name: "管理費", driverId: null, kind: "fixed", agreedInWriting: true, agreedOn, basis: "契約書", active: true }];
    const c = (agreedOn: string) => ctx({ tenant: { ...TENANT, closingDay: 20 }, drivers: [aoki], drafts: d, rules: agreed(agreedOn) });
    const [i] = deductionNoAgreement(c("2026-09-25"));
    expect(i).toMatchObject({ severity: "yellow", title: "控除の合意が、この月の途中です", impact: { yen: 5000 } });
    expect(i.detail).toContain("合意した日（2026年9月25日）が、2026年10月分の締めの期間の初日（2026年9月21日）より後です");
    expect(deductionNoAgreement(c("2026-09-21"))).toHaveLength(0);
  });
});

describe("振込額の急な変化（payout_swing）", () => {
  const refund = (amount: number) => ({ driverId: "d1", label: "燃料代の精算", amount, taxable: false, agreedInWriting: true });
  // 前の月：100個 × 150円 ＋ 消費税 1,500円 = 16,500円
  const prev = drafts(SEP, [aoki], [["d1", "p1", 100]]);

  it("数量は同じで、調整で振込額が 16,500 → 10,500円（−36%）→ 黄。影響額は差の 6,000円", () => {
    const cur = drafts(OCT, [aoki], [["d1", "p1", 100]], { adjustments: [refund(-6000)] });
    const [i] = payoutSwing(ctx({ drivers: [aoki], drafts: cur, prevDrafts: prev }));
    expect(i).toMatchObject({ code: "payout_swing", severity: "yellow", subjectId: "d1", title: "前の月より振込額が大きく減っています", fixHref: "/work?m=2026-10" });
    expect(i.detail).toContain("16,500円 から 10,500円");
    expect(i.detail).toContain("−36%");
    expect(i.detail).toContain("調整 0円 → マイナス 6,000円");
    expect(i.impact).toEqual({ yen: 6000, label: "振込額の前の月との差" });
    // 増えたときも出る（＋40%）
    const up = drafts(OCT, [aoki], [["d1", "p1", 100]], { adjustments: [refund(6600)] });
    expect(payoutSwing(ctx({ drivers: [aoki], drafts: up, prevDrafts: prev }))[0]).toMatchObject({ title: "前の月より振込額が大きく増えています", impact: { yen: 6600 } });
  });

  it("ちょうど 30%・数量の急な変化で出ている人・稼働の無い月・マイナスの人・前の月の明細が無い人 → 出ない", () => {
    expect(PAYOUT_SWING_RATIO).toBe(0.3);
    // 16,500 × 30% = 4,950円 減っても、30% を超えないので出ない
    const edge = drafts(OCT, [aoki], [["d1", "p1", 100]], { adjustments: [refund(-4950)] });
    expect(payoutSwing(ctx({ drivers: [aoki], drafts: edge, prevDrafts: prev }))).toHaveLength(0);
    // 数量が 100 → 200（＋100%）は qty_jump が出すので重ねない
    const qty = drafts(OCT, [aoki], [["d1", "p1", 200]]);
    expect(payoutSwing(ctx({ drivers: [aoki], drafts: qty, prevDrafts: prev }))).toHaveLength(0);
    // 振込額がマイナス（negative_total が赤で出す）
    const minus = drafts(OCT, [aoki], [["d1", "p1", 100]], { adjustments: [refund(-20000)] });
    expect(payoutSwing(ctx({ drivers: [aoki], drafts: minus, prevDrafts: prev }))).toHaveLength(0);
    // 前の月の明細が無い・今月の稼働が無い
    const cur = drafts(OCT, [aoki], [["d1", "p1", 100]], { adjustments: [refund(-6000)] });
    expect(payoutSwing(ctx({ drivers: [aoki], drafts: cur, prevDrafts: [] }))).toHaveLength(0);
    const idle = drafts(OCT, [aoki], [], { adjustments: [refund(3000)] });
    expect(payoutSwing(ctx({ drivers: [aoki], drafts: idle, prevDrafts: prev }))).toHaveLength(0);
  });
});

describe("控除の追加・増額（ded_new_or_up）", () => {
  const work: WorkRow[] = [["d1", "p1", 100]];
  const mgmt = (amount: number) => rule({ id: "r1", name: "管理費", amount });
  const watchRule = { id: "r1", name: "管理費", driverId: null, kind: "fixed", agreedInWriting: true, agreedOn: "2026-04-01", basis: "契約 第8条", active: true };

  it("前の月に無かった控除 → 黄（加わった額）。定額が 15,000 → 20,000 → 黄（増えた額 5,000円）", () => {
    const prev = drafts(SEP, [aoki], work);
    const [added] = dedNewOrUp(ctx({ drivers: [aoki], drafts: drafts(OCT, [aoki], work, { rules: [mgmt(3000)] }), prevDrafts: prev, rules: [watchRule] }));
    expect(added).toMatchObject({ code: "ded_new_or_up", severity: "yellow", subjectId: "d1:r1", title: "前の月には無かった控除が加わっています", basis: "フリーランス法 第5条（報酬の減額の禁止）" });
    expect(added.impact).toEqual({ yen: 3000, label: "加わった控除の額（税抜）" });
    expect(added.detail).toContain("前の月（2026年9月分）の明細にはありませんでした");
    expect(added.detail).toContain("合意の日：2026年4月1日");

    const [up] = dedNewOrUp(ctx({ drivers: [aoki], drafts: drafts(OCT, [aoki], work, { rules: [mgmt(20000)] }), prevDrafts: drafts(SEP, [aoki], work, { rules: [mgmt(15000)] }) }));
    expect(up.title).toBe("前の月より控除が増えています");
    expect(up.detail).toContain("15,000円 から 20,000円 に増えています");
    expect(up.impact?.yen).toBe(5000);
    expect(up.fixHref).toBe("/settings/rules?m=2026-10");
  });

  it("率が 10% → 12%：今月の委託料 15,000円で 300円 増える。数量あたり 30 → 35 円：100個で 500円", () => {
    const royalty = (rate: number) => rule({ id: "r2", name: "ロイヤリティ", kind: "percent", rate, amount: null });
    const [p] = dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], work, { rules: [royalty(0.12)] }), prevDrafts: drafts(SEP, [aoki], work, { rules: [royalty(0.1)] }) }));
    expect(p.detail).toContain("10% から 12% に上がっています");
    expect(p.impact?.yen).toBe(300);
    const unit = (rate: number) => rule({ id: "r3", name: "端末代", kind: "per_unit", rate, amount: null });
    const [u] = dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], work, { rules: [unit(35)] }), prevDrafts: drafts(SEP, [aoki], work, { rules: [unit(30)] }) }));
    expect(u.impact?.yen).toBe(500);
    expect(deductionMeasure({ amount: 1500, how: "委託料 15,000円 × 10%" })).toEqual({ kind: "percent", value: 0.1 });
    expect(deductionMeasure({ amount: 3500, how: "数量 100 × 35円" })).toEqual({ kind: "per_unit", value: 35 });
    expect(deductionMeasure({ amount: 5000, how: "毎月の定額" })).toEqual({ kind: "fixed", value: 5000 });
  });

  it("同じ額・同じ率（仕事が増えて額だけ増えた）・前の月に稼働が無い・振込手数料・前の月の明細が無い人 → 出ない", () => {
    const royalty = rule({ id: "r2", name: "ロイヤリティ", kind: "percent", rate: 0.1, amount: null });
    expect(dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], work, { rules: [mgmt(15000)] }), prevDrafts: drafts(SEP, [aoki], work, { rules: [mgmt(15000)] }) }))).toHaveLength(0);
    expect(dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], [["d1", "p1", 300]], { rules: [royalty] }), prevDrafts: drafts(SEP, [aoki], work, { rules: [royalty] }) }))).toHaveLength(0);
    // 前の月は調整だけ（稼働なし）→ 稼働した月だけの控除が前の月に無いのは当たり前
    const noWork = drafts(SEP, [aoki], [], { adjustments: [{ driverId: "d1", label: "立替", amount: 1000, taxable: false, agreedInWriting: true }], work: [{ driverId: "x", projectId: "p1", qty: 1 }] });
    expect(noWork[0].hasWork).toBe(false);
    expect(dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], work, { rules: [mgmt(15000)] }), prevDrafts: noWork }))).toHaveLength(0);
    const fee = rule({ id: "r9", name: "振込手数料", amount: 440 });
    expect(dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], work, { rules: [fee] }), prevDrafts: drafts(SEP, [aoki], work) }))).toHaveLength(0);
    expect(dedNewOrUp(ctx({ drafts: drafts(OCT, [aoki], work, { rules: [mgmt(3000)] }), prevDrafts: [] }))).toHaveLength(0);
  });
});

describe("違約金・ペナルティ（ded_penalty）", () => {
  const work: WorkRow[] = [["d1", "p1", 100], ["d3", "p1", 100]];

  it("控除「遅配ペナルティ」→ 黄（2人・合計）。調整「違約金」の差し引き → 黄。決まった言い方で書く", () => {
    const d = drafts(OCT, [aoki, inoue], work, { rules: [rule({ id: "r5", name: "遅配ペナルティ", amount: 2000 })] });
    const [r] = dedPenalty(ctx({ drivers: [aoki, inoue], drafts: d }));
    expect(r).toMatchObject({ code: "ded_penalty", severity: "yellow", subjectId: "r5", subjectLabel: "遅配ペナルティ（2人）", fixHref: "/settings/rules?m=2026-10" });
    expect(r.detail).toContain(PENALTY_SENTENCE);
    expect(r.impact).toEqual({ yen: 4000, label: "差し引いた額の合計（税抜・2人）" });
    const [a] = dedPenalty(ctx({ drivers: [aoki], adjustments: [{ id: "a1", driverId: "d1", label: "誤配の違約金", amount: -8000, agreedInWriting: true, basis: "契約 第12条" }] }));
    expect(a).toMatchObject({ subjectId: "adj:a1", subjectLabel: "青木 翔太・誤配の違約金", fixHref: "/work?m=2026-10&adj=a1#adjustments" });
    expect(a.impact?.yen).toBe(8000);
  });

  it("名前が違う控除・払う側の調整（罰金の立替の精算）→ 出ない", () => {
    const d = drafts(OCT, [aoki], work, { rules: [rule({ id: "r1", name: "管理費", amount: 15000 })] });
    expect(dedPenalty(ctx({ drivers: [aoki], drafts: d }))).toHaveLength(0);
    expect(dedPenalty(ctx({ drivers: [aoki], adjustments: [{ id: "a1", driverId: "d1", label: "駐車違反の罰金の立替", amount: 9000, agreedInWriting: true, basis: "領収書" }] }))).toHaveLength(0);
  });
});

describe("登録の無い方だけ単価が下がった（exempt_only_cut）", () => {
  const work: WorkRow[] = [["d1", "p1", 1000], ["d2", "p1", 800]];
  const prev = drafts(SEP, [aoki, ueda], work);

  it("上田さん（登録なし）だけ 150 → 140 円、青木さん（登録あり）は 150 円のまま → 赤。影響額 10円 × 800個 = 8,000円", () => {
    const cur = drafts(OCT, [aoki, ueda], work, { overrides: [{ driverId: "d2", projectId: "p1", payRate: 140 }] });
    const [i] = exemptOnlyCut(ctx({ drivers: [aoki, ueda], drafts: cur, prevDrafts: prev }));
    expect(i).toMatchObject({ code: "exempt_only_cut", severity: "red", subjectId: "p1", sourceUrl: SOURCES.exemptQa, fixHref: FIX.rates("d2", "p1") });
    expect(i.title).toBe("登録の無い方だけ単価が下がっています");
    expect(i.detail.startsWith(EXEMPT_CUT_SENTENCE)).toBe(true);
    expect(EXEMPT_CUT_SENTENCE).toBe("登録の無い方だけ単価が下がっています。取引の条件を協議した記録を確認してください。");
    expect(i.detail).toContain("上田 健さん（150円 → 140円）");
    expect(i.detail).toContain("登録のある 1人（青木 翔太）は下がっていません");
    expect(i.impact).toEqual({ yen: 8000, label: "下がった分（単価の差 × この月の数量）" });
    // 報酬を下げる話はしない・判定もしない
    expect(i.detail).not.toMatch(FORBIDDEN);
  });

  it("登録のある方も下がった・登録のある方がその案件にいない・上がった → 出ない", () => {
    const both = drafts(OCT, [aoki, ueda], work, { overrides: [{ driverId: "d2", projectId: "p1", payRate: 140 }, { driverId: "d1", projectId: "p1", payRate: 145 }] });
    expect(exemptOnlyCut(ctx({ drafts: both, prevDrafts: prev }))).toHaveLength(0);
    const onlyExempt = drafts(OCT, [aoki, ueda], [["d2", "p1", 800], ["d1", "p2", 20]], { overrides: [{ driverId: "d2", projectId: "p1", payRate: 140 }] });
    expect(exemptOnlyCut(ctx({ drafts: onlyExempt, prevDrafts: drafts(SEP, [aoki, ueda], [["d2", "p1", 800], ["d1", "p2", 20]]) }))).toHaveLength(0);
    const up = drafts(OCT, [aoki, ueda], work, { overrides: [{ driverId: "d2", projectId: "p1", payRate: 160 }] });
    expect(exemptOnlyCut(ctx({ drafts: up, prevDrafts: prev }))).toHaveLength(0);
  });
});

describe("稼働の無い月の控除（ded_without_work）", () => {
  const lease = rule({ id: "r3", driverId: "d2", name: "車両リース", amount: 32000, onlyWhenWorked: false });

  it("遠藤さんのように、稼働の無い月に車両リースだけ → 黄。影響額は 32,000 ＋ 消費税 3,200 = 35,200円", () => {
    // 会社としてはその月に稼働がある（ほかの人が働いている）
    const d = drafts(NOV, [aoki, ueda], [["d1", "p1", 100]], { rules: [lease] });
    const [i] = dedWithoutWork(ctx({ month: NOV, drivers: [aoki, ueda], drafts: d }));
    expect(i).toMatchObject({ code: "ded_without_work", severity: "yellow", subjectId: "d2", subjectLabel: "上田 健", fixHref: "/settings/rules?m=2026-11&driver=d2" });
    expect(i.impact).toEqual({ yen: 35200, label: "差し引く額（消費税を含む）" });
    expect(i.detail).toContain("「車両リース」32,000円");
    expect(i.detail).toContain("振込額は マイナス 35,200円です");
  });

  it("稼働がある月・稼働した月だけ引く控除 → 出ない", () => {
    expect(dedWithoutWork(ctx({ drafts: drafts(NOV, [ueda], [["d2", "p1", 10]], { rules: [lease] }) }))).toHaveLength(0);
    const onlyWorked = rule({ id: "r4", driverId: "d2", name: "管理費", amount: 15000 });
    expect(dedWithoutWork(ctx({ drafts: drafts(NOV, [aoki, ueda], [["d1", "p1", 100]], { rules: [onlyWorked] }) }))).toHaveLength(0);
  });
});

describe("経過措置の境目（transitional_span）と次の段（transitional_next）", () => {
  const twenty = { ...CALC_TENANT, closingDay: 20 };

  it("20日締めの 10 月分（9/21〜10/20）で、登録の無い方の稼働に日付が無い → 黄。差は多くて 1,500円（80% と 70% の差）", () => {
    const d = drafts(OCT, [ueda], [["d2", "p1", 1000]], { tenant: twenty });
    expect(d[0].undatedAcrossStep).toBe(true);
    const [i] = transitionalSpan(ctx({ tenant: { ...TENANT, closingDay: 20 }, drafts: d }));
    expect(i).toMatchObject({ code: "transitional_span", severity: "yellow", title: "締めの期間が経過措置の境目をまたいでいて、日付の無い稼働があります", sourceUrl: SOURCES.invoiceTransitional });
    // 税込 165,000 円：10/20 の割合（70%）で 4,500 円、9/21 の割合（80%）で 3,000 円
    expect(nonDeductibleTax(165000, "2026-10-20") - nonDeductibleTax(165000, "2026-09-21")).toBe(1500);
    expect(i.impact).toEqual({ yen: 1500, label: "期間の初日の割合で数えた場合との差（多くて）" });
    expect(i.detail).toContain("2026年9月21日〜2026年10月20日");
    expect(i.detail).toContain("途中の2026年10月1日で");
  });

  it("日付がある・末締め（またがない）・登録のある方 → 出ない", () => {
    const dated = drafts(OCT, [ueda], [["d2", "p1", 500, "2026-09-25"], ["d2", "p1", 500, "2026-10-05"]], { tenant: twenty });
    expect(transitionalSpan(ctx({ drafts: dated }))).toHaveLength(0);
    expect(transitionalSpan(ctx({ drafts: drafts(OCT, [ueda], [["d2", "p1", 1000]]) }))).toHaveLength(0);
    expect(transitionalSpan(ctx({ drafts: drafts(OCT, [aoki], [["d1", "p1", 1000]], { tenant: twenty }) }))).toHaveLength(0);
  });

  it("9 月分：翌月（2026-10-01）から 80% → 70%。同じ支払額なら月 3,000 → 4,500円（1,500円 増える）→ お知らせ", () => {
    const d = drafts(SEP, [ueda], [["d2", "p1", 1000]]);
    const [i] = transitionalNext(ctx({ month: SEP, drafts: d }));
    expect(i).toMatchObject({ code: "transitional_next", severity: "info", title: "2026年10月から、経過措置の控除できる割合が変わります" });
    expect(i.detail).toContain("80% から 70%");
    expect(i.detail).toContain("月 3,000円 から 4,500円");
    expect(i.detail).toContain("ドライバーへの支払額は変わりません");
    expect(i.impact).toEqual({ yen: 1500, label: "次の段での月の負担増（見込み）" });
    // 2028年4月分：半年以内に 2028-10-01（50%）が来る → 4,500 → 7,500
    const apr = "2028-04-01";
    expect(transitionalNext(ctx({ month: apr, drafts: drafts(apr, [ueda], [["d2", "p1", 1000]]) }))[0].impact?.yen).toBe(3000);
  });

  it("次の段まで 6 か月より先・登録のある方だけ・最後の段のあと → 出ない", () => {
    const mar = "2028-03-01";
    expect(transitionalNext(ctx({ month: mar, drafts: drafts(mar, [ueda], [["d2", "p1", 1000]]) }))).toHaveLength(0);
    expect(transitionalNext(ctx({ drafts: drafts(OCT, [ueda], [["d2", "p1", 1000]]) }))).toHaveLength(0);
    expect(transitionalNext(ctx({ month: SEP, drafts: drafts(SEP, [aoki], [["d1", "p1", 1000]]) }))).toHaveLength(0);
    const late = "2031-11-01";
    expect(transitionalNext(ctx({ month: late, drafts: drafts(late, [ueda], [["d2", "p1", 1000]]) }))).toHaveLength(0);
  });
});

describe("稼働の重なり（duplicate_rows）", () => {
  it("同じ人・同じ案件・同じ日付が 2 行 → 赤。重なった分 100個 × 150円 = 15,000円。3 行（100・100・50）なら 150個分", () => {
    const rows = [
      { driverId: "d1", projectId: "p1", workDate: "2026-10-05", qty: 100 },
      { driverId: "d1", projectId: "p1", workDate: "2026-10-05", qty: 100 },
    ];
    const d = drafts(OCT, [aoki], rows.map((r) => [r.driverId, r.projectId, r.qty, r.workDate] as WorkRow));
    const [i] = duplicateRows(ctx({ drivers: [aoki], drafts: d, workRows: rows }));
    expect(i).toMatchObject({ code: "duplicate_rows", severity: "red", subjectId: "d1", fixHref: "/work?m=2026-10" });
    expect(i.detail).toContain("2026年10月5日 宅配 2行（100個・100個）");
    expect(i.impact).toEqual({ yen: 15000, label: "重なっている分の支払" });
    const three = [...rows, { ...rows[0], qty: 50 }];
    const d3 = drafts(OCT, [aoki], three.map((r) => [r.driverId, r.projectId, r.qty, r.workDate] as WorkRow));
    expect(duplicateRows(ctx({ drivers: [aoki], drafts: d3, workRows: three }))[0].impact?.yen).toBe(22500);
  });

  it("日付が違う・案件が違う・人が違う・数量 0 の行 → 出ない", () => {
    const d = drafts(OCT, [aoki, inoue], [["d1", "p1", 200], ["d1", "p2", 1], ["d3", "p1", 100]]);
    const rows = [
      { driverId: "d1", projectId: "p1", workDate: "2026-10-05", qty: 100 },
      { driverId: "d1", projectId: "p1", workDate: "2026-10-06", qty: 100 },
      { driverId: "d1", projectId: "p2", workDate: "2026-10-05", qty: 1 },
      { driverId: "d3", projectId: "p1", workDate: "2026-10-05", qty: 100 },
      { driverId: "d3", projectId: "p1", workDate: "2026-10-05", qty: 0 },
    ];
    expect(duplicateRows(ctx({ drivers: [aoki, inoue], drafts: d, workRows: rows }))).toHaveLength(0);
    expect(duplicateRows(ctx({ drafts: d }))).toHaveLength(0);
  });

  it("出どころで重さを分ける：1 つのファイルで数量の違う行（便ごと）は黄、別々の取り込み・同じ数量・手入力の重なりは赤", () => {
    const row = (qty: number, batchId: string | null, date = "2026-10-05") => ({ driverId: "d1", projectId: "p1", workDate: date, qty, batchId });
    const run = (rows: ReturnType<typeof row>[]) =>
      duplicateRows(ctx({ drivers: [aoki], drafts: drafts(OCT, [aoki], rows.map((r) => ["d1", "p1", r.qty, r.workDate] as WorkRow)), workRows: rows }));
    // 1 つのファイルの中の 1 便 100個・2 便 50個 → 黄。二重に書いた行なら 50個 × 150円 = 7,500円 の払いすぎ
    const [split] = run([row(100, "b1"), row(50, "b1")]);
    expect(split).toMatchObject({ code: "duplicate_rows", severity: "yellow", title: "同じ日・同じ案件の行が、1 つのファイルの中で分かれています" });
    expect(split.detail).toContain("便や時間帯で行を分けているなら、そのままで構いません");
    expect(split.detail).toContain("払いすぎは 7,500円");
    expect(split.impact).toEqual({ yen: 7500, label: "二重に書いた行なら払いすぎになる額" });
    // 同じファイルでも同じ数量が並ぶ → 赤（二重の記入のおそれ）
    expect(run([row(100, "b1"), row(100, "b1")])[0]).toMatchObject({ severity: "red", impact: { yen: 15000, label: "重なっている分の支払" } });
    // 別々の取り込みから同じ日の行 → 赤（数量が違っても）
    expect(run([row(100, "b1"), row(50, "b2")])[0]).toMatchObject({ severity: "red", impact: { yen: 7500 } });
    // 取り込み ＋ 手入力、手入力 2 行 → 赤
    expect(run([row(100, "b1"), row(50, null)])[0].severity).toBe("red");
    expect(run([row(100, null), row(50, null)])[0].severity).toBe("red");
    // 1 人に黄の日と赤の日があれば、まとめて赤。赤の日（10/9）を先に書き、影響額は両方の合計（50個 ＋ 100個 分）
    const [mixed] = run([row(100, "b1"), row(50, "b1"), row(100, "b1", "2026-10-09"), row(100, "b2", "2026-10-09")]);
    expect(mixed.severity).toBe("red");
    expect(mixed.detail.indexOf("2026年10月9日")).toBeLessThan(mixed.detail.indexOf("2026年10月5日"));
    expect(mixed.impact?.yen).toBe(22500);
  });
});

describe("明細への質問（open_questions）", () => {
  const d = drafts(OCT, [aoki], [["d1", "p1", 100]], { rules: [rule({ id: "r1", name: "管理費", amount: 5000 })], adjustments: [{ driverId: "d1", label: "駐車場代の立替", amount: 3300, taxable: false, agreedInWriting: true }] })[0];

  it("質問の行の名前と金額を、保存した明細の写しから引く", () => {
    expect(questionLine(d, "p1")).toEqual({ label: "宅配", amount: 15000 });
    expect(questionLine(d, "r1")).toEqual({ label: "控除「管理費」", amount: 5000 });
    expect(questionLine(d, "adj:0")).toEqual({ label: "調整「駐車場代の立替」", amount: 3300 });
    expect(questionLine(d, null)).toEqual({ label: "明細全体", amount: null });
    expect(questionLine(d, "adj:9")).toEqual({ label: "前の版の行", amount: null });
  });

  it("未解決の質問 → 黄（人ごと）。同じ行への 2 件は 1 行として数える。返事は締めたあとでもできる", () => {
    const q = (lineKey: string | null, askedOn: string) => ({ statementId: "s1", driverId: "d1", lineKey, askedOn, line: questionLine(d, lineKey) });
    const [i] = openQuestions(ctx({ drivers: [aoki], drafts: [d], questions: [q("p1", "2026-10-28"), q("p1", "2026-10-29"), q("r1", "2026-10-30")] }));
    expect(i).toMatchObject({ code: "open_questions", severity: "yellow", subjectId: "d1", fixHref: "/statements/s1" });
    expect(i.detail).toContain("質問が 3件");
    expect(i.detail).toContain("宅配・控除「管理費」");
    expect(i.detail).toContain("2026年10月28日（3日前）");
    expect(i.impact).toEqual({ yen: 20000, label: "質問の行の金額" });
    expect(fixLink(i.fixHref!, { role: "staff", closed: true })).toMatchObject({ text: "返事をする（明細のやりとり）", canFix: true });
    expect(fixLink(i.fixHref!, { role: "viewer", closed: false }).text).toBe("見る（明細のやりとり）");
    expect(ackAllowed("open_questions", true)).toBe(true);
    // 明細全体への質問だけで、明細の振込額が分からなければ、影響額は出せない
    const [whole] = openQuestions(ctx({ drivers: [aoki], questions: [q(null, "2026-10-31")] }));
    expect(whole.impact).toEqual({ yen: null, label: "明細全体への質問のため出せません" });
  });

  it("明細全体への質問は、その明細の振込額を影響額にする（行の質問と重ねて足さない）。振込額が 0 円以下なら行の金額", () => {
    const q = (lineKey: string | null) => ({ statementId: "s1", driverId: "d1", lineKey, askedOn: "2026-10-30", line: questionLine(d, lineKey) });
    const statements = [{ id: "s1", driverId: "d1", total: d.total, payDate: d.payDate }];
    // 15,000 ＋ 1,500 − 5,000 − 500 ＋ 3,300 = 14,300円
    expect(d.total).toBe(14300);
    const [whole] = openQuestions(ctx({ drivers: [aoki], statements, questions: [q(null), q("p1")] }));
    expect(whole.impact).toEqual({ yen: 14300, label: "振込額（明細全体への質問があるため）" });
    // 他の明細（別の id）の振込額は使わない
    const [other] = openQuestions(ctx({ drivers: [aoki], statements: [{ ...statements[0], id: "s9" }], questions: [q(null), q("p1")] }));
    expect(other.impact).toEqual({ yen: 15000, label: "質問の行の金額" });
    const [zero] = openQuestions(ctx({ drivers: [aoki], statements: [{ ...statements[0], total: -100 }], questions: [q(null), q("r1")] }));
    expect(zero.impact).toEqual({ yen: 5000, label: "質問の行の金額" });
  });

  it("未解決の質問が無い → 出ない", () => {
    expect(openQuestions(ctx({ drivers: [aoki], drafts: [d], questions: [] }))).toHaveLength(0);
    expect(openQuestions(ctx({ drivers: [aoki], drafts: [d] }))).toHaveLength(0);
  });
});

describe("前の月の支払の遅れ（late_payment_prev）", () => {
  const st = { id: "ps1", driverId: "d1", total: 357555, payDate: "2026-10-26" };
  const batch = { id: "pb1", fileName: "振込_9月分.txt", transferDate: "2026-10-26", executedOn: "2026-10-28", statementIds: ["ps1"] };

  it("9 月分の振込が支払期日（10/26）の 2 日後 → 赤。影響額は遅れた人の支払額。締めたあとでも確認済みにできる", () => {
    const [i] = latePaymentPrev(ctx({ drivers: [aoki], prevStatements: [st], prevBatches: [batch] }));
    expect(i).toMatchObject({ code: "late_payment_prev", severity: "red", subjectId: "prev:pb1", subjectLabel: "2026年9月分の振込データ 振込_9月分.txt", fixHref: "/transfer?m=2026-09" });
    expect(i.detail).toContain("2026年10月28日で、明細の支払期日（2026年10月26日）より 2日後です");
    expect(i.detail).toContain("青木 翔太（1人・合計 357,555円）");
    expect(i.impact).toEqual({ yen: 357555, label: "遅れて払った額の合計（前の月）" });
    expect(ackAllowed("late_payment_prev", true)).toBe(true);
    // 今月の振込の遅れ（paid_late）とは別に数える
    expect(paidLate(ctx({ drivers: [aoki], prevStatements: [st], prevBatches: [batch] }))).toHaveLength(0);
  });

  it("期日どおり・振り込んだ日の記録が無い・他の月の明細 → 出ない", () => {
    expect(latePaymentPrev(ctx({ drivers: [aoki], prevStatements: [st], prevBatches: [{ ...batch, executedOn: "2026-10-26" }] }))).toHaveLength(0);
    expect(latePaymentPrev(ctx({ drivers: [aoki], prevStatements: [st], prevBatches: [{ ...batch, executedOn: null }] }))).toHaveLength(0);
    expect(latePaymentPrev(ctx({ drivers: [aoki], prevStatements: [], prevBatches: [batch] }))).toHaveLength(0);
  });
});

describe("60日（2か月）と再委託の特例（sixty_days）", () => {
  const late = { ...TENANT, payMonthOffset: 3, payDay: 5 };
  const lateCalc = { ...CALC_TENANT, payMonthOffset: 3, payDay: 5 };
  const work: WorkRow[] = [["d1", "p1", 1000], ["d3", "p1", 100]];
  const d = drafts(OCT, [aoki, inoue], work, { tenant: lateCalc });
  const sub = (over: Partial<WatchTerms["subcontract"]> = {}) => termsRow("d1", terms(), terms(), { subcontract: { isSubcontract: true, originalClient: "A物流（架空）", originalPayDate: "翌々月末日", ...over } });

  it("元委託の支払期日の読み方", () => {
    expect(originalPayDateFor(OCT, "2026-11-30")).toBe("2026-11-30");
    expect(originalPayDateFor(OCT, "2026年12月1日")).toBe("2026-12-01");
    expect(originalPayDateFor(OCT, "翌月末日")).toBe("2026-11-30");
    // 取引条件の画面の例の書き方（元委託の締めと支払の文）
    expect(originalPayDateFor(OCT, "毎月末日締め・翌月末日払い")).toBe("2026-11-30");
    expect(originalPayDateFor(OCT, "毎月20日締め・翌々月10日払い")).toBe("2026-12-10");
    expect(originalPayDateFor(OCT, "２か月後の末日")).toBe("2026-12-31");
    expect(originalPayDateFor(OCT, "当月25日")).toBe("2026-10-25");
    expect(originalPayDateFor("2026-12-01", "翌月31日")).toBe("2027-01-31");
    expect(originalPayDateFor(OCT, "2026-02-30")).toBeNull();
    expect(originalPayDateFor(OCT, "元請の締め次第")).toBeNull();
    expect(hasSubcontractItems({ isSubcontract: true, originalClient: "A物流", originalPayDate: "翌月末日" })).toBe(true);
    expect(hasSubcontractItems({ isSubcontract: true, originalClient: " ", originalPayDate: "翌月末日" })).toBe(false);
    expect(hasSubcontractItems(null)).toBe(false);
  });

  it("3か月後払いは赤。影響額は対象の方の支払額の合計", () => {
    const [i] = sixtyDays(ctx({ tenant: late, drafts: d }));
    expect(i.severity).toBe("red");
    expect(i.impact?.yen).toBe(d[0].total + d[1].total);
  });

  it("再委託の 3 項目がある人は、元委託の支払期日（12/31）を 1 日目に 30 日（1/29）で数えて外す。残りの人の額だけを影響額にする", () => {
    const [i] = sixtyDays(ctx({ tenant: late, drafts: d, terms: [sub()] }));
    expect(i.severity).toBe("red");
    expect(i.detail).toContain("青木 翔太さん（元委託の支払期日 2026年12月31日・特例の期限 2027年1月29日）は、取引条件の記録に再委託の3項目");
    const inoueDraft = d.find((x) => x.driverId === "d3")!;
    expect(i.impact).toEqual({ yen: inoueDraft.total, label: "対象の方の2026年10月分の支払額の合計（1人）" });
    // 全員が特例の中なら、赤ではなく「特例で数えています」のお知らせ
    const onlyAoki = drafts(OCT, [aoki], [["d1", "p1", 1000]], { tenant: lateCalc });
    const [info] = sixtyDays(ctx({ tenant: late, drafts: onlyAoki, terms: [sub()] }));
    expect(info).toMatchObject({ severity: "info", title: "再委託の特例（元委託の支払期日から30日）で数えています", basis: "フリーランス法 第4条第3項（再委託の支払期日）" });
    expect(info.detail).not.toMatch(FORBIDDEN);
  });

  it("3 項目がそろわない・元委託の支払期日が読めない・特例の期限も過ぎる → 60日で数えたまま", () => {
    const noClient = sixtyDays(ctx({ tenant: late, drafts: d, terms: [sub({ originalClient: "" })] }))[0];
    expect(noClient.impact?.yen).toBe(d[0].total + d[1].total);
    expect(noClient.detail).not.toContain("特例");
    const unreadable = sixtyDays(ctx({ tenant: late, drafts: d, terms: [sub({ originalPayDate: "元請の締め次第" })] }))[0];
    expect(unreadable.detail).toContain("元委託の支払期日を日付として読めないため、60日で数えています");
    expect(unreadable.impact?.yen).toBe(d[0].total + d[1].total);
    // 元委託の支払期日が 11/30 → 特例の期限 12/29。支払日 1/5 はそれも過ぎる
    const over = sixtyDays(ctx({ tenant: late, drafts: d, terms: [sub({ originalPayDate: "翌月末日" })] }))[0];
    expect(over.severity).toBe("red");
    expect(over.detail).toContain("再委託の特例で数えても期限を過ぎます");
    expect(over.impact?.yen).toBe(d[0].total + d[1].total);
    // 60日の中なら、特例に関係なく出さない
    expect(sixtyDays(ctx({ drafts: drafts(OCT, [aoki], [["d1", "p1", 1000]]), terms: [sub()] }))).toHaveLength(0);
  });
});

describe("影響額・時点・並べ方（ルール全体）", () => {
  it("同じ重さの中は影響額の大きい順、出せないもの（null）は後ろ", () => {
    const i = (severity: "red" | "yellow" | "info", code: string, yen: number | null) => ({ severity, code, subjectLabel: code, impact: { yen, label: "" } });
    const sorted = sortIssues([i("yellow", "no_bank", 5000), i("red", "terms_missing", 1000), i("red", "fee_deducted", null), i("red", "negative_total", 65570), i("yellow", "qty_jump", 90000)]);
    expect(sorted.map((x) => x.code)).toEqual(["negative_total", "terms_missing", "fee_deducted", "qty_jump", "no_bank"]);
  });

  it("あとから足したルールも一覧にあり、どれも陽性の記録で出る。文面に言ってはいけないことが無く、影響額と時点が付く", () => {
    const newCodes = ["terms_outdated", "ded_new_or_up", "ded_penalty", "exempt_only_cut", "ded_without_work", "transitional_span", "transitional_next", "duplicate_rows", "open_questions", "late_payment_prev", "payout_swing"];
    expect(RULES.map((r) => r.doc.code)).toEqual(expect.arrayContaining(newCodes));
    for (const r of RULES) {
      expect(r.doc.asOf, r.doc.code).toMatch(/^\d{4}-\d{2}$/);
      if (r.doc.sourceUrl) expect(Object.values(SOURCES) as string[]).toContain(r.doc.sourceUrl);
    }

    // 10 月（開いている月）：条件・控除・単価・重なり・質問・前の月の振込
    const lease = rule({ id: "r3", driverId: "d4", name: "車両リース", amount: 32000, onlyWhenWorked: false });
    const penalty = rule({ id: "r5", name: "遅配ペナルティ", amount: 2000 });
    const endo = driver("d4", "遠藤 大輔", { invoiceRegistered: false, registrationNo: null });
    const all = [aoki, ueda, inoue, endo];
    const rows = [
      { driverId: "d1", projectId: "p1", workDate: "2026-10-05", qty: 100 },
      { driverId: "d1", projectId: "p1", workDate: "2026-10-05", qty: 100 },
    ];
    const work: WorkRow[] = [["d1", "p1", 100, "2026-10-05"], ["d1", "p1", 100, "2026-10-05"], ["d2", "p1", 800], ["d3", "p1", 500]];
    const cur = drafts(OCT, all, work, { overrides: [{ driverId: "d2", projectId: "p1", payRate: 140 }], rules: [lease, penalty] });
    const prev = drafts(SEP, all, [["d1", "p1", 200], ["d2", "p1", 800], ["d3", "p1", 500]], { rules: [lease] });
    const now = terms({ services: [{ projectId: "p1", name: "宅配", client: "A物流（架空）", unit: "個", payRate: 140 }] });
    const c1 = ctx({
      drivers: all,
      drafts: cur,
      prevDrafts: prev,
      workRows: rows,
      terms: [termsRow("d2", terms(), now)],
      questions: [{ statementId: "s3", driverId: "d3", lineKey: "p1", askedOn: "2026-10-30", line: { label: "宅配", amount: 75000 } }],
      prevStatements: [{ id: "ps1", driverId: "d1", total: 30000, payDate: "2026-10-26" }],
      prevBatches: [{ id: "pb1", fileName: "振込.txt", transferDate: "2026-10-26", executedOn: "2026-10-27", statementIds: ["ps1"] }],
    });
    // 11 月（遠藤さんは稼働なしでリースだけ）・9 月（次の段が翌月）・20 日締め（境目をまたぐ）
    const c2 = ctx({ month: NOV, drivers: all, drafts: drafts(NOV, all, [["d1", "p1", 100]], { rules: [lease] }) });
    const c3 = ctx({ month: SEP, drafts: drafts(SEP, [ueda], [["d2", "p1", 1000]]) });
    const c4 = ctx({ tenant: { ...TENANT, closingDay: 20 }, drafts: drafts(OCT, [ueda], [["d2", "p1", 1000]], { tenant: { ...CALC_TENANT, closingDay: 20 } }) });
    // 振込額だけが大きく動いた（調整）
    const c5 = ctx({
      drivers: [aoki],
      drafts: drafts(OCT, [aoki], [["d1", "p1", 100]], { adjustments: [{ driverId: "d1", label: "燃料代の精算", amount: -6000, taxable: false, agreedInWriting: true }] }),
      prevDrafts: drafts(SEP, [aoki], [["d1", "p1", 100]]),
    });
    const issues = [c1, c2, c3, c4, c5].flatMap((c) => evaluateRules(c));
    const codes = new Set(issues.map((i) => i.code));
    for (const code of newCodes) expect(codes, code).toContain(code);
    for (const i of issues) {
      expect(`${i.title}${i.detail}${i.basis ?? ""}${i.subjectLabel}${i.impact?.label ?? ""}`, i.code).not.toMatch(FORBIDDEN);
      expect(i.impact, i.code).toBeDefined();
      expect(i.asOf, i.code).toBe("2026年9月");
      if (i.sourceUrl) expect(Object.values(SOURCES) as string[]).toContain(i.sourceUrl);
    }
  });

  it("法律が始まる前の月には、その法律のルールを当てない（数字のおかしなところは見る）", () => {
    const month = "2024-10-01";
    const none = driver("d1", "青木 翔太", { termsFirstIssuedOn: null, termsLatestIssuedOn: null });
    const d = drafts(month, [none], [["d1", "p1", 10]], { adjustments: [{ driverId: "d1", label: "事故の弁償", amount: -90000, taxable: false, agreedInWriting: true }] });
    const issues = evaluateRules(ctx({ month, today: "2024-10-31", drivers: [none], drafts: d }));
    expect(issues.map((i) => i.code)).not.toContain("terms_missing");
    expect(issues.map((i) => i.code)).not.toContain("toriteki");
    expect(issues.map((i) => i.code)).toContain("negative_total");
    // 11 月からは当てる
    const nov = "2024-11-01";
    const later = evaluateRules(ctx({ month: nov, today: "2024-11-30", drivers: [none], drafts: drafts(nov, [none], [["d1", "p1", 10]]) }));
    expect(later.map((i) => i.code)).toContain("terms_missing");
  });
});
