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

export interface DriverMonthInput {
  entries: EntryInput[];
  mgmtFee: number;
  adjustments: AdjustmentInput[];
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
  payout: number;
  driverProfit: number;
  profitRate: number;
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
}
