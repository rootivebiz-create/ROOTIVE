import { describe, expect, it } from "vitest";
import { paymentDeadlineCheck, type DayOfMonth, type PayMonthOffset } from "@/lib/tools/torihiki-joken";
import { buildStatementDrafts, payDateFor, type BuildInput, type CalcRule } from "~/server/calc/statement";
import {
  contractEnd,
  deductionNoAgreement,
  evaluateRules,
  feeDeducted,
  invoiceBurden,
  invoiceNumber,
  nameList,
  negativeTotal,
  noBank,
  paidLate,
  payDeadlineFor,
  paymentWording,
  REGISTRATION_CHECK_DAYS,
  TORITEKI_EMPLOYEES,
  qtyJump,
  rateChangedWithoutRecord,
  rateDown,
  RULES,
  sixtyDays,
  sortIssues,
  statementsStale,
  termsMissing,
  toriteki,
  totalBreakdown,
  workMissing,
} from "~/server/features/watch/rules";
import { ackAllowed } from "~/server/features/watch/acks";
import { FIX, fixLink, SOURCES } from "~/server/features/watch/sources";
import { countIssues, groupBySeverity } from "~/server/features/watch/summary";
import type { WatchContext, WatchDriver } from "~/server/features/watch/types";
import type { WatchIssue } from "~/server/features/watch-types";

/**
 * 見張り番のルール（純関数）を、ルールごとに「出る」「出ない」の両方で確かめる。
 * 明細は本物の計算（buildStatementDrafts）で作る。
 */

const OCT = "2026-10-01";
const SEP = "2026-09-01";
const FORBIDDEN = /(?<!取)適法|違反です|違反はありません|問題ありません|法令に完全対応|大丈夫|必ず合う|ミスゼロ|完全自動|補助金|単価を下げ|引き下げ|偽装請負|労働者に当た/;

const TENANT = { closingDay: 0, payMonthOffset: 1, payDay: 25, taxMethod: "general", settings: {} };

/** 最初に作ったルール（この中の記録で全部出ることを確かめる） */
const FIRST_WAVE_CODES = [
  "terms_missing",
  "sixty_days",
  "paid_late",
  "fee_deducted",
  "deduction_no_agreement",
  "negative_total",
  "payment_wording",
  "rate_changed_without_record",
  "rate_down",
  "contract_end",
  "no_bank",
  "qty_jump",
  "statements_stale",
  "invoice_number",
  "invoice_burden",
  "toriteki",
  "work_missing",
];

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

type WorkRow = [driverId: string, projectId: string, qty: number];

