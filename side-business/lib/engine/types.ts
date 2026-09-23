/**
 * 業種をまたいだ支払の計算エンジン（lib/engine）で共通に使う型と、文章に数字を埋め込むための書式。
 * 金額はすべて整数の円。画面（React）には依存しない。
 */
import type { Rounding } from "@/lib/payroll/types";

export type { Rounding };

/**
 * 注意の重さ。
 *  - warning：法令上の問題になりうる設定（減額のおそれ・60日超えなど）
 *  - caution：判断はしないが確かめてほしい設定（労働者性のリスク・消費税相当額を払わない など）
 *  - info：知っておいてほしいこと（区分は要確認 など）
 */
export type WarningLevel = "warning" | "caution" | "info";

export type WarningCode =
  /** 合意（取引条件の明示）の無い控除・罰金 → フリーランス法5条の減額のおそれ */
  | "reduction_risk"
  /** 振込手数料を差し引いている */
  | "transfer_fee_deducted"
  /** 罰金 → 労働者性のリスク */
  | "labor_risk_penalty"
  /** 日数に結びついた最低保証 → 労働者性のリスク */
  | "labor_risk_guarantee"
  /** 固定給のような定額 → 労働者性のリスク */
  | "labor_risk_fixed_pay"
  /** 免税の方に消費税相当額を上乗せしていない */
  | "exempt_no_tax_equivalent"
  /** 登録済みの方に消費税を上乗せしていない */
  | "tax_not_added"
  /** 源泉の区分は要確認 */
  | "withholding_needs_review"
  /** 外交員の固定の部分（給与）を計算から外した */
  | "gaikoin_salary_part"
  /** 支払期日が60日を超える */
  | "over_60_days"
  /** 請求書の受け取りを起点にした支払期日 */
  | "due_from_invoice_receipt"
  /** 振込額がマイナス */
  | "negative_payout"
  /** 入力が読めない・範囲がおかしい */
  | "invalid_input";

export type EngineWarning = {
  code: WarningCode;
  level: WarningLevel;
  message: string;
  /** どの行・控除から出たか（ラベル） */
  source?: string;
};

/**
 * 消費税の標準税率（国税7.8% ＋ 地方消費税2.2%）。呼ぶ側が taxRate を渡さないときの既定値。
 * 率をコードの各所に直書きしないよう、ここだけで持つ。
 */
export const DEFAULT_CONSUMPTION_TAX_RATE = 0.1;

/** 労働者性の注意の決まり文句（判定はしない） */
export const LABOR_RISK_TEXT = "労働者性のリスクがある設計です（判断は専門家へ）。この道具は適法・違法を判定しません。";

/** 減額の注意の決まり文句 */
export const REDUCTION_RISK_TEXT =
  "取引条件として明示・合意していない差し引きは、フリーランス法5条の「減額」にあたるおそれがあります。";

/* ───────────── 書式 ───────────── */

const intFormat = new Intl.NumberFormat("ja-JP");
const decFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 });

/** 浮動小数の誤差（0.1+0.2 など）を消す */
export function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 84000 → "84,000円" */
export function en(value: number): string {
  const v = Math.round(value);
  return `${v < 0 ? "−" : ""}${intFormat.format(Math.abs(v))}円`;
}

/** 186.5 → "186.5"、42000 → "42,000" */
export function num(value: number): string {
  return decFormat.format(clean(value));
}

/** 0.45 → "45%"、0.01728 → "1.728%" */
export function percent(rate: number): string {
  return `${decFormat.format(clean(rate * 100))}%`;
}

/** 万分率の整数 → 1021 → "10.21%" */
export function bpText(bp: number): string {
  return `${decFormat.format(bp / 100)}%`;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
