/**
 * 単価改定シミュレーション（§2.6 の計算をそのまま使う純関数）
 *
 * 「受注単価を +500 円にしたら」「支払単価を −3% にしたら」会社利益・ドライバーの手取りがどう変わるかを試算する。
 * 計算は必ず calcEntry / calcDriverMonth / calcCompanyMonth を通す（独自の丸め・手計算はしない）。
 * 単価は numeric(12,2)・率は numeric(6,4)・管理費は 0 以上という DB の制約に合わせて、
 * 変更後の値も «小数 2 桁へ四捨五入・マイナスは 0 へ» 丸めてから計算する（実際に保存できる値で試算する）。
 */
import { calcCompanyMonth, calcDriverMonth } from "./month";
import { fromS4, subMoney, toS4 } from "./money";
import type { AdjustmentInput, CompanyMonthCalc, DriverMonthCalc, EntryInput, TaxInput } from "./types";

/** 単価改定の条件（すべて省略可。省略した項目は現状のまま） */
export interface RateChange {
  /** 受注単価の増減（円）。+500 で 500 円上げる */
  billRateDelta?: number | null;
  /** 受注単価の増減（率。0.05 = +5%、−0.03 = −3%） */
  billRateRatio?: number | null;
  /** 支払単価の増減（円） */
  payRateDelta?: number | null;
  /** 支払単価の増減（率） */
  payRateRatio?: number | null;
  /** ロイヤリティ率の変更（0.1 = 10%）。null・undefined は現状のまま */
  royaltyRate?: number | null;
  /** 管理費の変更（円）。null・undefined は現状のまま */
  mgmtFee?: number | null;
}

/** 稼働行以外のドライバー × 月の条件（管理費・調整・消費税） */
export interface SimDriverMonth {
  /** 管理費の設定額（数量 > 0 の行が無い月は計上されない） */
  mgmtFee: number;
  adjustments: AdjustmentInput[];
  /** 省略時は消費税を計算しない */
  tax?: TaxInput | null;
}

/** シミュレーションの対象（ドライバー 1 人分の当月の稼働） */
export interface SimDriver {
  driverId: string;
  driverName: string;
  entries: EntryInput[];
  driverMonth: SimDriverMonth;
}

/** 「今」と「変更後」を並べるための共通の項目 */
export interface SimTotals {
  bill: number;
  pay: number;
  margin: number;
  royalty: number;
  mgmtFee: number;
  payout: number;
  tax: number;
  payoutIncl: number;
  profit: number;
  profitRate: number;
}

/** 変更後 − 今（利益率だけは率の差） */
export type SimDiff = SimTotals;

export interface DriverMonthSimulation {
  driverId: string;
  driverName: string;
  before: DriverMonthCalc;
  after: DriverMonthCalc;
  diff: SimDiff;
  /** 単価を差し替えた後の稼働行 */
  entries: EntryInput[];
}

export interface CompanyMonthSimulation {
  before: CompanyMonthCalc;
  after: CompanyMonthCalc;
  diff: SimDiff;
  drivers: DriverMonthSimulation[];
}

// ---------------------------------------------------------------------------
// 値の丸め（DB の制約に合わせる）
// ---------------------------------------------------------------------------

/** 単価・管理費は numeric(12,2)。小数 2 桁へ四捨五入し、マイナスは 0 にする */
export function roundRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const s4 = toS4(value); // 値 × 1e4
  const q = s4 / 100n; // 値 × 1e2（0 方向へ切り捨て）
  const r = s4 % 100n;
  const abs = r < 0n ? -r : r;
  const adj = abs * 2n >= 100n ? (r < 0n ? -1n : 1n) : 0n;
  const rounded = Number(q + adj) / 100;
  return rounded < 0 ? 0 : rounded;
}

/** ロイヤリティ率は numeric(6,4) で 0〜1。小数 4 桁へ四捨五入して範囲に収める */
export function clampRoyaltyRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  const v = fromS4(toS4(rate));
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 単価の変更：率 → 円 の順に適用し、小数 2 桁へ丸める（マイナスは 0） */
export function changedRate(rate: number, ratio: number | null | undefined, delta: number | null | undefined): number {
  const base = Number.isFinite(rate) ? rate : 0;
  const r = ratio == null || !Number.isFinite(ratio) ? 0 : ratio;
  const d = delta == null || !Number.isFinite(delta) ? 0 : delta;
  // 率は小数 8 桁精度で掛けてから 2 桁へ丸める（単価 2 桁 × 率 4 桁で誤差なし）
  const scaled = r === 0 ? base : fromS4((toS4(base) * toS4(1 + r)) / 10_000n);
  return roundRate(scaled + d);
}

