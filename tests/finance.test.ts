import { describe, expect, it } from "vitest";
import {
  daysBetweenDates,
  fiscalMonthLabel,
  fiscalYearEnd,
  formatMonthDayJa,
  isFinanceYear,
  monthOfDate,
  parseYearParam,
  resolveFinanceYear,
  todayJST,
  yearEndDate,
  yearMonths,
  yearOfDate,
  yearOptions,
  yearStartDate,
} from "@/lib/finance/date";
import {
  achievementLevel,
  actualSeries,
  averageDrivers,
  budgetTotalCompare,
  budgetTotals,
  BUDGET_METRICS,
  compareBudget,
  compareRow,
  diffLabel,
  growValues,
  hasAnyTarget,
  isLowerBetter,
  isMoneyMetric,
  sameValues,
  splitEvenly,
  targetSeries,
  toBudgetRows,
  totalLabel,
  type MonthKpiLike,
} from "@/lib/finance/budget";
import {
  equalPayment,
  hasPaidPayment,
  isOverduePayment,
  loanProgress,
  loanSummary,
  monthlyPaymentOf,
  nextPayment,
  paymentDayLabel,
  paymentsInMonth,
  paymentsInYear,
  sortLoans,
  sortPayments,
  totalOfPayments,
  type LoanLike,
  type LoanPaymentLike,
} from "@/lib/finance/loans";
import {
  daysLeftLabel,
  groupTaxTasks,
  resolveTaxUrgency,
  sortTaxTasks,
  tasksOfYear,
  taxCounts,
  taxDaysLeft,
  taxYears,
  toTaxTaskView,
  type TaxTaskLike,
} from "@/lib/finance/tax";
import {
  ensureTaxTasksSchema,
  financeTabFromParam,
  loanInputSchema,
  saveYearTargetsSchema,
  setLoanPaymentPaidSchema,
  taxTaskInputSchema,
} from "@/lib/schemas/finance";

const TODAY = "2026-09-19";

// ---------------------------------------------------------------------------
// 日付と年
// ---------------------------------------------------------------------------

