/** 端数処理モード（ロイヤリティ額に適用） */
export type RoundingMode = "none" | "floor" | "round" | "ceil";
export const ROUNDING_MODES: RoundingMode[] = ["none", "floor", "round", "ceil"];
export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  none: "丸めない",
  floor: "切り捨て",
  round: "四捨五入",
  ceil: "切り上げ",
};

/** 案件内容の区分 */
export type Unit = "day" | "piece";
export const UNIT_LABELS: Record<Unit, string> = { day: "日給", piece: "個数" };
export const QTY_LABELS: Record<Unit, string> = { day: "稼働日数", piece: "個数" };

/** 稼働行の計算入力（スナップショット済みの値） */
export interface EntryInput {
  qty: number;
  billRate: number;
  payRate: number;
  royaltyRate: number;
  roundingMode: RoundingMode;
}

/** 稼働行の計算結果 */
export interface EntryCalc {
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  entryProfit: number;
}

export interface AdjustmentInput {
  amount: number;
  countAsProfit: boolean;
}

/** 課税区分：taxable = 消費税を上乗せして支払う／exempt = 上乗せしない（非課税・免税） */
export type TaxMode = "taxable" | "exempt";
export const TAX_MODES: TaxMode[] = ["taxable", "exempt"];
export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  taxable: "課税（消費税を上乗せして支払う）",
  exempt: "非課税・免税（消費税を上乗せしない）",
};

/** 消費税の計算条件（会社設定の税率・端数処理、ドライバーの課税区分） */
export interface TaxInput {
  mode: TaxMode;
  /** 0.10 = 10% */
  rate: number;
  rounding: RoundingMode;
}

export interface DriverMonthInput {
  entries: EntryInput[];
  mgmtFee: number;
  adjustments: AdjustmentInput[];
  /** 省略時は消費税を計算しない（tax = 0、payoutIncl = payout） */
  tax?: TaxInput | null;
}

export interface DriverMonthCalc {
  entryCount: number;
  activeEntryCount: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  /** 実際に計上した管理費（数量>0 の行が無ければ 0） */
  mgmtFee: number;
  /** 設定上の管理費 */
  mgmtFeeSetting: number;
  adjPay: number;
  adjProfit: number;
  /** 税抜の支払額（Σpay − Σroyalty − 管理費 + Σ調整） */
  payout: number;
  driverProfit: number;
  profitRate: number;
  /** 消費税の対象額（税抜小計 = Σpay − Σroyalty − 管理費。調整は含めない） */
  taxBase: number;
  /** 消費税額（tax 未指定または非課税なら 0） */
  tax: number;
  /** 税込の支払額（payout + tax） */
  payoutIncl: number;
}

export interface CompanyMonthCalc {
  driverCount: number;
  entryCount: number;
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFee: number;
  adjPay: number;
  adjProfit: number;
  payout: number;
  profit: number;
  profitRate: number;
  tax: number;
  payoutIncl: number;
}
