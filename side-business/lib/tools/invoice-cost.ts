/**
 * 計算ツール「免税ドライバーへの支払で、会社が負担する消費税はいくら？」の純関数。
 * 割合と 1 円未満の扱いは lib/payroll/tax.ts（TRANSITIONAL_STEPS・nonDeductibleTax）に任せ、ここでは並べて比べるだけ。
 */
import { jpMonth } from "@/lib/format";
import { parseAmount, roundYen, yen } from "@/lib/payroll/money";
import { TRANSITIONAL_STEPS, nonDeductibleTax } from "@/lib/payroll/tax";

/** 会社の消費税の計算方法。general = 原則課税、simplified = 簡易課税・2割特例 */
export type TaxMethod = "general" | "simplified";

export type PeriodStatus = "past" | "current" | "future";

export type InvoiceCostRow = {
  /** 期間の初日（YYYY-MM-DD） */
  from: string;
  /** 期間の末日（YYYY-MM-DD）。最後の期間は null */
  to: string | null;
  /** 「2026年10月〜2028年9月」 */
  label: string;
  /** 仕入税額相当額のうち控除できる割合（0.7 = 70%） */
  deductibleRate: number;
  /** 仕入税額相当額のうち会社がかぶる割合（1 − 控除できる割合） */
  burdenRate: number;
  /** 会社が負担する消費税（月） */
  monthly: number;
  /** 会社が負担する消費税（年 = 月 × 12） */
  yearly: number;
  status: PeriodStatus;
  /** 今の期間と比べて月いくら増えるか（今の期間が無いときは 0 と比べる） */
  diffMonthly: number;
  /** 今の期間と比べて年いくら増えるか（年の負担どうしの差） */
  diffYearly: number;
};

export type InvoiceCostResult = {
  monthlyPaidInclTax: number;
  taxMethod: TaxMethod;
  /** 原則課税なら true。簡易課税・2割特例は負担が出ないので false（説明を出す） */
  affected: boolean;
  /** 仕入税額相当額（税込 × 10/110。1 円未満は切り捨て） */
  creditableTax: number;
  rows: InvoiceCostRow[];
  current: InvoiceCostRow | null;
  /** 今の次の期間（今が最後の期間なら null） */
  next: InvoiceCostRow | null;
  /** 次の期間まであと何日か */
  daysUntilNext: number | null;
};

/** この計算がもとにしている制度の時点 */
export const RULES_AS_OF_LABEL = "2026年9月";

/** 入力の上限（1000 億円）。桁の打ち間違いを止める */
export const MAX_MONTHLY_AMOUNT = 100_000_000_000;
/** 人数の上限 */
export const MAX_HEADCOUNT = 10_000;