describe("財務の日付・年ユーティリティ", () => {
  it("日本時間の今日を YYYY-MM-DD で返す（UTC の前日夜でも翌日になる）", () => {
    expect(todayJST(new Date("2026-09-18T16:00:00Z"))).toBe("2026-09-19");
    expect(todayJST(new Date("2026-09-19T14:59:00Z"))).toBe("2026-09-19");
  });

  it("?y= を西暦 4 桁として読み、不正なら null を返す", () => {
    expect(parseYearParam("2026")).toBe(2026);
    expect(parseYearParam(["2027"])).toBe(2027);
    expect(parseYearParam("26")).toBeNull();
    expect(parseYearParam("1999")).toBeNull();
    expect(parseYearParam(undefined)).toBeNull();
  });

  it("?y= が無いときは今日の年を使う", () => {
    expect(resolveFinanceYear(undefined, TODAY)).toBe(2026);
    expect(resolveFinanceYear("2028", TODAY)).toBe(2028);
  });

  it("その年の 12 か月を 1 月から並べる", () => {
    const months = yearMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01");
    expect(months[11]).toBe("2026-12");
    expect(yearStartDate(2026)).toBe("2026-01-01");
    expect(yearEndDate(2026)).toBe("2026-12-31");
  });

  it("年セレクタの選択肢は今年の前後とデータのある年を降順で返す", () => {
    const years = yearOptions(2026, [2019, 2031]);
    expect(years[0]).toBeGreaterThan(years[years.length - 1]);
    expect(years).toContain(2026);
    expect(years).toContain(2023);
    expect(years).toContain(2028);
    expect(years).toContain(2019);
    expect(new Set(years).size).toBe(years.length);
  });

  it("2 つの日付の差を日数で返す（過ぎていればマイナス）", () => {
    expect(daysBetweenDates(TODAY, "2026-09-19")).toBe(0);
    expect(daysBetweenDates(TODAY, "2026-10-19")).toBe(30);
    expect(daysBetweenDates(TODAY, "2026-09-18")).toBe(-1);
    expect(daysBetweenDates("こわれた日付", "2026-09-18")).toBe(0);
  });

  it("決算月から決算日（末日）を組み立てる", () => {
    expect(fiscalYearEnd(2026, 3)).toBe("2026-03-31");
    expect(fiscalYearEnd(2026, 2)).toBe("2026-02-28");
    expect(fiscalYearEnd(2028, 2)).toBe("2028-02-29");
    expect(fiscalYearEnd(2026, null)).toBe("2026-03-31");
    expect(fiscalMonthLabel(9)).toBe("9月決算");
    expect(fiscalMonthLabel(0)).toBe("決算月が未設定");
  });

  it("日付から年・月を取り出し、月日を日本語で表示する", () => {
    expect(yearOfDate("2027-01-31")).toBe(2027);
    expect(monthOfDate("2027-01-31")).toBe("2027-01");
    expect(formatMonthDayJa("2027-01-31")).toBe("1月31日");
    expect(formatMonthDayJa(null)).toBe("—");
    expect(isFinanceYear(2026)).toBe(true);
    expect(isFinanceYear(1900)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 予算と予実対比
// ---------------------------------------------------------------------------

const KPIS: MonthKpiLike[] = [
  {
    month: "2026-01-01",
    status: "closed",
    bill: 1_000_000,
    operating_profit: 200_000,
    expense_total: 300_000,
    active_driver_count: 5,
    bill_target: 900_000,
    profit_target: 250_000,
    expense_target: 320_000,
    driver_target: 6,
  },
  {
    month: "2026-02-01",
    status: "open",
    bill: 700_000,
    operating_profit: 50_000,
    expense_total: 400_000,
    active_driver_count: 4,
    bill_target: 1_000_000,
    profit_target: 100_000,
    expense_target: 300_000,
    driver_target: 6,
  },
];

describe("予実対比の集計", () => {
  it("その年の 12 か月ぶんの行を作り、データの無い月は 0 で埋める", () => {
    const rows = toBudgetRows(2026, KPIS);
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe("2026-01");
    expect(rows[0].closed).toBe(true);
    expect(rows[0].hasData).toBe(true);
    expect(rows[0].target.bill).toBe(900_000);
    expect(rows[0].actual.bill).toBe(1_000_000);
    expect(rows[2].hasData).toBe(false);
    expect(rows[2].actual.bill).toBe(0);
    expect(rows[2].target.driver).toBe(0);
  });

  it("目標 / 実績 / 差 / 達成率を出す", () => {
    const c = compareBudget("bill", 900_000, 1_000_000);
    expect(c.diff).toBe(100_000);
    expect(c.achievement).toBeCloseTo(1.111111, 5);
    expect(c.level).toBe("good");
    expect(diffLabel(c)).toBe("目標超え");
  });

  it("目標が未設定（0）の月は達成率を出さない", () => {
    const c = compareBudget("profit", 0, 120_000);
    expect(c.achievement).toBeNull();
    expect(c.level).toBe("none");
  });

  it("達成率の色分けは 100% 以上が緑、80% 未満が赤", () => {
    expect(achievementLevel(1, "bill")).toBe("good");
    expect(achievementLevel(1.5, "bill")).toBe("good");
    expect(achievementLevel(0.8, "bill")).toBe("warn");
    expect(achievementLevel(0.79, "bill")).toBe("bad");
    expect(achievementLevel(null, "bill")).toBe("none");
  });

  it("経費は少ないほど良いので色分けを逆にする", () => {
    expect(isLowerBetter("expense")).toBe(true);
    expect(isLowerBetter("bill")).toBe(false);
    expect(achievementLevel(1, "expense")).toBe("good");
    expect(achievementLevel(0.5, "expense")).toBe("good");
    expect(achievementLevel(1.1, "expense")).toBe("warn");
    expect(achievementLevel(1.21, "expense")).toBe("bad");
    expect(diffLabel(compareBudget("expense", 300_000, 400_000))).toBe("予算オーバー");
  });

  it("年間の合計を出す（ドライバー数だけ月平均）", () => {
    const rows = toBudgetRows(2026, KPIS);
    const totals = budgetTotals(rows);
    expect(totals.target.bill).toBe(1_900_000);
    expect(totals.actual.bill).toBe(1_700_000);
    expect(totals.actual.expense).toBe(700_000);
    expect(totals.actualMonths).toBe(2);
    expect(totals.actual.driver).toBe(4.5);
    expect(averageDrivers(rows, "target")).toBe(6);
    expect(totalLabel("bill")).toBe("年間合計");
    expect(totalLabel("driver")).toBe("月平均");
  });

  it("年間合計の達成率も出せる", () => {
    const rows = toBudgetRows(2026, KPIS);
    const c = budgetTotalCompare(rows, "bill");
    expect(c.target).toBe(1_900_000);
    expect(c.actual).toBe(1_700_000);
    expect(c.achievement).toBeCloseTo(0.894737, 5);
    expect(c.level).toBe("warn");
  });

  it("行と指標から予実を取り出せる（指標は 4 つ）", () => {
    const rows = toBudgetRows(2026, KPIS);
    expect(BUDGET_METRICS).toEqual(["bill", "profit", "expense", "driver"]);
    expect(compareRow(rows[1], "driver").diff).toBe(-2);
    expect(isMoneyMetric("driver")).toBe(false);
    expect(isMoneyMetric("expense")).toBe(true);
    expect(actualSeries(rows, "bill")[0]).toBe(1_000_000);
    expect(targetSeries(rows, "bill")[1]).toBe(1_000_000);
  });

  it("目標が 1 つも入っていない年を見分ける", () => {
    expect(hasAnyTarget(toBudgetRows(2026, KPIS))).toBe(true);
    expect(hasAnyTarget(toBudgetRows(2025, KPIS))).toBe(false);
  });
});

describe("かんたん入力の計算", () => {
  it("前年実績 ＋ ◯% を計算する（円未満は四捨五入）", () => {
    expect(growValues([1_000_000, 500_000], 10)).toEqual([1_100_000, 550_000]);
    expect(growValues([1_000_000], -10)).toEqual([900_000]);
    expect(growValues([333_333], 5)).toEqual([350_000]);
    expect(growValues([0], 20)).toEqual([0]);
  });

  it("全月に同じ額を入れる", () => {
    const values = sameValues(1_000_000);
    expect(values).toHaveLength(12);
    expect(values.every((v) => v === 1_000_000)).toBe(true);
  });

  it("年間合計から等分し、端数は最終月で調整して合計を合わせる", () => {
    const values = splitEvenly(1_000_000);
    expect(values).toHaveLength(12);
    expect(values[0]).toBe(83_333);
    expect(values[11]).toBe(83_337);
    expect(values.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  it("等分は 0 でも人数でも破綻しない", () => {
    expect(splitEvenly(0).reduce((a, b) => a + b, 0)).toBe(0);
    expect(splitEvenly(120, 12)).toEqual(Array.from({ length: 12 }, () => 10));
    expect(splitEvenly(100, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 借入と返済予定
// ---------------------------------------------------------------------------

const LOANS: LoanLike[] = [
  {
    id: "l1",
    name: "運転資金",
    status: "active",
    principal: 5_000_000,
    annual_rate: 0.018,
    start_on: "2026-01-10",
    months: 60,
    payment_day: 27,
    monthly_payment: 0,
    payment_count: 60,
    paid_count: 9,
    remaining_principal: 4_200_000,
    total_interest: 230_000,
  },
  {
    id: "l2",
    name: "車両ローン",
    status: "paid",
    principal: 1_200_000,
    annual_rate: 0,
    start_on: "2024-04-01",
    months: 12,
    payment_day: 0,
    monthly_payment: 100_000,
    payment_count: 12,
    paid_count: 12,
    remaining_principal: 0,
    total_interest: 0,
  },
  {
    id: "l3",
    name: "設備資金（予定）",
    status: "planned",
    principal: 3_000_000,
    annual_rate: 0.02,
    start_on: "2026-12-01",
    months: 36,
    payment_day: 0,
    monthly_payment: 0,
    payment_count: 0,
    paid_count: 0,
    remaining_principal: 0,
    total_interest: 0,
  },
];

const PAYMENTS: LoanPaymentLike[] = [
  { id: "p1", loan_id: "l1", seq: 8, due_on: "2026-08-27", principal: 80_000, interest: 6_000, total: 86_000, paid_on: "2026-08-27" },
  { id: "p2", loan_id: "l1", seq: 9, due_on: "2026-09-27", principal: 80_000, interest: 6_000, total: 86_000, paid_on: null },
  { id: "p3", loan_id: "l1", seq: 7, due_on: "2026-07-27", principal: 80_000, interest: 6_000, total: 86_000, paid_on: null },
  { id: "p4", loan_id: "l1", seq: 10, due_on: "2026-10-27", principal: 80_000, interest: 6_000, total: 86_000, paid_on: null },
];

describe("借入の計算", () => {
  it("元利均等の毎月の返済額を円未満四捨五入で出す", () => {
    expect(equalPayment(1_200_000, 0, 12)).toBe(100_000);
    const withInterest = equalPayment(1_200_000, 0.12, 12);
    expect(withInterest).toBeGreaterThan(100_000);
    expect(Number.isInteger(withInterest)).toBe(true);
  });

  it("借入額・回数が無ければ返済額は 0", () => {
    expect(equalPayment(0, 0.018, 60)).toBe(0);
    expect(equalPayment(1_000_000, 0.018, 0)).toBe(0);
  });

  it("毎月の返済額が指定されていればそれを使い、0 なら自動計算する", () => {
    expect(monthlyPaymentOf(LOANS[1])).toBe(100_000);
    expect(monthlyPaymentOf(LOANS[0])).toBe(equalPayment(5_000_000, 0.018, 60));
    expect(monthlyPaymentOf(LOANS[0])).toBeGreaterThan(0);
  });

  it("返済の進み具合を 0〜1 で返す", () => {
    expect(loanProgress(LOANS[0])).toBe(0.15);
    expect(loanProgress(LOANS[1])).toBe(1);
    expect(loanProgress(LOANS[2])).toBe(0);
  });

  it("借入は 返済中 → 予定 → 完済 の順に並べる", () => {
    const sorted = sortLoans(LOANS);
    expect(sorted.map((l) => l.id)).toEqual(["l1", "l3", "l2"]);
  });

  it("返済予定は期日順に並べ、次に返す回を取り出せる", () => {
    const sorted = sortPayments(PAYMENTS);
    expect(sorted.map((p) => p.seq)).toEqual([7, 8, 9, 10]);
    expect(nextPayment(PAYMENTS)?.seq).toBe(7);
  });

  it("期日を過ぎた未返済を見分ける（返済済みは対象外）", () => {
    expect(isOverduePayment(PAYMENTS[2], TODAY)).toBe(true);
    expect(isOverduePayment(PAYMENTS[0], TODAY)).toBe(false);
    expect(isOverduePayment(PAYMENTS[1], TODAY)).toBe(false);
    expect(hasPaidPayment(PAYMENTS)).toBe(true);
    expect(hasPaidPayment([PAYMENTS[1]])).toBe(false);
  });

  it("今月・今年の返済額を集計する", () => {
    expect(paymentsInMonth(PAYMENTS, "2026-09").map((p) => p.id)).toEqual(["p2"]);
    expect(paymentsInYear(PAYMENTS, 2026)).toHaveLength(4);
    expect(totalOfPayments(PAYMENTS)).toBe(344_000);
  });

  it("借入タブの要約（残高・今月・今年・利息・遅れ）を出す", () => {
    const s = loanSummary(LOANS, PAYMENTS, TODAY);
    expect(s.loanCount).toBe(2);
    expect(s.activeCount).toBe(1);
    expect(s.remainingTotal).toBe(4_200_000);
    expect(s.thisMonthTotal).toBe(86_000);
    expect(s.thisYearTotal).toBe(344_000);
    expect(s.interestTotal).toBe(230_000);
    expect(s.overdueCount).toBe(1);
    expect(s.overdueTotal).toBe(86_000);
  });

  it("返済日 0 は「月末」と表示する", () => {
    expect(paymentDayLabel(0)).toBe("月末");
    expect(paymentDayLabel(27)).toBe("27日");
    expect(paymentDayLabel(null)).toBe("月末");
  });
});

// ---------------------------------------------------------------------------
// 税務の期限
// ---------------------------------------------------------------------------

const TAX_ROWS: TaxTaskLike[] = [
  { id: "t1", kind: "corporate_tax_final", title: "法人税の確定申告と納付", due_on: "2026-05-31", status: "todo", amount: 300_000, is_generated: true },
  { id: "t2", kind: "withholding_jul", title: "源泉所得税の納付", due_on: "2026-09-30", status: "todo", amount: null, is_generated: true },
  { id: "t3", kind: "year_end_adjustment", title: "年末調整", due_on: "2026-12-20", status: "todo", is_generated: true },
  { id: "t4", kind: "custom_1", title: "税理士との打ち合わせ", due_on: "2026-06-10", status: "done", done_on: "2026-06-10", is_generated: false },
  { id: "t5", kind: "corporate_tax_interim", title: "法人税の中間申告", due_on: "2027-11-30", status: "skipped", is_generated: true },
];

describe("税務の期限", () => {
  it("残り日数を出す（期限切れはマイナス）", () => {
    expect(taxDaysLeft("2026-09-30", TODAY)).toBe(11);
    expect(taxDaysLeft("2026-05-31", TODAY)).toBeLessThan(0);
  });

  it("緊急度は 済 → 期限切れ → 30 日以内は「まもなく」 の順で決まる", () => {
    expect(resolveTaxUrgency("done", "2026-01-01", TODAY)).toBe("done");
    expect(resolveTaxUrgency("skipped", "2027-11-30", TODAY)).toBe("done");
    expect(resolveTaxUrgency("todo", "2026-09-18", TODAY)).toBe("overdue");
    expect(resolveTaxUrgency("todo", "2026-09-19", TODAY)).toBe("soon");
    expect(resolveTaxUrgency("todo", "2026-10-19", TODAY)).toBe("soon");
    expect(resolveTaxUrgency("todo", "2026-10-20", TODAY)).toBe("future");
  });

  it("ビューの 1 行を画面用に整える（空欄は既定値にする）", () => {
    const v = toTaxTaskView(TAX_ROWS[1], TODAY);
    expect(v.id).toBe("t2");
    expect(v.title).toBe("源泉所得税の納付");
    expect(v.amount).toBeNull();
    expect(v.memo).toBe("");
    expect(v.isGenerated).toBe(true);
    expect(v.urgency).toBe("soon");
    expect(toTaxTaskView(TAX_ROWS[3], TODAY).isGenerated).toBe(false);
  });

  it("期限切れ → まもなく → 先の予定 → 済 の順に並べる", () => {
    const views = TAX_ROWS.map((t) => toTaxTaskView(t, TODAY));
    expect(sortTaxTasks(views).map((t) => t.id)).toEqual(["t1", "t2", "t3", "t5", "t4"]);
  });

  it("緊急度ごとにグループ分けする", () => {
    const groups = groupTaxTasks(TAX_ROWS.map((t) => toTaxTaskView(t, TODAY)));
    expect(groups.overdue.map((t) => t.id)).toEqual(["t1"]);
    expect(groups.soon.map((t) => t.id)).toEqual(["t2"]);
    expect(groups.future.map((t) => t.id)).toEqual(["t3"]);
    // 済んだものは期日の新しい順
    expect(groups.done.map((t) => t.id)).toEqual(["t5", "t4"]);
  });

  it("件数と未対応の納付額を集計する", () => {
    const counts = taxCounts(TAX_ROWS.map((t) => toTaxTaskView(t, TODAY)));
    expect(counts.total).toBe(5);
    expect(counts.todo).toBe(3);
    expect(counts.overdue).toBe(1);
    expect(counts.soon).toBe(1);
    expect(counts.done).toBe(2);
    expect(counts.todoAmount).toBe(300_000);
  });

  it("残り日数の表示と、年での絞り込み", () => {
    const views = TAX_ROWS.map((t) => toTaxTaskView(t, TODAY));
    expect(daysLeftLabel(views[1])).toBe("あと 11 日");
    expect(daysLeftLabel(views[3])).toBe("—");
    expect(tasksOfYear(views, 2026)).toHaveLength(4);
    expect(tasksOfYear(views, 2027)).toHaveLength(1);
    expect(taxYears(TAX_ROWS)).toEqual([2027, 2026]);
  });
});

// ---------------------------------------------------------------------------
// 入力スキーマ
// ---------------------------------------------------------------------------

describe("財務の入力スキーマ", () => {
  it("?tab= からタブを決める（不正なら予算）", () => {
    expect(financeTabFromParam("loans")).toBe("loans");
    expect(financeTabFromParam(["tax"])).toBe("tax");
    expect(financeTabFromParam("なにか")).toBe("budget");
    expect(financeTabFromParam(undefined)).toBe("budget");
  });

  it("年間予算は全角・カンマ可、空欄は 0 として受け取る", () => {
    const parsed = saveYearTargetsSchema.parse({
      year: "2026",
      rows: [{ month: "2026-01", bill_target: "1,000,000", profit_target: "", expense_target: "３０００００", driver_target: "１０" }],
    });
    expect(parsed.year).toBe(2026);
    expect(parsed.rows[0].bill_target).toBe(1_000_000);
    expect(parsed.rows[0].profit_target).toBe(0);
    expect(parsed.rows[0].expense_target).toBe(300_000);
    expect(parsed.rows[0].driver_target).toBe(10);
  });

  it("年間予算は対象年と違う月・重複した月を受け付けない", () => {
    const row = { bill_target: 0, profit_target: 0, expense_target: 0, driver_target: 0 };
    expect(saveYearTargetsSchema.safeParse({ year: 2026, rows: [{ ...row, month: "2025-01" }] }).success).toBe(false);
    expect(
      saveYearTargetsSchema.safeParse({ year: 2026, rows: [{ ...row, month: "2026-01" }, { ...row, month: "2026-01" }] }).success,
    ).toBe(false);
    expect(saveYearTargetsSchema.safeParse({ year: 2026, rows: [] }).success).toBe(false);
  });

  it("借入は年利を % で受け取って率に直す（返済日の空欄は月末＝0）", () => {
    const parsed = loanInputSchema.parse({
      id: null,
      name: "運転資金",
      lender: "日本政策金融公庫",
      principal: "5,000,000",
      annual_rate: "1.8",
      start_on: "2026-01-10",
      months: "60",
      payment_day: "",
      monthly_payment: "",
      status: "active",
      memo: "",
    });
    expect(parsed.annual_rate).toBeCloseTo(0.018, 6);
    expect(parsed.principal).toBe(5_000_000);
    expect(parsed.payment_day).toBe(0);
    expect(parsed.monthly_payment).toBe(0);
    expect(parsed.id).toBeNull();
  });

  it("借入の回数・返済日・状態は範囲を外れると弾く", () => {
    const base = {
      id: null,
      name: "運転資金",
      lender: "",
      principal: 1_000_000,
      annual_rate: "1.8",
      start_on: "2026-01-10",
      months: 60,
      payment_day: 0,
      monthly_payment: 0,
      status: "active",
      memo: "",
    };
    expect(loanInputSchema.safeParse({ ...base, months: 0 }).success).toBe(false);
    expect(loanInputSchema.safeParse({ ...base, payment_day: 32 }).success).toBe(false);
    expect(loanInputSchema.safeParse({ ...base, start_on: "2026-02-30" }).success).toBe(false);
    expect(loanInputSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(loanInputSchema.safeParse({ ...base, status: "unknown" }).success).toBe(false);
  });

  it("返済済みの記録は日付か null を受け取る", () => {
    expect(setLoanPaymentPaidSchema.parse({ id: "11111111-1111-4111-8111-111111111111", paid_on: "" }).paid_on).toBeNull();
    expect(setLoanPaymentPaidSchema.parse({ id: "11111111-1111-4111-8111-111111111111", paid_on: "2026-09-27" }).paid_on).toBe("2026-09-27");
    expect(setLoanPaymentPaidSchema.safeParse({ id: "x", paid_on: null }).success).toBe(false);
  });

  it("税務の期限は納付額の空欄を未入力（null）として受け取る", () => {
    const base = { id: null, title: "法人税の確定申告", detail: "", due_on: "2026-05-31", status: "todo" as const, memo: "" };
    expect(taxTaskInputSchema.parse({ ...base, amount: "" }).amount).toBeNull();
    expect(taxTaskInputSchema.parse({ ...base, amount: "300,000" }).amount).toBe(300_000);
    expect(taxTaskInputSchema.safeParse({ ...base, amount: "", title: "" }).success).toBe(false);
    expect(taxTaskInputSchema.safeParse({ ...base, amount: "", due_on: "" }).success).toBe(false);
  });

  it("期限をまとめて作る年は 2000〜2100 に限る", () => {
    expect(ensureTaxTasksSchema.parse({ year: "2027" }).year).toBe(2027);
    expect(ensureTaxTasksSchema.safeParse({ year: 1999 }).success).toBe(false);
    expect(ensureTaxTasksSchema.safeParse({ year: 2101 }).success).toBe(false);
  });
});
