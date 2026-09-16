import { applyRoundingS8, fromS4, mulS8, toS4 } from "./money";
import type { TaxInput } from "./types";

/**
 * 消費税（0008）
 * - 単価・管理費・ロイヤリティはすべて税抜で入力する。調整（固定控除・立替など）は税込の金額として扱う
 * - 税抜小計 tax_base = Σpay − Σroyalty − 管理費 に税率を掛け、会社設定の端数処理（既定 切り捨て）で丸める
 * - 課税区分が exempt（非課税・免税）のドライバーは 0
 */
export function calcTax(taxBase: number, tax: TaxInput | null | undefined): number {
  if (!tax || tax.mode !== "taxable") return 0;
  const rate = Number.isFinite(tax.rate) ? tax.rate : 0;
  return applyRoundingS8(mulS8(taxBase, rate), tax.rounding);
}

export interface TaxBreakdown {
  /** 税抜小計（消費税の対象額） */
  taxBase: number;
  tax: number;
  /** 税込の支払額（税抜支払額 + 消費税） */
  payoutIncl: number;
}

/** 税抜の内訳から消費税と税込支払額を求める（明細画面・プレビュー用） */
export function calcTaxBreakdown(input: { pay: number; royalty: number; mgmtFee: number; payout: number }, tax: TaxInput | null | undefined): TaxBreakdown {
  const taxBase = fromS4(toS4(input.pay) - toS4(input.royalty) - toS4(input.mgmtFee));
  const t = calcTax(taxBase, tax);
  return { taxBase, tax: t, payoutIncl: fromS4(toS4(input.payout) + toS4(t)) };
}

/** 税率の表示（0.10 → "10%"、0.08 → "8%"） */
export function taxRateLabel(rate: number): string {
  const pctValue = Math.round(rate * 10000) / 100;
  return `${Number.isInteger(pctValue) ? pctValue : pctValue.toFixed(1)}%`;
}