/** 条件が 1 つでも指定されているか（未入力なら「変更なし」） */
export function hasRateChange(change: RateChange): boolean {
  return (
    !!change.billRateDelta ||
    !!change.billRateRatio ||
    !!change.payRateDelta ||
    !!change.payRateRatio ||
    change.royaltyRate != null ||
    change.mgmtFee != null
  );
}

// ---------------------------------------------------------------------------
// シミュレーション
// ---------------------------------------------------------------------------

/** 稼働行 1 件に単価改定を適用する（数量・端数処理はそのまま） */
export function applyRateChange(entry: EntryInput, change: RateChange): EntryInput {
  return {
    ...entry,
    billRate: changedRate(entry.billRate, change.billRateRatio, change.billRateDelta),
    payRate: changedRate(entry.payRate, change.payRateRatio, change.payRateDelta),
    royaltyRate: change.royaltyRate != null ? clampRoyaltyRate(change.royaltyRate) : entry.royaltyRate,
  };
}

/** ドライバー × 月の「今」と「変更後」（計算は calcDriverMonth に任せる） */
export function simulateDriverMonth(entries: EntryInput[], driverMonth: SimDriverMonth, change: RateChange): DriverMonthSimulation {
  const tax = driverMonth.tax ?? null;
  const adjustments = driverMonth.adjustments ?? [];
  const afterEntries = entries.map((e) => applyRateChange(e, change));
  const afterMgmtFee = change.mgmtFee != null ? roundRate(change.mgmtFee) : driverMonth.mgmtFee;
  const before = calcDriverMonth({ entries, mgmtFee: driverMonth.mgmtFee, adjustments, tax });
  const after = calcDriverMonth({ entries: afterEntries, mgmtFee: afterMgmtFee, adjustments, tax });
  return {
    driverId: "",
    driverName: "",
    before,
    after,
    diff: diffTotals(driverTotals(before), driverTotals(after)),
    entries: afterEntries,
  };
}

/** 会社 × 月（対象ドライバーの合計）の「今」と「変更後」 */
export function simulateCompanyMonth(drivers: SimDriver[], change: RateChange): CompanyMonthSimulation {
  const sims = drivers.map((d) => ({
    ...simulateDriverMonth(d.entries, d.driverMonth, change),
    driverId: d.driverId,
    driverName: d.driverName,
  }));
  const before = calcCompanyMonth(sims.map((s) => s.before));
  const after = calcCompanyMonth(sims.map((s) => s.after));
  return { before, after, diff: diffTotals(companyTotals(before), companyTotals(after)), drivers: sims };
}

// ---------------------------------------------------------------------------
// 比較用の項目
// ---------------------------------------------------------------------------

export function driverTotals(c: DriverMonthCalc): SimTotals {
  return {
    bill: c.bill,
    pay: c.pay,
    margin: c.margin,
    royalty: c.royalty,
    mgmtFee: c.mgmtFee,
    payout: c.payout,
    tax: c.tax,
    payoutIncl: c.payoutIncl,
    profit: c.driverProfit,
    profitRate: c.profitRate,
  };
}

export function companyTotals(c: CompanyMonthCalc): SimTotals {
  return {
    bill: c.bill,
    pay: c.pay,
    margin: c.margin,
    royalty: c.royalty,
    mgmtFee: c.mgmtFee,
    payout: c.payout,
    tax: c.tax,
    payoutIncl: c.payoutIncl,
    profit: c.profit,
    profitRate: c.profitRate,
  };
}

/** 変更後 − 今（金額は subMoney、利益率は率の差） */
export function diffTotals(before: SimTotals, after: SimTotals): SimDiff {
  return {
    bill: subMoney(after.bill, before.bill),
    pay: subMoney(after.pay, before.pay),
    margin: subMoney(after.margin, before.margin),
    royalty: subMoney(after.royalty, before.royalty),
    mgmtFee: subMoney(after.mgmtFee, before.mgmtFee),
    payout: subMoney(after.payout, before.payout),
    tax: subMoney(after.tax, before.tax),
    payoutIncl: subMoney(after.payoutIncl, before.payoutIncl),
    profit: subMoney(after.profit, before.profit),
    profitRate: after.profitRate - before.profitRate,
  };
}
