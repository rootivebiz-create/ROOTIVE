import { applyRoundingS8, fromS4, mulS8, toS4 } from "./money";
import type { EntryCalc, EntryInput, RoundingMode } from "./types";

/**
 * 稼働行の計算（§2.1）
 * bill = bill_rate × qty / pay = pay_rate × qty / margin = bill − pay
 * royalty = ROUND_MODE(pay × royalty_rate) / entry_profit = margin + royalty
 */
export function calcEntry(input: EntryInput): EntryCalc {
  const qty = Number.isFinite(input.qty) ? input.qty : 0;
  const billS8 = mulS8(input.billRate, qty);
  const payS8 = mulS8(input.payRate, qty);
  // 売上・支払は小数 4 桁精度（rate 2 桁 × qty 2 桁で誤差なし）
  const bill = fromS4(billS8 / 10_000n);
  const pay = fromS4(payS8 / 10_000n);
  const margin = fromS4(toS4(bill) - toS4(pay));
  const royaltyS8 = mulS8(pay, input.royaltyRate);
  const royalty = applyRoundingS8(royaltyS8, input.roundingMode);
  const entryProfit = fromS4(toS4(margin) + toS4(royalty));
  return { bill, pay, margin, royalty, entryProfit };
}

/** 端数処理の優先順：稼働行 ← ドライバー設定 ← 会社設定 */
export function resolveRoundingMode(
  entryMode: RoundingMode | null | undefined,
  driverMode: RoundingMode | null | undefined,
  companyMode: RoundingMode,
): RoundingMode {
  return entryMode ?? driverMode ?? companyMode;
}

export interface EntryDefaultsSource {
  item: { billRate: number; payRate: number };
  /** ドライバー別単価（driver_pay_overrides）。null／undefined の項目は案件内容の標準を使う */
  override?: { billRate?: number | null; payRate?: number | null } | null;
  driver: { royaltyRate: number | null; roundingMode: RoundingMode | null };
  company: { defaultRoyaltyRate: number; roundingMode: RoundingMode };
}

export interface EntryDefaults {
  billRate: number;
  payRate: number;
  royaltyRate: number;
  roundingMode: RoundingMode;
  billRateSource: "override" | "item";
  payRateSource: "override" | "item";
  royaltySource: "driver" | "company";
  roundingSource: "driver" | "company";
}

/**
 * マスタからの自動入力（§2.5）
 * 受注単価・支払単価：ドライバー別単価（driver_pay_overrides）→ 案件内容の標準
 * ロイヤリティ率・端数処理：ドライバー設定 → 会社設定
 */
export function resolveEntryDefaults(src: EntryDefaultsSource): EntryDefaults {
  const overrideBill = src.override?.billRate ?? null;
  const overridePay = src.override?.payRate ?? null;
  const billRateSource = overrideBill != null ? "override" : "item";
  const payRateSource = overridePay != null ? "override" : "item";
  const royaltySource = src.driver.royaltyRate != null ? "driver" : "company";
  const roundingSource = src.driver.roundingMode != null ? "driver" : "company";
  return {
    billRate: overrideBill ?? src.item.billRate,
    payRate: overridePay ?? src.item.payRate,
    royaltyRate: src.driver.royaltyRate ?? src.company.defaultRoyaltyRate,
    roundingMode: src.driver.roundingMode ?? src.company.roundingMode,
    billRateSource,
    payRateSource,
    royaltySource,
    roundingSource,
  };
}