function drafts(month: string, drivers: WatchDriver[], work: WorkRow[], extra: Partial<BuildInput> = {}) {
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
    work: work.map(([driverId, projectId, qty]) => ({ driverId, projectId, qty })),
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

describe("60日（2か月）：サイトの道具と同じ判定", () => {
  it("締め日・支払月・支払日の組み合わせ 108 通り × 12 か月で、道具の判定と一致する", () => {
    const closings: DayOfMonth[] = [5, 10, 15, 20, 25, "末"];
    const payDays: DayOfMonth[] = [5, 10, 15, 20, 25, "末"];
    const offsets: PayMonthOffset[] = [0, 1, 2];
    let compared = 0;
    for (const closingDay of closings) {
      for (const payMonthOffset of offsets) {
        for (const payDay of payDays) {
          const tool = paymentDeadlineCheck({ closingDay, payMonthOffset, payDay, holidayRule: "before", serviceFrom: "2027-01-01", months: 13 });
          if (tool.error) continue;
          const tenant = { ...TENANT, closingDay: closingDay === "末" ? 0 : closingDay, payMonthOffset, payDay: payDay === "末" ? 0 : payDay };
          // 最初の行は途中から始まる期間なので、2 行目から（まるごとの締め期間）比べる
          for (const row of tool.rows.slice(1)) {
            const month = `${row.closingMonth}-01`;
            const ours = payDeadlineFor(month, tenant, payDateFor(month, tenant));
            expect(ours).not.toBeNull();
            expect({ month, start: ours!.periodStart, end: ours!.periodEnd, status: ours!.status }).toEqual({ month, start: row.periodStart, end: row.periodEnd, status: row.status });
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("末締め・翌月25日払い → 出ない。20日締め・翌月末払い → 黄。3か月後払い → 赤", () => {
    expect(sixtyDays(ctx())).toHaveLength(0);
    const caution = sixtyDays(ctx({ tenant: { ...TENANT, closingDay: 20, payDay: 0 } }));
    expect(caution[0]).toMatchObject({ code: "sixty_days", severity: "yellow", subjectId: "tenant", fixHref: "/settings/company?m=2026-10", sourceUrl: SOURCES.flGuidelines });
    expect(caution[0].detail).toContain("毎月20日締め・翌月末日払い");
    const ng = sixtyDays(ctx({ tenant: { ...TENANT, payMonthOffset: 3, payDay: 5 } }));
    expect(ng[0].severity).toBe("red");
    expect(ng[0].detail).toContain("3か月後の5日払い");
  });

  it("支払日が銀行の休みの日なら、道具と同じく前の営業日で数え、そう書く", () => {
    // 10 月分・翌々月末日払い → 12/31（休み）→ 12/30 として数える
    const [i] = sixtyDays(ctx({ tenant: { ...TENANT, payMonthOffset: 2, payDay: 0 } }));
    expect(i.severity).toBe("yellow");
    expect(i.detail).toContain("前の営業日の2026年12月30日として数えています");
  });
});

describe("取引条件の明示", () => {
  const d1 = driver("d1", "青木 翔太");
  const work: WorkRow[] = [["d1", "p1", 100]];

  it("記録が無い → 赤、記録がある → 出ない、立替の精算だけの月 → 出ない", () => {
    const none = driver("d1", "青木 翔太", { termsFirstIssuedOn: null, termsLatestIssuedOn: null });
    const red = termsMissing(ctx({ drivers: [none], drafts: drafts(OCT, [none], work) }));
    expect(red[0]).toMatchObject({ severity: "red", title: "取引条件を明示した記録がありません", subjectId: "d1" });
    expect(termsMissing(ctx({ drivers: [d1], drafts: drafts(OCT, [d1], work) }))).toHaveLength(0);
    const onlyRefund = drafts(OCT, [none], [], { adjustments: [{ driverId: "d1", label: "駐車場代の立替", amount: 3300, taxable: false, agreedInWriting: true }] });
    expect(termsMissing(ctx({ drivers: [none], drafts: onlyRefund }))).toHaveLength(0);
  });

  it("委託を始めた日より後の明示 → 赤、日付の無い月の途中 → 黄", () => {
    const late = driver("d1", "青木 翔太", { termsFirstIssuedOn: "2026-05-10", startedOn: "2026-05-01", firstWork: { month: "2026-05-01", minDate: null, hasUndated: true } });
    const [red] = termsMissing(ctx({ drivers: [late], drafts: drafts(OCT, [late], work) }));
    expect(red.severity).toBe("red");
    expect(red.detail).toContain("委託を始めた日（2026年5月1日）");
    const unsure = driver("d1", "青木 翔太", { termsFirstIssuedOn: "2026-05-10", firstWork: { month: "2026-05-01", minDate: null, hasUndated: true } });
    expect(termsMissing(ctx({ drivers: [unsure], drafts: drafts(OCT, [unsure], work) }))[0].severity).toBe("yellow");
  });

  it("明示のあとに変えた単価で、合意の日が無い → 黄。合意の日がある・その単価で払っていない → 出ない", () => {
    const d = drafts(OCT, [d1], work, { overrides: [{ driverId: "d1", projectId: "p1", payRate: 155 }] });
    const o = { id: "o1", driverId: "d1", projectId: "p1", payRate: 155, agreedOn: null, updatedOn: "2026-09-20" };
    const [i] = rateChangedWithoutRecord(ctx({ drivers: [d1], drafts: d, overrides: [o] }));
    expect(i).toMatchObject({ severity: "yellow", title: "単価を変えた記録に、合意の日付がありません", subjectId: "o1" });
    expect(i.detail).toContain("155円");
    expect(i.detail).toContain("15,500円");
    expect(rateChangedWithoutRecord(ctx({ drivers: [d1], drafts: d, overrides: [{ ...o, agreedOn: "2026-09-20" }] }))).toHaveLength(0);
    expect(rateChangedWithoutRecord(ctx({ drivers: [d1], drafts: d, overrides: [{ ...o, updatedOn: "2026-03-01" }] }))).toHaveLength(0);
    expect(rateChangedWithoutRecord(ctx({ drivers: [d1], drafts: drafts(OCT, [d1], work), overrides: [o] }))).toHaveLength(0);
  });
});

describe("支払期日の文言・支払の遅れ", () => {
  it("「以内」「検収後」→ 黄。空 → お知らせ。日を特定した書き方 → 出ない", () => {
    const [i] = paymentWording(ctx({ tenant: { ...TENANT, settings: { paymentTermsText: "検収後30日以内に支払う" } } }));
    expect(i.severity).toBe("yellow");
    expect(i.title).toBe("支払期日の書き方に「以内」「検収後」があります");
    expect(paymentWording(ctx())[0].detail).toContain("取引条件に書いている支払期日の文言を入れると確認できます");
    expect(paymentWording(ctx({ tenant: { ...TENANT, settings: { paymentTermsText: "毎月20日締め・翌月10日払い" } } }))).toHaveLength(0);
  });

  it("期日どおりに振り込んだ → 出ない。記録が無くても期日前 → 出ない", () => {
    const d1 = driver("d1", "青木 翔太");
    const st = { id: "s1", driverId: "d1", total: 100000, payDate: "2026-11-25" };
    const b = { id: "b1", fileName: "振込.txt", transferDate: "2026-11-25", executedOn: "2026-11-25", statementIds: ["s1"] };
    expect(paidLate(ctx({ drivers: [d1], statements: [st], batches: [b], today: "2026-12-01" }))).toHaveLength(0);
    expect(paidLate(ctx({ drivers: [d1], statements: [st], batches: [{ ...b, executedOn: null }], today: "2026-11-24" }))).toHaveLength(0);
    // 振込データはあるが振り込んだ日が無いまま期日を過ぎた → 黄
    const [y] = paidLate(ctx({ drivers: [d1], statements: [st], batches: [{ ...b, executedOn: null }], today: "2026-11-26" }));
    expect(y).toMatchObject({ severity: "yellow", subjectId: "unpaid" });
    // 振込額 0 以下の人は数えない
    expect(paidLate(ctx({ drivers: [d1], statements: [{ ...st, total: 0 }], today: "2026-12-01" }))).toHaveLength(0);
  });

  it("支払期日が土曜で、月曜に振り込んだ → 赤（2日後）。休みの日だったことも書く（扱いは取引条件しだいなので判定はしない）", () => {
    const d1 = driver("d1", "青木 翔太");
    const st = { id: "s1", driverId: "d1", total: 357555, payDate: "2026-11-28" };
    const b = { id: "b1", fileName: "振込.txt", transferDate: "2026-11-30", executedOn: "2026-11-30", statementIds: ["s1"] };
    const [r] = paidLate(ctx({ drivers: [d1], statements: [st], batches: [b], today: "2026-12-01" }));
    expect(r).toMatchObject({ severity: "red", subjectId: "b1", fixHref: "/transfer?m=2026-10" });
    expect(r.detail).toContain("2026年11月30日で、明細の支払期日（2026年11月28日）より 2日後です");
    expect(r.detail).toContain("青木 翔太（1人・合計 357,555円）");
    expect(r.detail).toContain("明細の支払期日（2026年11月28日）は銀行の休みの日です");
    // 平日の支払期日なら、休みの日のことは書かない
    const [w] = paidLate(ctx({ drivers: [d1], statements: [{ ...st, payDate: "2026-11-25" }], batches: [b], today: "2026-12-01" }));
    expect(w.detail).not.toContain("銀行の休みの日");
  });
});

describe("差し引き", () => {
  const d1 = driver("d1", "青木 翔太");
  const work: WorkRow[] = [["d1", "p1", 1000]];

  it("振込手数料：会社持ち・名前が違う → 出ない。止めたルールで明細にも無い → 出ない", () => {
    expect(feeDeducted(ctx({ tenant: { ...TENANT, settings: { transferFeeBearer: "company" } } }))).toHaveLength(0);
    const r = { id: "r1", name: "振込手数料", driverId: null, kind: "fixed", agreedInWriting: true, agreedOn: "2026-01-01", basis: "契約", active: false };
    expect(feeDeducted(ctx({ rules: [r] }))).toHaveLength(0);
    expect(feeDeducted(ctx({ rules: [{ ...r, active: true }] }))[0]).toMatchObject({ severity: "red", subjectId: "r1" });
    // 立替の精算（プラス）は出ない
    expect(feeDeducted(ctx({ drivers: [d1], adjustments: [{ id: "a1", driverId: "d1", label: "振込料の立替", amount: 440, agreedInWriting: true, basis: null }] }))).toHaveLength(0);
  });

  it("合意あり・合意の日が月の初日より前 → 出ない。明細に出ていないルール → 出ない", () => {
    const calc = rule({ id: "r1", name: "管理費", amount: 15000 });
    const d = drafts(OCT, [d1], work, { rules: [calc] });
    const r = { id: "r1", name: "管理費", driverId: null, kind: "fixed", agreedInWriting: true, agreedOn: "2026-04-01", basis: "契約 第8条", active: true };
    expect(deductionNoAgreement(ctx({ drivers: [d1], drafts: d, rules: [r] }))).toHaveLength(0);
    expect(deductionNoAgreement(ctx({ drivers: [d1], drafts: drafts(OCT, [d1], work), rules: [{ ...r, agreedInWriting: false }] }))).toHaveLength(0);
    // 月の初日と同じ日の合意は出ない、翌日なら黄
    expect(deductionNoAgreement(ctx({ drivers: [d1], drafts: d, rules: [{ ...r, agreedOn: OCT }] }))).toHaveLength(0);
    expect(deductionNoAgreement(ctx({ drivers: [d1], drafts: d, rules: [{ ...r, agreedOn: "2026-10-02" }] }))[0].severity).toBe("yellow");
  });

  it("調整：合意と根拠がそろった差し引き → 出ない。事故の見舞金（プラス）で根拠が無い → 黄（減額の話はしない）", () => {
    const ok = { id: "a1", driverId: "d1", label: "車両修理の負担分", amount: -11000, agreedInWriting: true, basis: "修理の見積書と合意書" };
    expect(deductionNoAgreement(ctx({ drivers: [d1], adjustments: [ok] }))).toHaveLength(0);
    const [plus] = deductionNoAgreement(ctx({ drivers: [d1], adjustments: [{ ...ok, label: "事故の見舞金", amount: 5000, basis: null, agreedInWriting: false }] }));
    expect(plus.severity).toBe("yellow");
    expect(plus.detail).not.toContain("減額");
    // 払う側の調整なので「負担」とは書かない。直す画面はその調整を開く
    expect(plus.title).toBe("事故・破損などに関わる支払の根拠が入っていません");
    expect(plus.fixHref).toBe("/work?m=2026-10&adj=a1#adjustments");
    // 0 円の調整は明細に出ないので、指摘もしない
    expect(deductionNoAgreement(ctx({ drivers: [d1], adjustments: [{ ...ok, label: "事故の弁償", amount: 0, basis: null, agreedInWriting: false }] }))).toHaveLength(0);
  });

  it("単価：前月より上がった・同じ → 出ない。前月に無い案件 → 出ない", () => {
    const prev = drafts(SEP, [d1], work);
    expect(rateDown(ctx({ drafts: drafts(OCT, [d1], work, { overrides: [{ driverId: "d1", projectId: "p1", payRate: 160 }] }), prevDrafts: prev }))).toHaveLength(0);
    expect(rateDown(ctx({ drafts: drafts(OCT, [d1], work), prevDrafts: prev }))).toHaveLength(0);
    expect(rateDown(ctx({ drafts: drafts(OCT, [d1], [["d1", "p2", 20]]), prevDrafts: prev }))).toHaveLength(0);
    const [down] = rateDown(ctx({ drafts: drafts(OCT, [d1], work, { overrides: [{ driverId: "d1", projectId: "p1", payRate: 145 }] }), prevDrafts: prev }));
    expect(down.detail).toContain("約 5,000円");
    // 人ごとの単価ではなく案件の標準の単価が下がった → 案件の設定を名前で絞って開く
    expect(down.fixHref).toBe(FIX.projects("宅配"));
    expect(down.fixHref).toBe("/settings/projects?q=%E5%AE%85%E9%85%8D");
  });
});

describe("取適法の目安", () => {
  const withSettings = (settings: WatchContext["tenant"]["settings"]) => toriteki(ctx({ tenant: { ...TENANT, settings } }));
  it("運送の委託の目安：資本金 1,000 万円・従業員 300 人ちょうど → 出ない。301 人 → 可能性。どちらか空 → 入れる案内", () => {
    expect(TORITEKI_EMPLOYEES).toBe(300);
    expect(withSettings({ capitalYen: 10_000_000, employees: 300 })).toHaveLength(0);
    expect(withSettings({ capitalYen: 10_000_000, employees: 101 })).toHaveLength(0);
    expect(withSettings({ capitalYen: 10_000_000, employees: 301 })[0].title).toBe("取適法の対象になる可能性があります");
    const [cap] = withSettings({ capitalYen: 10_000_001, employees: 3 });
    expect(cap.detail).toContain("資本金 10,000,001円");
    // 目安であること・区分ごとに基準が違うこと・専門家への確認を必ず書く
    expect(cap.detail).toContain("目安です。区分ごとに基準が違います。弁護士などにご確認ください");
    expect(cap.impact).toEqual({ yen: null, label: "金額で出す指摘ではありません" });
    expect(withSettings({ capitalYen: 5_000_000 })[0].title).toBe("取適法の対象かどうかの目安を出せます");
  });
});

describe("インボイス", () => {
  it("登録ありで番号が無い → 黄（影響額はその人の税額）。確かめた日が 180 日以内 → 出ない、181 日前 → お知らせ", () => {
    expect(REGISTRATION_CHECK_DAYS).toBe(180);
    const noNumber = driver("d1", "青木 翔太", { registrationNo: null });
    const d = drafts(OCT, [noNumber], [["d1", "p1", 10]]);
    const [missing] = invoiceNumber(ctx({ drivers: [noNumber], drafts: d }));
    expect(missing.title).toBe("登録番号が入っていません");
    // 10 個 × 150 円 = 1,500 円の 10% = 150 円
    expect(missing.impact).toEqual({ yen: 150, label: "青木 翔太さんの2026年10月分の消費税額" });
    // 今日 2026-10-31 の 180 日前は 2026-05-04
    const fresh = driver("d1", "青木 翔太", { registrationCheckedOn: "2026-05-04" });
    expect(invoiceNumber(ctx({ drivers: [fresh], drafts: d }))).toHaveLength(0);
    const old = driver("d1", "青木 翔太", { registrationCheckedOn: "2026-05-03" });
    const [info] = invoiceNumber(ctx({ drivers: [old], drafts: d }));
    expect(info).toMatchObject({ severity: "info", sourceUrl: SOURCES.invoiceRegistry });
    expect(info.detail).toContain("180日より前です");
  });

  it("経過措置の負担：原則課税でない会社・登録のある人だけ → 出ない。2031年10月からは次の段階を書かない", () => {
    const exempt = driver("d1", "上田 健", { invoiceRegistered: false, registrationNo: null });
    const simplified = drafts(OCT, [exempt], [["d1", "p1", 1000]], {
      tenant: { ...CALC_TENANT, registrationNo: null, taxMethod: "simplified" },
    });
    expect(invoiceBurden(ctx({ drafts: simplified }))).toHaveLength(0);
    expect(invoiceBurden(ctx({ drafts: drafts(OCT, [driver("d1", "青木 翔太")], [["d1", "p1", 1000]]) }))).toHaveLength(0);
    const [i] = invoiceBurden(ctx({ drafts: drafts(OCT, [exempt], [["d1", "p1", 1000]]) }));
    // 150,000 ＋ 15,000 の 10/110 × 30% = 4,500
    expect(i.detail).toContain("4,500円");
    expect(i.detail).toContain("70%");
    const late = "2031-11-01";
    const [last] = invoiceBurden(ctx({ month: late, drafts: drafts(late, [exempt], [["d1", "p1", 1000]]) }));
    expect(last.detail).toContain("0%");
    expect(last.detail).not.toContain("次の段階");
  });
});

describe("終了の予告", () => {
  const base = { startedOn: "2026-01-01", endOn: "2026-10-31" };
  it("30 日前ちょうど → 出ない、29 日前 → 黄、終わった月のあと → 出ない、始めた日が分からない → 出ない", () => {
    expect(contractEnd(ctx({ drivers: [driver("d1", "青木 翔太", { ...base, endNoticedOn: "2026-10-01" })] }))).toHaveLength(0);
    expect(contractEnd(ctx({ drivers: [driver("d1", "青木 翔太", { ...base, endNoticedOn: "2026-10-02" })] }))[0].detail).toContain("29日前");
    expect(contractEnd(ctx({ month: "2026-11-01", drivers: [driver("d1", "青木 翔太", base)] }))).toHaveLength(0);
    expect(contractEnd(ctx({ drivers: [driver("d1", "青木 翔太", { endOn: "2026-10-31", startedOn: null, termsFirstIssuedOn: null, firstWork: null })] }))).toHaveLength(0);
    // 6 か月ちょうど（1/1〜6/30）は対象
    expect(contractEnd(ctx({ month: "2026-06-01", drivers: [driver("d1", "青木 翔太", { startedOn: "2026-01-01", endOn: "2026-06-30" })] }))).toHaveLength(1);
    expect(contractEnd(ctx({ month: "2026-06-01", drivers: [driver("d1", "青木 翔太", { startedOn: "2026-01-01", endOn: "2026-06-29" })] }))).toHaveLength(0);
  });
});

describe("数字のおかしなところ", () => {
  const d1 = driver("d1", "青木 翔太");

  it("口座：そろっている → 出ない、支店コードが 2 桁 → 直すところを書く", () => {
    const d = drafts(OCT, [d1], [["d1", "p1", 10]]);
    expect(noBank(ctx({ drivers: [d1], drafts: d }))).toHaveLength(0);
    const bad = driver("d1", "青木 翔太", { bank: { ...d1.bank, branchCode: "01" } });
    const [i] = noBank(ctx({ drivers: [bad], drafts: d }));
    expect(i.title).toBe("振込先の口座に直すところがあります");
    expect(i.detail).toContain("支店コードは 3 桁の数字です");
  });

  it("振込額がプラス → 赤を出さない。数量 ±49% → 出ない、+60% → 黄", () => {
    const prev = drafts(SEP, [d1], [["d1", "p1", 100]]);
    expect(negativeTotal(ctx({ drafts: prev }))).toHaveLength(0);
    expect(qtyJump(ctx({ drafts: drafts(OCT, [d1], [["d1", "p1", 149]]), prevDrafts: prev }))).toHaveLength(0);
    expect(qtyJump(ctx({ drafts: drafts(OCT, [d1], [["d1", "p1", 51]]), prevDrafts: prev }))).toHaveLength(0);
    const [up] = qtyJump(ctx({ drafts: drafts(OCT, [d1], [["d1", "p1", 160]]), prevDrafts: prev }));
    expect(up).toMatchObject({ severity: "yellow", title: "前月より数量が大きく増えています" });
    expect(up.detail).toContain("＋60%");
  });

  it("明細：締めた月・最新 → 出ない。稼働が無い月（作る人 0）→ 出ない", () => {
    const stale = { saved: 3, missing: 0, stale: 1, orphan: 0, upToDate: false };
    expect(statementsStale(ctx({ statementsStatus: stale }))[0].title).toBe("明細を作り直してください");
    expect(statementsStale(ctx({ closed: true, statementsStatus: stale }))).toHaveLength(0);
    expect(statementsStale(ctx({ statementsStatus: { ...stale, stale: 0, upToDate: true } }))).toHaveLength(0);
    expect(statementsStale(ctx({ statementsStatus: { saved: 0, missing: 0, stale: 0, orphan: 0, upToDate: false } }))).toHaveLength(0);
  });

  it("振込額がマイナス：内訳（委託料 ＋ 消費税 − 控除 ± 調整 − 源泉徴収）は明細の値のまま、足すと振込額になる", () => {
    const writer = driver("d1", "青木 翔太");
    const d = drafts(OCT, [writer], [["d1", "p1", 10]], {
      drivers: [{ id: "d1", name: "青木 翔太", code: "D1", invoiceRegistered: true, registrationNo: "T1234567890123", isCorporation: false, withholdingCategory: "ko1", active: true }],
      rules: [rule({ id: "r1", name: "管理費", amount: 1000 })],
      adjustments: [{ driverId: "d1", label: "事故の弁償", amount: -5000, taxable: false, agreedInWriting: true }],
    });
    const x = d[0];
    // 1,500 ＋ 150 −（1,000 ＋ 100）− 5,000 − 源泉
    expect(x.subtotal).toBe(1500);
    expect(x.withholding?.amount).toBeGreaterThan(0);
    const w = x.withholding!.amount;
    expect(x.total).toBe(1500 + 150 - 1100 - 5000 - w);
    const [i] = negativeTotal(ctx({ drafts: d }));
    expect(i.severity).toBe("red");
    expect(i.detail).toContain(`2026年10月分の振込額が マイナス ${(-x.total).toLocaleString("ja-JP")}円です`);
    expect(i.detail).toContain(`委託料 1,500円 ＋ 消費税 150円 − 控除 1,100円（消費税を含む） − 調整 5,000円 − 源泉徴収 ${w.toLocaleString("ja-JP")}円`);
    expect(totalBreakdown({ ...x, tax: 0, deductionTotal: 0, deductionTax: 0, adjustmentTotal: 0, adjustmentTax: 0, withholding: null })).toBe("委託料 1,500円");
  });

  it("終了の予告の記録が無い → 30 日前の日を書く（まだ先なら「です」、過ぎていれば「すでに過ぎています」）", () => {
    const d = driver("d1", "青木 翔太", { startedOn: "2026-01-01", endOn: "2026-12-31" });
    const [before] = contractEnd(ctx({ drivers: [d], today: "2026-10-31" }));
    expect(before.detail).toContain("終了日の30日前は2026年12月1日です");
    const [after] = contractEnd(ctx({ drivers: [d], today: "2026-12-02" }));
    expect(after.detail).toContain("終了日の30日前は2026年12月1日で、すでに過ぎています");
    expect(after.fixHref).toBe("/settings/drivers/d1");
  });

  it("稼働の入れ忘れ：止めた人・前の月に終えた人 → 出ない。まだ誰の稼働も無い月 → 人ごとには出さない", () => {
    const prev = drafts(SEP, [d1], [["d1", "p1", 100]]);
    const d2 = driver("d2", "上田 健");
    expect(workMissing(ctx({ drivers: [d1, d2], prevDrafts: prev }))).toHaveLength(0);
    expect(workMissing(ctx({ drivers: [d1, d2], prevDrafts: prev, drafts: drafts(OCT, [d2], [["d2", "p1", 5]]) }))).toHaveLength(1);
    const cur = drafts(OCT, [d2], [["d2", "p1", 5]]);
    expect(workMissing(ctx({ drivers: [{ ...d1, active: false }, d2], prevDrafts: prev, drafts: cur }))).toHaveLength(0);
    expect(workMissing(ctx({ drivers: [{ ...d1, endOn: "2026-09-30" }, d2], prevDrafts: prev, drafts: cur }))).toHaveLength(0);
  });
});

describe("まとめ・並べ方・文面", () => {
  it("名前は 3 人まで、あとは「ほか n人」", () => {
    expect(nameList(["A", "B"])).toBe("A・B");
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A・B・C ほか 2人");
    expect(nameList(["A", "A", "B"])).toBe("A・B");
  });

  it("重い順 → ルールの順。同じ種類・同じ対象は 1 つにまとめる", () => {
    const i = (severity: WatchIssue["severity"], code: string, subjectLabel = "x") => ({ severity, code, subjectLabel });
    const sorted = sortIssues([i("info", "toriteki"), i("yellow", "no_bank"), i("red", "fee_deducted"), i("red", "terms_missing")]);
    expect(sorted.map((x) => x.code)).toEqual(["terms_missing", "fee_deducted", "no_bank", "toriteki"]);
  });

  it("すべてのルールが出る記録でも、言ってはいけないことを書かず、出典は確かめ済みの URL だけ", () => {
    const exempt = driver("d2", "上田 健", {
      invoiceRegistered: false,
      registrationNo: null,
      termsFirstIssuedOn: null,
      termsLatestIssuedOn: null,
      bank: { bankCode: "", bankNameKana: "", branchCode: "", branchNameKana: "", accountType: "ordinary", accountNumber: "", holderKana: "" },
    });
    const reg = driver("d1", "青木 翔太", { registrationNo: "T12", termsLatestIssuedOn: "2026-04-01", startedOn: "2026-01-01", endOn: "2026-10-31" });
    reg.bank = { ...reg.bank, branchCode: "12" };
    const gone = driver("d3", "佐藤 亮");
    const drivers = [reg, exempt, gone];
    const rules: CalcRule[] = [rule({ id: "r1", name: "制服代", agreedInWriting: false, amount: 5000 }), rule({ id: "r2", name: "振込手数料", amount: 440 })];
    // 明細の支払日も 3 か月後（見張り番は明細に書いた支払日で数える）
    const cur = drafts(OCT, drivers, [["d1", "p1", 1000], ["d2", "p1", 10]], {
      tenant: { ...CALC_TENANT, payMonthOffset: 3 },
      rules,
      overrides: [{ driverId: "d1", projectId: "p1", payRate: 140 }],
      adjustments: [{ driverId: "d2", label: "事故の弁償", amount: -90000, taxable: false, agreedInWriting: false }],
    });
    const prev = drafts(SEP, drivers, [["d1", "p1", 3000], ["d3", "p1", 100]], { rules });
    const c = ctx({
      today: "2026-12-01",
      tenant: { ...TENANT, payMonthOffset: 3, settings: { transferFeeBearer: "driver", paymentTermsText: "請求書受領後30日以内", capitalYen: 50_000_000, employees: 20 } },
      drafts: cur,
      prevDrafts: prev,
      drivers,
      rules: [
        { id: "r1", name: "制服代", driverId: null, kind: "fixed", agreedInWriting: false, agreedOn: null, basis: null, active: true },
        { id: "r2", name: "振込手数料", driverId: null, kind: "fixed", agreedInWriting: true, agreedOn: "2026-01-01", basis: "契約", active: true },
      ],
      overrides: [{ id: "o1", driverId: "d1", projectId: "p1", payRate: 140, agreedOn: null, updatedOn: "2026-09-01" }],
      adjustments: [{ id: "a1", driverId: "d2", label: "事故の弁償", amount: -90000, agreedInWriting: false, basis: null }],
      statements: [{ id: "s1", driverId: "d1", total: 100000, payDate: "2027-01-25" }],
      batches: [{ id: "b1", fileName: "振込.txt", transferDate: "2027-01-25", executedOn: "2027-01-29", statementIds: ["s1"] }],
      statementsStatus: { saved: 1, missing: 1, stale: 0, orphan: 0, upToDate: false },
    });
    const issues = evaluateRules(c);
    const codes = new Set(issues.map((i) => i.code));
    // 最初からあるルールは、この 1 つの記録で全部出る（あとから足したルールは watch-rules-extra.test.ts で確かめる）
    for (const code of FIRST_WAVE_CODES) expect(codes, code).toContain(code);
    expect(RULES.map((r) => r.doc.code)).toEqual(expect.arrayContaining(FIRST_WAVE_CODES));
    // どの指摘にも影響額（出せなければ null）と時点が付く
    for (const i of issues) {
      expect(i.impact, i.code).toBeDefined();
      expect(i.asOf, i.code).toBe("2026年9月");
    }
    const allowed = new Set<string>(Object.values(SOURCES));
    for (const i of issues) {
      expect(`${i.title}${i.detail}${i.basis ?? ""}`, i.code).not.toMatch(FORBIDDEN);
      if (i.sourceUrl) expect(allowed.has(i.sourceUrl), i.sourceUrl).toBe(true);
      expect(i.title).not.toMatch(/違反|適法です/);
    }
    // 振込手数料の控除は fee_deducted だけで出す
    expect(issues.filter((i) => i.subjectId === "r2").map((i) => i.code)).toEqual(["fee_deducted"]);

    const withAck = issues.map((i, n) => ({ ...i, acked: n === 0, ackNote: null, blocksClose: i.severity === "red" && n !== 0 }));
    const counts = countIssues(withAck);
    expect(counts.redAcked).toBe(1);
    expect(counts.redOpen + counts.redAcked + counts.yellowOpen + counts.yellowAcked + counts.info).toBe(issues.length);
    const groups = groupBySeverity(withAck);
    expect(groups.red.at(-1)!.acked).toBe(true);
  });

  it("直す画面のリンク：直せない人には「見る」（閲覧の人・会社の設定を変えられない事務・締めた月の稼働と明細）", () => {
    const open = { closed: false };
    expect(fixLink(FIX.driver("d1"), { role: "staff", ...open })).toMatchObject({ href: "/settings/drivers/d1", text: "直す（ドライバーの設定）", canFix: true, note: null });
    expect(fixLink(FIX.driver("d1"), { role: "viewer", ...open })).toMatchObject({ text: "見る（ドライバーの設定）", canFix: false, note: "直すのは事務・オーナーの方です。" });
    expect(fixLink(FIX.company("2026-10"), { role: "staff", ...open })).toMatchObject({ text: "見る（会社の設定）", canFix: false });
    expect(fixLink(FIX.company("2026-10"), { role: "owner", ...open })).toMatchObject({ text: "直す（会社の設定）", canFix: true });
    expect(fixLink(FIX.rates("d1", "p1"), { role: "staff", ...open }).text).toBe("直す（人ごとの単価）");
    expect(fixLink(FIX.rules("2026-10", "d1"), { role: "staff", ...open }).text).toBe("直す（控除のルール）");
    expect(fixLink(FIX.adjustment("2026-10", "a1"), { role: "owner", closed: true })).toMatchObject({ text: "見る（稼働と調整）", canFix: false });
    // 振込の記録は締めたあとに入れるので、締めた月でも「直す」
    expect(fixLink(FIX.transfer("2026-10"), { role: "staff", closed: true })).toMatchObject({ text: "直す（振込データ）", canFix: true });
    // 画面の場所の形（id は URL に安全な形で入れる）
    expect(FIX.rules("2026-10")).toBe("/settings/rules?m=2026-10");
    expect(FIX.adjustment("2026-10", "a b")).toBe("/work?m=2026-10&adj=a%20b#adjustments");
  });

  it("締めた月に確認済みにできるのは、締めたあとの振込の記録から出る指摘だけ", () => {
    expect(ackAllowed("terms_missing", false)).toBe(true);
    expect(ackAllowed("terms_missing", true)).toBe(false);
    expect(ackAllowed("deduction_no_agreement", true)).toBe(false);
    expect(ackAllowed("paid_late", true)).toBe(true);
  });
});
