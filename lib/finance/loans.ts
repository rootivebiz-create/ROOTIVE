/**
 * 借入金と返済予定の純関数（React・DB に依存しない）
 *
 * - 返済予定そのものは DB の RPC `generate_loan_schedule`（元利均等）が作る。
 *   ここでは画面のプレビューと要約だけを行い、同じ式・同じ丸め（円未満四捨五入）で計算する
 * - 金額の合計は `lib/calc` の sumMoney（独自の丸めを書かない）
 */
import { roundDisplay, sumMoney } from "@/lib/calc";
import type { LoanStatus } from "@/lib/db/types";
import { monthOfDate, yearOfDate } from "./date";

/** v_loan_list の 1 行のうち、画面で使う列だけ */
export interface LoanLike {
  id?: string | null;
  name?: string | null;
  lender?: string | null;
  principal?: number | null;
  annual_rate?: number | null;
  start_on?: string | null;
  months?: number | null;
  payment_day?: number | null;
  monthly_payment?: number | null;
  status?: LoanStatus | string | null;
  payment_count?: number | null;
  paid_count?: number | null;
  remaining_principal?: number | null;
  paid_principal?: number | null;
  total_interest?: number | null;
  next_due_on?: string | null;
  next_total?: number | null;
  final_due_on?: string | null;
}

