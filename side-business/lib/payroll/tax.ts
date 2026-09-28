/**
 * 免税事業者など（インボイス登録なし）からの仕入れについて、仕入税額相当額のうち控除できる割合（経過措置）。
 * 令和8年度税制改正で段階が変わった。判定は課税仕入れを行った日。
 * 出典：国税庁 インボイス Q&A 問113・令和8年度税制改正の特集
 *   https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm
 */
export const TRANSITIONAL_STEPS: { from: string; to: string | null; rate: number }[] = [
  { from: "2023-10-01", to: "2026-09-30", rate: 0.8 },
  { from: "2026-10-01", to: "2028-09-30", rate: 0.7 },
  { from: "2028-10-01", to: "2030-09-30", rate: 0.5 },
  { from: "2030-10-01", to: "2031-09-30", rate: 0.3 },
  { from: "2031-10-01", to: null, rate: 0 },
];

export const TRANSITIONAL_SOURCE =
  "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm";

/** YYYY-MM-DD の日の割合。インボイス制度の前（2023-09-30 まで）は全額控除できたので 1 */
export function deductibleRateForExempt(date: string): number {
  if (date < TRANSITIONAL_STEPS[0].from) return 1;
  for (const step of TRANSITIONAL_STEPS) {
    if (date >= step.from && (step.to === null || date <= step.to)) return step.rate;
  }
  return 0;
}

/** 月（YYYY-MM）の末日（YYYY-MM-DD） */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/**
 * 免税の方へ税込 amountInclTax 円を払ったとき、控除できずに会社が負担する消費税。
 * 仕入税額相当額（税込 × 10/110）×（1 − 控除できる割合）。1 円未満は切り捨て。
 */
export function nonDeductibleTax(amountInclTax: number, date: string, taxRate = 0.1): number {
  const creditable = (amountInclTax * taxRate) / (1 + taxRate);
  return Math.floor(Math.round(creditable * (1 - deductibleRateForExempt(date)) * 1e6) / 1e6);
}