function ym(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/** 期間の表示。2026-10-01〜2028-09-30 → 「2026年10月〜2028年9月」、終わりが無ければ「2031年10月〜」 */
export function periodLabel(from: string, to: string | null): string {
  return `${jpMonth(from)}〜${to ? jpMonth(to) : ""}`;
}

/** 端末の日付（ローカル時刻）を YYYY-MM-DD にする */
export function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** from から to まで何日か（YYYY-MM-DD 同士） */
export function daysBetween(from: string, to: string): number {
  const a = ym(from);
  const b = ym(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/**
 * 金額の入力を読む。全角・カンマ・円記号に加えて「110万」「110万円」も受け付ける。
 * 空なら value も error も null（まだ入れていない）。
 */
export function readAmount(input: string): { value: number | null; error: string | null } {
  const text = input.trim();
  if (text === "") return { value: null, error: null };
  const man = text.match(/^(.+?)万円?$/);
  const parsed = man ? parseAmount(man[1]) : parseAmount(text);
  if (parsed === null) return { value: null, error: "数字で入れてください（例：1,100,000 や 110万）" };
  const value = man ? parsed * 10_000 : parsed;
  if (value < 0) return { value: null, error: "0円以上で入れてください" };
  if (value > MAX_MONTHLY_AMOUNT) return { value: null, error: "金額が大きすぎます。桁を確かめてください" };
  return { value: roundYen(value, "round"), error: null };
}

/** 人数 × 1 人あたりの月の支払。どちらかが読めなければ null */
export function totalFromHeadcount(countText: string, perPersonText: string): number | null {
  const count = parseAmount(countText.trim().replace(/人$/, ""));
  if (count === null || !Number.isInteger(count) || count < 1 || count > MAX_HEADCOUNT) return null;
  const per = readAmount(perPersonText).value;
  if (per === null) return null;
  const total = roundYen(count * per, "round");
  return total > MAX_MONTHLY_AMOUNT ? null : total;
}

/** 控除できる割合が 0 になる期間（経過措置が終わったあと） */
const NO_DEDUCTION_STEP = TRANSITIONAL_STEPS.find((step) => step.rate === 0) ?? TRANSITIONAL_STEPS[TRANSITIONAL_STEPS.length - 1];

/**
 * 仕入税額相当額（税込 × 10/110、1 円未満は切り捨て）。
 * 控除できる割合が 0 の期間の「控除できない額」と同じなので、lib/payroll の nonDeductibleTax をそのまま使う。
 */
export function creditableTaxOf(amountInclTax: number): number {
  return nonDeductibleTax(amountInclTax, NO_DEDUCTION_STEP.from);
}

function statusOf(today: string, from: string, to: string | null): PeriodStatus {
  if (today < from) return "future";
  if (to !== null && today > to) return "past";
  return "current";
}

/**
 * 免税（インボイス未登録）の方へ税込 monthlyPaidInclTax 円を毎月払うとき、
 * 経過措置の期間ごとに会社が負担する消費税を並べる。today（YYYY-MM-DD）の期間が「今」。
 */
export function calcInvoiceCost(input: {
  monthlyPaidInclTax: number;
  taxMethod: TaxMethod;
  today: string;
}): InvoiceCostResult {
  const { monthlyPaidInclTax, taxMethod, today } = input;
  const affected = taxMethod === "general";
  const base = TRANSITIONAL_STEPS.map((step) => {
    const monthly = affected ? nonDeductibleTax(monthlyPaidInclTax, step.from) : 0;
    return {
      from: step.from,
      to: step.to,
      label: periodLabel(step.from, step.to),
      deductibleRate: step.rate,
      burdenRate: Math.round((1 - step.rate) * 1000) / 1000,
      monthly,
      yearly: monthly * 12,
      status: statusOf(today, step.from, step.to),
    };
  });
  const currentIndex = base.findIndex((r) => r.status === "current");
  const currentMonthly = currentIndex >= 0 ? base[currentIndex].monthly : 0;
  const currentYearly = currentIndex >= 0 ? base[currentIndex].yearly : 0;
  const rows: InvoiceCostRow[] = base.map((r) => ({
    ...r,
    diffMonthly: r.monthly - currentMonthly,
    diffYearly: r.yearly - currentYearly,
  }));
  const current = currentIndex >= 0 ? rows[currentIndex] : null;
  // 今が経過措置の前（2023年9月以前）なら最初の期間が「次」
  const nextIndex = currentIndex >= 0 ? currentIndex + 1 : rows.findIndex((r) => r.status === "future");
  const next = nextIndex >= 0 && nextIndex < rows.length ? rows[nextIndex] : null;
  return {
    monthlyPaidInclTax,
    taxMethod,
    affected,
    creditableTax: creditableTaxOf(monthlyPaidInclTax),
    rows,
    current,
    next,
    daysUntilNext: next ? daysBetween(today, next.from) : null,
  };
}

/** 共有しやすい 1〜2 文のまとめ（原則課税か簡易課税かを必ず入れる。受け取った人が前提を取り違えないように） */
export function shareText(result: InvoiceCostResult): string {
  const paid = `免税（インボイス未登録）のドライバーへの支払が月${yen(result.monthlyPaidInclTax)}（税込）`;
  if (!result.affected) {
    return `簡易課税・2割特例の会社は、${paid}でも、消費税の負担は増えません。`;
  }
  const lead = `原則課税の会社で、${paid}だと、`;
  const { current, next } = result;
  if (!current) {
    const first = result.rows[0];
    return `${lead}${jpMonth(first.from)}から控除できずに負担する消費税は月${yen(first.monthly)}（年${yen(first.yearly)}）です。`;
  }
  const now = `${lead}控除できずに負担する消費税は、いま月${yen(current.monthly)}（年${yen(current.yearly)}）。`;
  if (!next) return `${now}経過措置が終わったので、仕入税額相当額の全額が会社の負担です。`;
  return `${now}${jpMonth(next.from)}からは月${yen(next.monthly)}（年${yen(next.yearly)}）になり、負担が月${yen(next.diffMonthly)}増えます。`;
}