/** v_loan_payment_list の 1 行のうち、画面で使う列だけ */
export interface LoanPaymentLike {
  id?: string | null;
  loan_id?: string | null;
  seq?: number | null;
  due_on?: string | null;
  principal?: number | null;
  interest?: number | null;
  total?: number | null;
  balance?: number | null;
  paid_on?: string | null;
  loan_name?: string | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * 元利均等の毎月の返済額（円未満四捨五入）。DB の generate_loan_schedule と同じ式
 * 年利 0 のときは 借入額 ÷ 回数
 */
export function equalPayment(principal: number, annualRate: number, months: number): number {
  const p = num(principal);
  const n = Math.trunc(num(months));
  if (p <= 0 || n <= 0) return 0;
  const r = num(annualRate) / 12;
  if (r <= 0) return roundDisplay(p / n);
  return roundDisplay((p * r) / (1 - Math.pow(1 + r, -n)));
}

/** その借入の毎月の返済額（0 なら自動計算した額） */
export function monthlyPaymentOf(loan: LoanLike): number {
  const fixed = num(loan.monthly_payment);
  if (fixed > 0) return fixed;
  return equalPayment(num(loan.principal), num(loan.annual_rate), num(loan.months));
}

/** 返済総額の見込み（毎月の返済額 × 回数。最終回の調整は含まない目安） */
export function totalPaymentEstimate(loan: LoanLike): number {
  return roundDisplay(monthlyPaymentOf(loan) * Math.max(0, Math.trunc(num(loan.months))));
}

/** 返済の進み具合（0〜1） */
export function loanProgress(loan: LoanLike): number {
  const total = num(loan.payment_count);
  if (total <= 0) return 0;
  const paid = Math.min(num(loan.paid_count), total);
  return Math.round((paid / total) * 1_000) / 1_000;
}

export function isActiveLoan(loan: LoanLike): boolean {
  return loan.status === "active";
}

/** 返済予定がまだ作られていない借入（保存後に generate_loan_schedule を呼び忘れた場合など） */
export function hasSchedule(loan: LoanLike): boolean {
  return num(loan.payment_count) > 0;
}

/** 返済済みの回が 1 件でもあるか（削除の可否に使う） */
export function hasPaidPayment(payments: LoanPaymentLike[]): boolean {
  return payments.some((p) => !!p.paid_on);
}

/** 期日を過ぎた未返済 */
export function isOverduePayment(payment: LoanPaymentLike, today: string): boolean {
  return !payment.paid_on && !!payment.due_on && String(payment.due_on) < today;
}

/** 返済予定の並び（期日 → 回数） */
export function sortPayments(payments: LoanPaymentLike[]): LoanPaymentLike[] {
  return [...payments].sort((a, b) => {
    const d = String(a.due_on ?? "").localeCompare(String(b.due_on ?? ""));
    return d !== 0 ? d : num(a.seq) - num(b.seq);
  });
}

/** 指定した月（"YYYY-MM"）に期日が来る回 */
export function paymentsInMonth(payments: LoanPaymentLike[], month: string): LoanPaymentLike[] {
  return payments.filter((p) => monthOfDate(p.due_on) === month);
}

/** 指定した年に期日が来る回 */
export function paymentsInYear(payments: LoanPaymentLike[], year: number): LoanPaymentLike[] {
  return payments.filter((p) => yearOfDate(p.due_on) === year);
}

/** 返済額の合計 */
export function totalOfPayments(payments: LoanPaymentLike[]): number {
  return sumMoney(payments.map((p) => num(p.total)));
}

/** 次に返済する回（未返済のうち期日がいちばん早い回） */
export function nextPayment(payments: LoanPaymentLike[]): LoanPaymentLike | null {
  const unpaid = sortPayments(payments.filter((p) => !p.paid_on));
  return unpaid[0] ?? null;
}

/** 借入タブの要約カード */
export interface LoanSummary {
  /** 借入の件数（完済を除く） */
  loanCount: number;
  /** 返済中の件数 */
  activeCount: number;
  /** 借入残高の合計（未返済の元金。完済・予定の借入は含めない） */
  remainingTotal: number;
  /** 今月の返済額（期日が今月の回の合計） */
  thisMonthTotal: number;
  /** 今年の返済額（期日が今年の回の合計） */
  thisYearTotal: number;
  /** 支払利息の合計（返済予定にある利息のすべて） */
  interestTotal: number;
  /** 期日を過ぎた未返済の件数と金額 */
  overdueCount: number;
  overdueTotal: number;
}

/**
 * 借入の要約
 * @param loans v_loan_list の行
 * @param payments 集計したい期間の v_loan_payment_list の行（ふつうは今年ぶん）
 * @param today 日本時間の今日 "YYYY-MM-DD"
 */
export function loanSummary(loans: LoanLike[], payments: LoanPaymentLike[], today: string): LoanSummary {
  const month = monthOfDate(today);
  const year = yearOfDate(today);
  const counted = loans.filter((l) => l.status !== "paid");
  const overdue = payments.filter((p) => isOverduePayment(p, today));
  return {
    loanCount: counted.length,
    activeCount: loans.filter(isActiveLoan).length,
    remainingTotal: sumMoney(loans.filter((l) => l.status === "active").map((l) => num(l.remaining_principal))),
    thisMonthTotal: totalOfPayments(paymentsInMonth(payments, month)),
    thisYearTotal: totalOfPayments(paymentsInYear(payments, year)),
    interestTotal: sumMoney(loans.map((l) => num(l.total_interest))),
    overdueCount: overdue.length,
    overdueTotal: totalOfPayments(overdue),
  };
}

export const ZERO_LOAN_SUMMARY: LoanSummary = {
  loanCount: 0,
  activeCount: 0,
  remainingTotal: 0,
  thisMonthTotal: 0,
  thisYearTotal: 0,
  interestTotal: 0,
  overdueCount: 0,
  overdueTotal: 0,
};

/** 借入の並び（返済中 → 予定 → 完済、その中は借入日の新しい順） */
const STATUS_ORDER: Record<string, number> = { active: 0, planned: 1, paid: 2 };

export function sortLoans(loans: LoanLike[]): LoanLike[] {
  return [...loans].sort((a, b) => {
    const sa = STATUS_ORDER[String(a.status ?? "")] ?? 9;
    const sb = STATUS_ORDER[String(b.status ?? "")] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(b.start_on ?? "").localeCompare(String(a.start_on ?? ""));
  });
}

/** 返済日の表示（0 = 月末） */
export function paymentDayLabel(day: number | null | undefined): string {
  const d = Math.trunc(num(day));
  return d <= 0 ? "月末" : `${d}日`;
}
